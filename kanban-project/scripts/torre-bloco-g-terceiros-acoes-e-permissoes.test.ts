// scripts/torre-bloco-g-terceiros-acoes-e-permissoes.test.ts
// ============================================================================
// TORRE DE CONTROLE, BLOCO G2–G5 e G7 (30/09/2026).
//
//   npx tsx scripts/torre-bloco-g-terceiros-acoes-e-permissoes.test.ts   (banco de teste)
//
// PROVA:
//   G2  "Iniciar" só para a tarefa que REALMENTE pode iniciar (fase atual, sem bloqueio,
//       com órgão, ponto de entrada) — na lista E na API — e executa pelo motor.
//   G3  o N de "Cobrar todos os vencidos" é o MESMO da lista; a porta existente cobra.
//   G4  cobrar POR CARTÓRIO cobra só o que está com aquele órgão; a lista de Terceiros é POR PEDIDO; "Contatos" lista o histórico DO PEDIDO.
//   G5  ligação e troca de canal entram no histórico da TAREFA (Andamento) e do PEDIDO (Contatos),
//       sem duplicar registro.
//   G7  cada ação exige a permissão da porta individual; quem não é gestor da Torre é recusado.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-bloco-g-terceiros-acoes-e-permissoes.test.ts")

import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { montarCenario } from "./_fixture-torre-gh"
import { listarTarefasDaTorre } from "../src/services/torre-tarefas"
import { visaoGerencial } from "../lib/operacional/tarefa-projecoes"
import { ehCobravelVencido } from "../lib/operacional/torre-predicados"
import { canaisCadastrados, cobrarTarefas } from "../src/services/cobranca-terceiros"
import { cobrarOrgao, contatosDoPedido, contatosDoOrgao, listarTerceiros } from "../src/services/torre-terceiros"
import { pedidosDeTerceiros, resumoDeTerceiros } from "../lib/operacional/terceiros-pedidos"
import { numeroDoKpi } from "../lib/operacional/torre-kpis"
import { registrarLigacao, trocarCanal } from "../src/services/precisa-de-voce-acoes"
import { montarAndamentoDaOperacao } from "../src/services/andamento-operacional"
import { motivoDeNaoPoderIniciar } from "../src/services/iniciar-envio"
import { GET as getLista } from "../src/app/api/torre/tarefas/route"
import { POST as postLote } from "../src/app/api/torre/tarefas/lote/route"
import { POST as postIniciar } from "../src/app/api/torre/tarefas/[tarefaId]/iniciar/route"
import { POST as postCobrarOrgao } from "../src/app/api/torre/terceiros/[orgaoId]/cobrar/route"
import { GET as getContatos } from "../src/app/api/torre/terceiros/[orgaoId]/contatos/route"
import { GET as getTerceiros } from "../src/app/api/torre/terceiros/route"
import { GET as getContatosDoPedido } from "../src/app/api/torre/terceiros/pedidos/[tarefaId]/contatos/route"
import { POST as postLigacao } from "../src/app/api/torre/tarefas/[tarefaId]/ligacao/route"
import { POST as postCanal } from "../src/app/api/torre/tarefas/[tarefaId]/canal/route"
import { POST as postCobrarVencidos } from "../src/app/api/operacao/tarefas/cobrar-todos-vencidos/route"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORREG2"

const req = (method: string, url: string, token: string | null, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })
const tokenDe = (u: { id: number; email: string; tipo: string }) => signAuthToken({ userId: u.id, email: u.email, tipo: u.tipo, sessaoInicio: Date.now() })

async function main() {
  const c = await montarCenario(MARCA)
  try {
    const mk = (nome: string, tipo: string, perms?: Record<string, boolean>) =>
      prisma.usuario.create({ data: { nome: `${MARCA} ${nome}`, email: `${MARCA.toLowerCase()}-${nome.toLowerCase()}@t.com`, senha: "x", tipo, ...(perms ? { permissoesCustom: perms } : {}) } })
    const admin = await mk("Admin", "admin")
    const comum = await mk("Comum", "assistente", { "tarefas.ver": true })
    const gestor = await mk("Gestor", "assistente", { "tarefas.ver": true, "operacao.distribuirTarefas": true })
    const tAdmin = await tokenDe(admin), tComum = await tokenDe(comum), tGestor = await tokenDe(gestor)

    const o1 = await c.novoOrgao("Cartório Um", { email: "um@cartorio.test", state: "SP" })
    const o2 = await c.novoOrgao("Cartório Dois", { telefone: "11 5555-0000", state: "RJ" })

    // a1,a2 com o1 · a3 com o2 · a4 do o1 mas ainda NÃO enviada · a5 sem órgão
    const a1 = await c.novaObrigacao({ aguardando: true, orgaoId: o1.id })
    const a2 = await c.novaObrigacao({ aguardando: true, orgaoId: o1.id, comSolicitacao: { canal: "BALCAO" } })
    const a3 = await c.novaObrigacao({ aguardando: true, orgaoId: o2.id })
    const a4 = await c.novaObrigacao({ orgaoId: o1.id })
    const a5 = await c.novaObrigacao({ aguardando: true })

    // Acompanhamento vencido em a1 e a2 (o passado é a fonte: SubtaskExecution.proximoAcompanhamentoEm).
    const ontem = new Date(Date.now() - 2 * 86_400_000)
    for (const a of [a1, a2]) {
      await prisma.subtaskExecution.updateMany({ where: { stepInstanceId: a.stepInstanceId, subtaskKey: "aguardar_retorno", supersededAt: null }, data: { proximoAcompanhamentoEm: ontem } })
    }

    secao("G7 — PERMISSÕES: a API recusa (e a tela só mostra o que a API aceita)")
    ok("sem token: 401", (await getLista(req("GET", "/api/torre/tarefas", null))).status === 401)
    ok("usuário comum (não é gestor da Torre): 403", (await getLista(req("GET", "/api/torre/tarefas", tComum))).status === 403)
    const rGestor = await getLista(req("GET", "/api/torre/tarefas", tGestor))
    const jGestor = await rGestor.json()
    ok("gestor operacional entra, mas SEM permissão de editar", rGestor.status === 200 && jGestor.permissoes.editar === false)
    ok("gestor sem tarefas.editar: lote ATRIBUIR → 403", (await postLote(req("POST", "/api/torre/tarefas/lote", tGestor, { acao: "ATRIBUIR", tarefaIds: [a4.tarefaId], responsavelId: comum.id }))).status === 403)
    ok("gestor sem tarefas.editar: lote REPACTUAR → 403", (await postLote(req("POST", "/api/torre/tarefas/lote", tGestor, { acao: "REPACTUAR", tarefaIds: [a4.tarefaId], novoPrazo: "2026-12-01", justificativa: "x" }))).status === 403)
    ok("gestor sem tarefas.editar: lote PRIORIDADE_ALTA → 403", (await postLote(req("POST", "/api/torre/tarefas/lote", tGestor, { acao: "PRIORIDADE_ALTA", tarefaIds: [a4.tarefaId] }))).status === 403)
    ok("comum: lote COBRAR → 403 (nem entra na Torre)", (await postLote(req("POST", "/api/torre/tarefas/lote", tComum, { acao: "COBRAR", tarefaIds: [a3.tarefaId] }))).status === 403)
    ok("ação desconhecida: 400", (await postLote(req("POST", "/api/torre/tarefas/lote", tAdmin, { acao: "APAGAR_TUDO", tarefaIds: [1] }))).status === 400)
    ok("REPACTUAR sem justificativa: 400 (a API exige, não só a tela)", (await postLote(req("POST", "/api/torre/tarefas/lote", tAdmin, { acao: "REPACTUAR", tarefaIds: [a4.tarefaId], novoPrazo: "2026-12-01", justificativa: "" }))).status === 400)
    ok("REPACTUAR sem data: 400", (await postLote(req("POST", "/api/torre/tarefas/lote", tAdmin, { acao: "REPACTUAR", tarefaIds: [a4.tarefaId], justificativa: "x" }))).status === 400)
    ok("cobrar por órgão: comum 403", (await postCobrarOrgao(req("POST", `/api/torre/terceiros/${o1.id}/cobrar`, tComum, {}), ctx({ orgaoId: String(o1.id) }))).status === 403)
    ok("ligação: comum 403", (await postLigacao(req("POST", `/api/torre/tarefas/${a1.tarefaId}/ligacao`, tComum, {}), ctx({ tarefaId: String(a1.tarefaId) }))).status === 403)
    ok("trocar canal: gestor sem tarefas.editar 403", (await postCanal(req("POST", `/api/torre/tarefas/${a2.tarefaId}/canal`, tGestor, { canal: "EMAIL" }), ctx({ tarefaId: String(a2.tarefaId) }))).status === 403)

    secao("A LISTA É A PROJEÇÃO DA OPERAÇÃO (uma fonte)")
    const torre = await listarTarefasDaTorre()
    const oper = await visaoGerencial({ porPagina: 500 })
    const abertasOper = new Set(oper.linhas.filter((l) => l.coluna !== "CONCLUIDA").map((l) => l.taskId))
    const idsTorre = new Set(torre.linhas.map((l) => l.taskId))
    ok("mesmo conjunto de tarefas abertas que a Operação lê", idsTorre.size === abertasOper.size && [...idsTorre].every((id) => abertasOper.has(id)), `${idsTorre.size}`)

    secao("G3 — 'COBRAR TODOS OS VENCIDOS (N)': o N bate com a lista")
    const vencidasDaLista = torre.linhas.filter((l) => ehCobravelVencido(l))
    ok("N do servidor = linhas vencidas da lista", torre.cobrancasVencidas === vencidasDaLista.length && vencidasDaLista.length === 2, `N=${torre.cobrancasVencidas}`)
    ok("são exatamente as tarefas com acompanhamento vencido (a1, a2)", new Set(vencidasDaLista.map((l) => l.taskId)).size === 2 && vencidasDaLista.every((l) => [a1.tarefaId, a2.tarefaId].includes(l.taskId)))
    ok("a tarefa ainda não enviada (a4) NÃO conta como cobrança vencida", !vencidasDaLista.some((l) => l.taskId === a4.tarefaId))
    const rLista = await (await getLista(req("GET", "/api/torre/tarefas", tAdmin))).json()
    ok("a rota devolve o mesmo N", rLista.cobrancasVencidas === 2 && rLista.linhas.filter((l: { cobravelVencida: boolean }) => l.cobravelVencida).length === 2)
    const rVenc = await postCobrarVencidos(req("POST", "/api/operacao/tarefas/cobrar-todos-vencidos", tAdmin, { tarefaIds: vencidasDaLista.map((l) => l.taskId), resultado: "SEM_RESPOSTA" }))
    const jVenc = await rVenc.json()
    ok("a porta EXISTENTE cobra as N (reaproveitada, não duplicada)", jVenc.ok === true && jVenc.cobradas === 2, JSON.stringify(jVenc))

    secao("G3/G4 — canal CADASTRADO e o órgão sempre gravado no contato")
    const contatos1 = await prisma.contatoTerceiro.findMany({ where: { tarefaId: { in: [a1.tarefaId, a2.tarefaId] } }, select: { tarefaId: true, canal: true, orgaoId: true } })
    ok("a1 (órgão com e-mail) cobrada por EMAIL", contatos1.find((x) => x.tarefaId === a1.tarefaId)?.canal === "EMAIL")
    ok("a2 (solicitação por BALCÃO) cobrada por PRESENCIAL", contatos1.find((x) => x.tarefaId === a2.tarefaId)?.canal === "PRESENCIAL")
    ok("o contato carrega o órgão da tarefa (histórico do órgão enxerga)", contatos1.every((x) => x.orgaoId === o1.id))
    const canais = await canaisCadastrados([a3.tarefaId, a5.tarefaId])
    ok("órgão só com telefone → TELEFONE", canais.get(a3.tarefaId)?.canal === "TELEFONE" && canais.get(a3.tarefaId)?.origem === "orgao")
    ok("sem órgão nem solicitação → EMAIL (padrão histórico), marcado como padrão", canais.get(a5.tarefaId)?.canal === "EMAIL" && canais.get(a5.tarefaId)?.origem === "padrao")

    secao("G4 — COBRAR POR CARTÓRIO cobra só aquele órgão")
    const antesO2 = await prisma.contatoTerceiro.count({ where: { tarefaId: a3.tarefaId } })
    const antesO1 = await prisma.contatoTerceiro.count({ where: { tarefaId: { in: [a1.tarefaId, a2.tarefaId, a4.tarefaId] } } })
    const rOrgao = await postCobrarOrgao(req("POST", `/api/torre/terceiros/${o1.id}/cobrar`, tAdmin, {}), ctx({ orgaoId: String(o1.id) }))
    const jOrgao = await rOrgao.json()
    ok("cobra os 2 pedidos que estão COM o órgão 1 (a1, a2)", rOrgao.status === 200 && jOrgao.cobradas === 2, JSON.stringify(jOrgao).slice(0, 160))
    ok("NÃO cobra a tarefa do órgão 2", (await prisma.contatoTerceiro.count({ where: { tarefaId: a3.tarefaId } })) === antesO2)
    ok("NÃO cobra a4 (do órgão 1, mas ainda não enviada — não está com o cartório)", (await prisma.contatoTerceiro.count({ where: { tarefaId: a4.tarefaId } })) === 0)
    ok("2 contatos novos no órgão 1", (await prisma.contatoTerceiro.count({ where: { tarefaId: { in: [a1.tarefaId, a2.tarefaId, a4.tarefaId] } } })) === antesO1 + 2)
    ok("a ação é auditada sob o órgão", (await prisma.logAuditoria.count({ where: { acao: "ORGAO_COBRADO", entidade: "OrgaoProtocolo", entidadeId: o1.id } })) === 1)
    const semPedidos = await c.novoOrgao("Cartório Vazio")
    const rVazio = await postCobrarOrgao(req("POST", `/api/torre/terceiros/${semPedidos.id}/cobrar`, tAdmin, {}), ctx({ orgaoId: String(semPedidos.id) }))
    ok("órgão sem pedido com ele: 422 (não inventa cobrança)", rVazio.status === 422)
    ok("órgão inexistente: 404", (await postCobrarOrgao(req("POST", "/api/torre/terceiros/99999999/cobrar", tAdmin, {}), ctx({ orgaoId: "99999999" }))).status === 404)
    ok("canal inválido: 400", (await postCobrarOrgao(req("POST", `/api/torre/terceiros/${o2.id}/cobrar`, tAdmin, { canal: "POMBO" }), ctx({ orgaoId: String(o2.id) }))).status === 400)
    const rO2 = await postCobrarOrgao(req("POST", `/api/torre/terceiros/${o2.id}/cobrar`, tAdmin, { canal: "TELEFONE", resultado: "CONFIRMOU_PEDIDO", observacao: "confirmou por telefone" }), ctx({ orgaoId: String(o2.id) }))
    ok("canal e resultado escolhidos no formulário valem", rO2.status === 200 && (await prisma.contatoTerceiro.findFirst({ where: { tarefaId: a3.tarefaId, resultado: "CONFIRMOU_PEDIDO" } }))?.canal === "TELEFONE")

    secao("G4 — a lista de TERCEIROS é POR PEDIDO (nada de placar por cartório)")
    const linhasTer = (await listarTarefasDaTorre()).linhas
    const agoraTer = new Date()
    const pedidos = pedidosDeTerceiros(linhasTer, agoraTer)
    const idsPedidos = new Set(pedidos.map((p) => p.taskId))
    ok("os pedidos são as tarefas COM o terceiro (a1, a2, a3, a5); a4 (não enviada) não é pedido", [a1, a2, a3, a5].every((a) => idsPedidos.has(a.tarefaId)) && !idsPedidos.has(a4.tarefaId))
    ok("cada pedido sabe o órgão a quem foi pedido (cadastro de órgãos)", pedidos.find((p) => p.taskId === a1.tarefaId)?.orgaoId === o1.id && pedidos.find((p) => p.taskId === a3.tarefaId)?.orgaoId === o2.id && pedidos.find((p) => p.taskId === a5.tarefaId)?.orgaoId === null)
    ok("o pedido carrega 'pedida há' e 'cobrar em' (sem placar: nada de média, ranking ou 'sem resposta' por órgão)", pedidos.every((p) => typeof p.pedidaHa === "string" && typeof p.cobrarEm.texto === "string" && !("semResposta" in p) && !("naoLocalizada" in p) && !("regua" in p)))
    const resumo = resumoDeTerceiros(linhasTer, agoraTer)
    ok("cartão 'aguardando terceiros' = o MESMO número da Visão geral / aba Tarefas (numeroDoKpi cartorio)", resumo.aguardando === numeroDoKpi("cartorio", linhasTer, agoraTer))
    ok("cartões 2–4 repartem o cartão 1", resumo.comCartorios + resumo.comOCliente + resumo.tradutora + resumo.juizo + resumo.consulado === resumo.aguardando)
    ok("'para cobrar hoje ou vencidas' cobre pelo menos as vencidas da Operação (a1, a2)", resumo.paraCobrar >= linhasTer.filter((l) => l.cobravelVencida).length)

    secao("G4 — a Régua por órgão (cadastro, nunca 'tempo aprendido') — sem placar por cartório")
    const rTer = await (await getTerceiros(req("GET", "/api/torre/terceiros", tAdmin))).json()
    const linhaO1 = rTer.orgaos.find((o: { orgaoId: number }) => o.orgaoId === o1.id)
    ok("o órgão 1 aparece com seus pedidos em aberto (a1, a2, a4)", linhaO1?.emAberto === 3 && linhaO1?.aguardando === 2, JSON.stringify({ e: linhaO1?.emAberto, a: linhaO1?.aguardando }))
    ok("a coluna Régua vem do cadastro (texto), sem mediana/pior caso", typeof linhaO1?.regua === "string" && /régua/i.test(linhaO1.regua) && !/median|pior caso|aprendid/i.test(linhaO1.regua), linhaO1?.regua)
    ok("a rota não devolve nenhum campo de tempo aprendido", !("tempoAprendido" in (linhaO1 ?? {})) && !("mediana" in (linhaO1 ?? {})))
    ok("a rota NÃO devolve 'sem resposta' nem 'não localizada' por órgão (placar removido)", !("semResposta" in (linhaO1 ?? {})) && !("naoLocalizada" in (linhaO1 ?? {})))
    ok("UF e canal do cadastro", linhaO1?.uf === "SP" && ["EMAIL", "PRESENCIAL"].includes(linhaO1?.canal))
    const soBanco = await listarTerceiros((await listarTarefasDaTorre()).linhas)
    ok("mesma lista que a função de serviço", soBanco.length === rTer.orgaos.length)

    secao("G4/G5 — CONTATOS do órgão (histórico, mesmos registros do Andamento)")
    const rContO = await (await getContatos(req("GET", `/api/torre/terceiros/${o1.id}/contatos`, tAdmin), ctx({ orgaoId: String(o1.id) }))).json()
    ok("lista os contatos do órgão 1 (2 pela porta de vencidos + 2 pela cobrança por órgão)", rContO.contatos.filter((x: { tipo: string }) => x.tipo === "CONTATO").length === 4, `${rContO.contatos.length}`)
    ok("órgão inexistente: sem órgão", (await contatosDoOrgao(99999999)).orgao === null)

    secao("G4/G5 — CONTATOS do PEDIDO")
    const rCont = await (await getContatosDoPedido(req("GET", `/api/torre/terceiros/pedidos/${a1.tarefaId}/contatos`, tAdmin), ctx({ tarefaId: String(a1.tarefaId) }))).json()
    ok("lista os 2 contatos do pedido a1 (1 pela porta de vencidos + 1 pela cobrança por órgão), mais o envio do pedido", rCont.contatos.filter((x: { tipo: string }) => x.tipo === "CONTATO").length === 2, `${rCont.contatos.length}`)
    ok("cada contato é uma frase pronta: 'Fulano cobrou por e-mail · sem resposta'", rCont.contatos.filter((x: { tipo: string }) => x.tipo === "CONTATO").every((x: { texto: string }) => /cobrou por e-mail · sem resposta/.test(x.texto)))
    ok("do mais novo ao mais antigo", rCont.contatos.every((x: { quando: string }, i: number, arr: Array<{ quando: string }>) => i === 0 || arr[i - 1].quando >= x.quando))
    ok("o contato de a3 NÃO aparece no pedido a1 (histórico é do pedido)", !JSON.stringify(rCont).includes("contato:" + (await prisma.contatoTerceiro.findFirstOrThrow({ where: { tarefaId: a3.tarefaId }, select: { id: true } })).id))
    // Contato ANTIGO, sem orgaoId gravado (anterior a esta entrega): é do PEDIDO pela tarefa — aparece, uma vez.
    const corrente = await prisma.subtaskExecution.findFirstOrThrow({ where: { stepInstanceId: a1.stepInstanceId, subtaskKey: "aguardar_retorno", supersededAt: null }, select: { id: true } })
    const antigo = await prisma.contatoTerceiro.create({ data: { subtaskExecutionId: corrente.id, tarefaId: a1.tarefaId, canal: "EMAIL", resultado: "EM_BUSCA", observacao: `${MARCA} legado sem órgão`, orgaoId: null } })
    const rCont2 = await contatosDoPedido(a1.tarefaId)
    ok("contato antigo (orgaoId nulo) aparece pela tarefa, UMA vez, com a observação entre aspas", rCont2!.contatos.filter((x) => x.id === `contato:${antigo.id}`).length === 1 && rCont2!.contatos.find((x) => x.id === `contato:${antigo.id}`)!.texto.includes(`"${MARCA} legado sem órgão"`))
    ok("pedido inexistente: 404 / null", (await contatosDoPedido(99999999)) === null && (await getContatosDoPedido(req("GET", "/api/torre/terceiros/pedidos/99999999/contatos", tAdmin), ctx({ tarefaId: "99999999" }))).status === 404)
    ok("contatos do pedido: comum 403 (não é gestor da Torre)", (await getContatosDoPedido(req("GET", `/api/torre/terceiros/pedidos/${a1.tarefaId}/contatos`, tComum), ctx({ tarefaId: String(a1.tarefaId) }))).status === 403)

    secao("G5 — REGISTRAR LIGAÇÃO liga o histórico da tarefa e do órgão, sem duplicar")
    const antesLig = await prisma.contatoTerceiro.count({ where: { tarefaId: a2.tarefaId } })
    const rLig = await postLigacao(req("POST", `/api/torre/tarefas/${a2.tarefaId}/ligacao`, tAdmin, { resultado: "EM_BUSCA", observacao: "ligou e pediram 2 dias" }), ctx({ tarefaId: String(a2.tarefaId) }))
    const jLig = await rLig.json()
    ok("ligação registrada", rLig.status === 200 && jLig.ok === true, JSON.stringify(jLig))
    ok("UM contato novo (sem duplicar)", (await prisma.contatoTerceiro.count({ where: { tarefaId: a2.tarefaId } })) === antesLig + 1)
    const contatoLig = await prisma.contatoTerceiro.findUniqueOrThrow({ where: { id: jLig.contatoId } })
    ok("canal TELEFONE, resultado escolhido e órgão da tarefa gravados", contatoLig.canal === "TELEFONE" && contatoLig.resultado === "EM_BUSCA" && contatoLig.orgaoId === o1.id && contatoLig.documentoId === a2.documentoId)
    ok("resultado inválido: recusa", (await postLigacao(req("POST", `/api/torre/tarefas/${a2.tarefaId}/ligacao`, tAdmin, { resultado: "TALVEZ" }), ctx({ tarefaId: String(a2.tarefaId) }))).status === 422)
    const andamento = await montarAndamentoDaOperacao(a2.documentoId!)
    const evLig = andamento.filter((e) => e.id === `contato:${contatoLig.id}`)
    ok("aparece no ANDAMENTO da tarefa, uma vez, como 'Ligação ao terceiro'", evLig.length === 1 && evLig[0].titulo === "Ligação ao terceiro" && /não localizou|em busca/.test(evLig[0].descricao ?? ""))
    const histO = await contatosDoPedido(a2.tarefaId)
    ok("aparece nos CONTATOS do pedido, uma vez, como 'ligou'", histO!.contatos.filter((x) => x.id === `contato:${contatoLig.id}`).length === 1 && /ligou · em busca · "ligou e pediram 2 dias"/.test(histO!.contatos.find((x) => x.id === `contato:${contatoLig.id}`)!.texto))
    ok("a cobrança de a2 também está no Andamento (mesmo registro, duas projeções)", andamento.some((e) => e.tipo === "CONTATO_TERCEIRO" && e.titulo === "Cobrança ao terceiro"))

    secao("G5 — TROCAR CANAL: uma linha, visível na tarefa e nos contatos do pedido")
    const sol = await prisma.solicitacaoDocumento.findFirstOrThrow({ where: { tarefaId: a2.tarefaId }, select: { id: true, canal: true } })
    ok("a solicitação nasceu com BALCÃO", sol.canal === "BALCAO")
    const rCanal = await postCanal(req("POST", `/api/torre/tarefas/${a2.tarefaId}/canal`, tAdmin, { canal: "EMAIL" }), ctx({ tarefaId: String(a2.tarefaId) }))
    ok("canal trocado na SOLICITAÇÃO (não só na tela)", rCanal.status === 200 && (await prisma.solicitacaoDocumento.findUniqueOrThrow({ where: { id: sol.id } })).canal === "EMAIL")
    const logsCanal = await prisma.logAuditoria.findMany({ where: { acao: "SOLICITACAO_CANAL_ALTERADO" } })
    ok("exatamente UMA linha de auditoria, sob a tarefa, com solicitação e órgão", logsCanal.length === 1 && logsCanal[0].entidade === "Tarefa" && logsCanal[0].entidadeId === a2.tarefaId
      && (logsCanal[0].detalhes as { solicitacaoId?: number; orgaoId?: number })?.solicitacaoId === sol.id && (logsCanal[0].detalhes as { orgaoId?: number })?.orgaoId === o1.id)
    const andamento2 = await montarAndamentoDaOperacao(a2.documentoId!)
    ok("aparece no ANDAMENTO da tarefa", andamento2.some((e) => e.tipo === "SOLICITACAO_CANAL_ALTERADO" && e.titulo === "Canal da solicitação alterado" && e.categoria === "solicitacao"))
    const histO2 = await contatosDoPedido(a2.tarefaId)
    ok("aparece nos CONTATOS do pedido, uma vez", histO2!.contatos.filter((x) => x.tipo === "CANAL_ALTERADO").length === 1)
    ok("o envio do pedido (SolicitacaoDocumento) é uma linha dos contatos: 'enviou o pedido pelo …'", histO2!.contatos.filter((x) => x.tipo === "PEDIDO").length === 1 && /enviou o pedido pelo/.test(histO2!.contatos.find((x) => x.tipo === "PEDIDO")!.texto))
    ok("trocar para o MESMO canal: recusa (não polui a auditoria)", (await postCanal(req("POST", `/api/torre/tarefas/${a2.tarefaId}/canal`, tAdmin, { canal: "EMAIL" }), ctx({ tarefaId: String(a2.tarefaId) }))).status === 422)
    ok("canal inválido: recusa", (await postCanal(req("POST", `/api/torre/tarefas/${a2.tarefaId}/canal`, tAdmin, { canal: "POMBO" }), ctx({ tarefaId: String(a2.tarefaId) }))).status === 422)
    ok("sem solicitação: recusa", (await postCanal(req("POST", `/api/torre/tarefas/${a3.tarefaId}/canal`, tAdmin, { canal: "EMAIL" }), ctx({ tarefaId: String(a3.tarefaId) }))).status === 422)

    secao("G2 — 'INICIAR' só para quem realmente pode (lista E API)")
    const listaG2 = (await listarTarefasDaTorre()).linhas
    const linha = (id: number) => listaG2.find((l) => l.taskId === id)!
    ok("a4 (não enviada, fase atual, órgão vinculado, sem bloqueio) PODE iniciar", linha(a4.tarefaId).podeIniciar === true, String(linha(a4.tarefaId).motivoNaoIniciar))
    ok("a1 (já enviada, com o cartório) NÃO pode", linha(a1.tarefaId).podeIniciar === false)
    const semOrgao = await c.novaObrigacao({})
    const outraFase = await c.novaObrigacao({ orgaoId: o1.id })
    await prisma.processo.update({ where: { id: outraFase.processoId }, data: { faseAtualKey: "genealogia" } })
    const bloqueada = await c.novaObrigacao({ orgaoId: o1.id })
    await prisma.tarefa.update({ where: { id: bloqueada.tarefaId }, data: { statusTarefa: "BLOQUEADA" } })
    const l2 = (await listarTarefasDaTorre()).linhas
    const lin2 = (id: number) => l2.find((l) => l.taskId === id)!
    ok("sem órgão vinculado: NÃO pode, com motivo", lin2(semOrgao.tarefaId).podeIniciar === false && /órgão/.test(lin2(semOrgao.tarefaId).motivoNaoIniciar ?? ""), String(lin2(semOrgao.tarefaId).motivoNaoIniciar))
    ok("tarefa de fase que NÃO é a atual do processo: NÃO pode", lin2(outraFase.tarefaId).podeIniciar === false)
    ok("tarefa bloqueada: NÃO pode", lin2(bloqueada.tarefaId).podeIniciar === false)
    const rNao = await postIniciar(req("POST", `/api/torre/tarefas/${semOrgao.tarefaId}/iniciar`, tAdmin, {}), ctx({ tarefaId: String(semOrgao.tarefaId) }))
    ok("a API recusa o que o botão esconderia (sem órgão) — 422", rNao.status === 422)
    const rNao2 = await postIniciar(req("POST", `/api/torre/tarefas/${outraFase.tarefaId}/iniciar`, tAdmin, {}), ctx({ tarefaId: String(outraFase.tarefaId) }))
    ok("a API recusa tarefa de outra fase — 422", rNao2.status === 422, JSON.stringify(await rNao2.json()))
    ok("iniciar sem tarefas.iniciar_concluir: 403", (await postIniciar(req("POST", `/api/torre/tarefas/${a4.tarefaId}/iniciar`, tGestor, {}), ctx({ tarefaId: String(a4.tarefaId) }))).status === 403)
    const rSim = await postIniciar(req("POST", `/api/torre/tarefas/${a4.tarefaId}/iniciar`, tAdmin, {}), ctx({ tarefaId: String(a4.tarefaId) }))
    ok("a4 inicia PELO MOTOR (200)", rSim.status === 200, JSON.stringify(await rSim.json()))
    const a4Depois = (await listarTarefasDaTorre()).linhas.find((l) => l.taskId === a4.tarefaId)!
    ok("depois de iniciar, a4 está com o cartório e o botão some", a4Depois.estadoOperacao === "AGUARDANDO" && a4Depois.podeIniciar === false)
    ok("iniciar de novo: recusa", (await postIniciar(req("POST", `/api/torre/tarefas/${a4.tarefaId}/iniciar`, tAdmin, {}), ctx({ tarefaId: String(a4.tarefaId) }))).status === 422)

    secao("G2 — o predicado (tabela de verdade)")
    const base = { statusTarefa: "NAO_INICIADA", aIniciar: true, faseMacroKey: "f", faseAtualKey: "f", aguardandoDependencia: false, temOrgao: true }
    ok("tudo certo → pode", motivoDeNaoPoderIniciar(base) === null)
    ok("já iniciada → não", motivoDeNaoPoderIniciar({ ...base, statusTarefa: "EM_ANDAMENTO" }) !== null)
    ok("bloqueada → não", /bloqueada/.test(motivoDeNaoPoderIniciar({ ...base, statusTarefa: "BLOQUEADA" }) ?? ""))
    ok("dependência aberta → não", motivoDeNaoPoderIniciar({ ...base, aguardandoDependencia: true }) !== null)
    ok("fase deixada → não", motivoDeNaoPoderIniciar({ ...base, faseAtualKey: "g" }) !== null)
    ok("fase futura → não", motivoDeNaoPoderIniciar({ ...base, faseMacroKey: "h" }) !== null)
    ok("sem fase atual conhecida → não", motivoDeNaoPoderIniciar({ ...base, faseAtualKey: null }) !== null)
    ok("não é ponto de entrada → não", motivoDeNaoPoderIniciar({ ...base, aIniciar: false }) !== null)
    ok("sem órgão → não", motivoDeNaoPoderIniciar({ ...base, temOrgao: false }) !== null)
  } finally {
    await c.limpar()
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())

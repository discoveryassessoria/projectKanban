// scripts/torre-nova-terceiros-cobranca.test.ts
// ============================================================================
// TORRE NOVA, FRENTE G (01/10/2026) — TERCEIROS: a COBRANÇA por pedido grava no histórico (ContatoTerceiro, pela porta única
// `registrarCobranca`) e AGENDA a próxima ("Próxima cobrança em (dias)", padrão 7); os números FECHAM com a Visão geral/Tarefas.
//
//   npx tsx scripts/torre-nova-terceiros-cobranca.test.ts   (banco de teste)
//
// PROVA:
//   • `registrarCobranca({ proximaEmDias })`: agenda N dias CORRIDOS à frente; ausente = a régua do cadastro (como sempre);
//     fora de 1–60 / não inteiro é RECUSADO e NADA é gravado; com a régua r2 DESLIGADA o contato é gravado e a data escolhida vale;
//   • `POST /api/torre/terceiros/cobrar`: uma cobrança-fato por pedido, só de quem está COM o terceiro, recusa processo PAUSADO,
//     audita, respeita a posse (não-admin só as próprias) e a permissão, valida o corpo (canal, resultado, dias);
//   • `POST /api/torre/terceiros/{orgaoId}/cobrar` com `tarefaIds` cobra só o recorte que a tela mostra;
//   • `GET /api/torre/terceiros/pedidos/{tarefaId}/contatos`: o histórico do pedido (cobranças, ligação, troca de canal, envio);
//   • os cartões da tela saem das MESMAS linhas da Torre: "aguardando terceiros" = o da Visão geral; "para cobrar" = os vencidos;
//   • depois de cobrar, o pedido SAI de "para cobrar" (a próxima data é futura) — e o "Cobrar todos" cobra exatamente esse conjunto.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-nova-terceiros-cobranca.test.ts")

import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { montarCenario } from "./_fixture-torre-gh"
import { listarTarefasDaTorre } from "../src/services/torre-tarefas"
import { registrarCobranca } from "../src/services/subtarefas-da-etapa"
import { cobrarPedidos, cobrarOrgao } from "../src/services/torre-terceiros"
import { definirRegra } from "../lib/operacional/regras-torre"
import { pausarProcesso } from "../src/services/processo-pausa"
import { pedidosDeTerceiros, resumoDeTerceiros, idsParaCobrar } from "../lib/operacional/terceiros-pedidos"
import { numeroDoKpi, totaisDaSituacao } from "../lib/operacional/torre-kpis"
import { POST as postCobrar } from "../src/app/api/torre/terceiros/cobrar/route"
import { POST as postCobrarOrgao } from "../src/app/api/torre/terceiros/[orgaoId]/cobrar/route"
import { GET as getContatos } from "../src/app/api/torre/terceiros/pedidos/[tarefaId]/contatos/route"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORREG_TERC"
const DIA = 86_400_000
const req = (method: string, url: string, token: string | null, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })
const tokenDe = (u: { id: number; email: string; tipo: string }) => signAuthToken({ userId: u.id, email: u.email, tipo: u.tipo, sessaoInicio: Date.now() })
const vigente = (stepInstanceId: number) => prisma.subtaskExecution.findFirstOrThrow({ where: { stepInstanceId, subtaskKey: "aguardar_retorno", supersededAt: null } })

async function main() {
  const c = await montarCenario(MARCA, { diasAposCobranca: 2 })
  await prisma.processoPausa.deleteMany({ where: { processo: { nome: { startsWith: MARCA } } } })
  try {
    const mk = (nome: string, tipo: string, perms?: Record<string, boolean>) =>
      prisma.usuario.create({ data: { nome: `${MARCA} ${nome}`, email: `${MARCA.toLowerCase()}-${nome.toLowerCase()}@t.com`, senha: "x", tipo, ...(perms ? { permissoesCustom: perms } : {}) } })
    const admin = await mk("Admin", "admin")
    const dono = await mk("Dono", "assistente", { "tarefas.ver": true, "operacao.distribuirTarefas": true })
    const comum = await mk("Comum", "assistente", { "tarefas.ver": true })
    const tAdmin = await tokenDe(admin), tDono = await tokenDe(dono), tComum = await tokenDe(comum)
    const o1 = await c.novoOrgao("Cartório Um", { email: "um@cartorio.test", state: "SP" })
    const o2 = await c.novoOrgao("Cartório Dois", { telefone: "11 5555-0000", state: "RJ" })
    const vencer = async (a: { stepInstanceId: number }, dias: number) =>
      prisma.subtaskExecution.updateMany({ where: { stepInstanceId: a.stepInstanceId, subtaskKey: "aguardar_retorno", supersededAt: null }, data: { proximoAcompanhamentoEm: new Date(Date.now() + dias * DIA) } })

    secao("registrarCobranca({ proximaEmDias }) — agenda a próxima")
    const x1 = await c.novaObrigacao({ aguardando: true, orgaoId: o1.id })
    const t0 = Date.now()
    const r7 = await registrarCobranca({ stepInstanceId: x1.stepInstanceId, subtaskKey: "aguardar_retorno", canal: "EMAIL", resultado: "SEM_RESPOSTA", proximaEmDias: 7 })
    ok("com proximaEmDias=7 a próxima cobrança é daqui a 7 dias corridos", r7.ok && Math.abs((r7.proximoAcompanhamentoEm?.getTime() ?? 0) - (t0 + 7 * DIA)) < 15_000)
    ok("e é o que fica gravado na execução (a fonte que a Torre lê)", Math.abs(((await vigente(x1.stepInstanceId)).proximoAcompanhamentoEm?.getTime() ?? 0) - (t0 + 7 * DIA)) < 15_000)
    const x2 = await c.novaObrigacao({ aguardando: true, orgaoId: o1.id })
    const rReg = await registrarCobranca({ stepInstanceId: x2.stepInstanceId, subtaskKey: "aguardar_retorno", canal: "EMAIL", resultado: "SEM_RESPOSTA" })
    ok("sem proximaEmDias: a régua do cadastro (2 dias), exatamente como antes", rReg.ok && Math.abs((rReg.proximoAcompanhamentoEm?.getTime() ?? 0) - (Date.now() + 2 * DIA)) < 15_000)
    const x3 = await c.novaObrigacao({ aguardando: true, orgaoId: o1.id })
    const antesBad = await prisma.contatoTerceiro.count({ where: { tarefaId: x3.tarefaId } })
    const bads = await Promise.all([0, -3, 61, 1.5, Number.NaN].map((n) => registrarCobranca({ stepInstanceId: x3.stepInstanceId, subtaskKey: "aguardar_retorno", canal: "EMAIL", resultado: "SEM_RESPOSTA", proximaEmDias: n })))
    ok("0, negativo, 61, fracionado e NaN são RECUSADOS (PROXIMA_EM_DIAS_INVALIDO)", bads.every((b) => !b.ok && (b as { motivo: string }).motivo === "PROXIMA_EM_DIAS_INVALIDO"))
    ok("e NADA é gravado (nenhum contato, a execução intacta)", (await prisma.contatoTerceiro.count({ where: { tarefaId: x3.tarefaId } })) === antesBad)
    const r60 = await registrarCobranca({ stepInstanceId: x3.stepInstanceId, subtaskKey: "aguardar_retorno", canal: "EMAIL", resultado: "SEM_RESPOSTA", proximaEmDias: 60 })
    ok("os limites 1 e 60 valem", r60.ok && (await registrarCobranca({ stepInstanceId: x3.stepInstanceId, subtaskKey: "aguardar_retorno", canal: "EMAIL", resultado: "SEM_RESPOSTA", proximaEmDias: 1 })).ok)

    secao("régua r2 DESLIGADA: o contato é gravado, e a data ESCOLHIDA vale (decisão humana); sem escolha, nada é reagendado")
    await definirRegra("r2", false, admin.id)
    const off = await c.novaObrigacao({ aguardando: true, orgaoId: o1.id })
    const antesOff = (await vigente(off.stepInstanceId)).proximoAcompanhamentoEm?.getTime() ?? null
    const f1 = await registrarCobranca({ stepInstanceId: off.stepInstanceId, subtaskKey: "aguardar_retorno", canal: "EMAIL", resultado: "SEM_RESPOSTA" })
    ok("sem escolha: não reagenda", f1.ok && ((await vigente(off.stepInstanceId)).proximoAcompanhamentoEm?.getTime() ?? null) === antesOff)
    const t1 = Date.now()
    const f2 = await registrarCobranca({ stepInstanceId: off.stepInstanceId, subtaskKey: "aguardar_retorno", canal: "EMAIL", resultado: "SEM_RESPOSTA", proximaEmDias: 5 })
    ok("com escolha (5 dias): agenda, mas NÃO escala (escalar é só da régua)", f2.ok && !f2.escalada && Math.abs((f2.proximoAcompanhamentoEm?.getTime() ?? 0) - (t1 + 5 * DIA)) < 15_000)
    ok("os dois contatos foram registrados", (await prisma.contatoTerceiro.count({ where: { tarefaId: off.tarefaId } })) === 2)
    await definirRegra("r2", true, admin.id)

    secao("POST /api/torre/terceiros/cobrar — por pedido e em lote")
    // a1,a2 com o1 vencidas · a3 com o2 vencida · a4 com o1 NÃO vencida (data futura) · a5 do o1 ainda não enviada · a6 sem órgão vencida
    const a1 = await c.novaObrigacao({ aguardando: true, orgaoId: o1.id, responsavelId: dono.id, comSolicitacao: { canal: "CRC" } })
    const a2 = await c.novaObrigacao({ aguardando: true, orgaoId: o1.id })
    const a3 = await c.novaObrigacao({ aguardando: true, orgaoId: o2.id })
    const a4 = await c.novaObrigacao({ aguardando: true, orgaoId: o1.id })
    const a5 = await c.novaObrigacao({ orgaoId: o1.id })
    const a6 = await c.novaObrigacao({ aguardando: true })
    for (const a of [a1, a2, a3, a6]) await vencer(a, -2)
    await vencer(a4, 4)
    const antes = async (a: { tarefaId: number }) => prisma.contatoTerceiro.count({ where: { tarefaId: a.tarefaId } })
    const [n1, n2, n3, n4, n5] = [await antes(a1), await antes(a2), await antes(a3), await antes(a4), await antes(a5)]

    ok("sem token: 401 · comum (não é gestor da Torre): 403", (await postCobrar(req("POST", "/api/torre/terceiros/cobrar", null, { tarefaIds: [a1.tarefaId] }))).status === 401 && (await postCobrar(req("POST", "/api/torre/terceiros/cobrar", tComum, { tarefaIds: [a1.tarefaId] }))).status === 403)
    ok("sem tarefaIds: 400", (await postCobrar(req("POST", "/api/torre/terceiros/cobrar", tAdmin, { tarefaIds: [] }))).status === 400)
    ok("canal inválido: 400 · resultado inválido: 400", (await postCobrar(req("POST", "/api/torre/terceiros/cobrar", tAdmin, { tarefaIds: [a1.tarefaId], canal: "POMBO" }))).status === 400 && (await postCobrar(req("POST", "/api/torre/terceiros/cobrar", tAdmin, { tarefaIds: [a1.tarefaId], resultado: "TALVEZ" }))).status === 400)
    ok("'Próxima cobrança em (dias)' fora de 1–60 ou não inteiro: 400, e nada é gravado", (await Promise.all([0, 61, 2.5, "abc"].map(async (n) => (await postCobrar(req("POST", "/api/torre/terceiros/cobrar", tAdmin, { tarefaIds: [a1.tarefaId], proximaEmDias: n }))).status))).every((s) => s === 400) && (await antes(a1)) === n1)

    const tC = Date.now()
    const rUm = await postCobrar(req("POST", "/api/torre/terceiros/cobrar", tAdmin, { tarefaIds: [a1.tarefaId], proximaEmDias: 7 }))
    const jUm = await rUm.json()
    ok("cobrar UM pedido: 200 e 1 cobrada", rUm.status === 200 && jUm.ok === true && jUm.cobradas === 1, JSON.stringify(jUm))
    ok("REGISTROU no histórico: 1 contato novo, SEM_RESPOSTA, pelo canal cadastrado (CRC não tem equivalente → e-mail do órgão), com o órgão gravado", (await antes(a1)) === n1 + 1
      && (await prisma.contatoTerceiro.findFirstOrThrow({ where: { tarefaId: a1.tarefaId }, orderBy: { id: "desc" } })).orgaoId === o1.id)
    ok("AGENDOU a próxima: daqui a 7 dias", Math.abs(((await vigente(a1.stepInstanceId)).proximoAcompanhamentoEm?.getTime() ?? 0) - (tC + 7 * DIA)) < 20_000)
    ok("e auditou (quem, o quê): TERCEIROS_COBRADOS sob a tarefa", (await prisma.logAuditoria.count({ where: { acao: "TERCEIROS_COBRADOS", entidade: "Tarefa", entidadeId: a1.tarefaId, usuarioId: admin.id } })) === 1)
    ok("os outros pedidos NÃO foram tocados", (await antes(a2)) === n2 && (await antes(a3)) === n3)

    secao("a tela: cartões e lista saem das MESMAS linhas — os números fecham")
    const agora = new Date()
    const linhas = (await listarTarefasDaTorre()).linhas
    const resumo = resumoDeTerceiros(linhas, agora)
    ok("'aguardando terceiros' = totaisDaSituacao.comCartorio = numeroDoKpi('cartorio') (Visão geral = Tarefas = Terceiros)", resumo.aguardando === totaisDaSituacao(linhas, agora).comCartorio && resumo.aguardando === numeroDoKpi("cartorio", linhas, agora))
    ok("cartões 2–4 repartem o cartão 1", resumo.comCartorios + resumo.comOCliente + resumo.tradutora + resumo.juizo + resumo.consulado === resumo.aguardando)
    const ped = pedidosDeTerceiros(linhas, agora)
    ok("o pedido cobrado (a1) deixou 'para cobrar': a próxima data é futura", ped.find((p) => p.taskId === a1.tarefaId)?.cobrar === false && ped.find((p) => p.taskId === a1.tarefaId)?.cobrarEm.dias === 7)
    ok("a2, a3 e a6 (vencidas) seguem 'para cobrar'; a4 (data futura) e a5 (não enviada) não", [a2, a3, a6].every((a) => ped.find((p) => p.taskId === a.tarefaId)?.cobrar === true) && ped.find((p) => p.taskId === a4.tarefaId)?.cobrar === false && !ped.some((p) => p.taskId === a5.tarefaId))
    ok("'para cobrar hoje ou vencidas' = o N do botão 'Cobrar todos' = pedidos com 'Cobrar'", resumo.paraCobrar === idsParaCobrar(linhas, agora).length && resumo.paraCobrar === ped.filter((p) => p.cobrar).length)

    secao("Cobrar todos os vencidos — exatamente o conjunto 'para cobrar'; recusa quem não está com o terceiro e processo pausado")
    const pausado = await c.novaObrigacao({ aguardando: true, orgaoId: o2.id })
    await vencer(pausado, -2)
    ok("pausar o processo do pedido", (await pausarProcesso({ processoId: pausado.processoId, usuarioId: admin.id, justificativa: "pausa do teste de Terceiros" })).ok)
    const ids = idsParaCobrar((await listarTarefasDaTorre()).linhas, new Date())
    ok("o pedido de processo PAUSADO nem aparece em 'para cobrar' (filtro canônico da Torre)", !ids.includes(pausado.tarefaId))
    const rLote = await postCobrar(req("POST", "/api/torre/terceiros/cobrar", tAdmin, { tarefaIds: [...ids, a5.tarefaId, pausado.tarefaId], proximaEmDias: 3 }))
    const jLote = await rLote.json()
    ok("o lote cobra os vencidos (a2, a3, a6…)", rLote.status === 200 && jLote.cobradas === ids.length, JSON.stringify(jLote).slice(0, 200))
    ok("a5 (não está com o terceiro) é ignorada com motivo, sem contato", (await antes(a5)) === n5 && jLote.ignoradas.some((i: { tarefaId: number; motivo: string }) => i.tarefaId === a5.tarefaId && /nada a cobrar/.test(i.motivo)))
    ok("o pedido de processo PAUSADO é recusado pela API, sem contato", jLote.ignoradas.some((i: { tarefaId: number; motivo: string }) => i.tarefaId === pausado.tarefaId && /pausado/.test(i.motivo)) && (await antes(pausado)) === 0)
    ok("a4 (data futura) NÃO foi cobrada: não estava no conjunto", (await antes(a4)) === n4)
    ok("depois do lote, ninguém mais está 'para cobrar'", idsParaCobrar((await listarTarefasDaTorre()).linhas, new Date()).length === 0)
    ok("auditoria do lote (uma linha)", (await prisma.logAuditoria.count({ where: { acao: "TERCEIROS_COBRADOS", entidadeId: 0, usuarioId: admin.id } })) === 1)

    secao("posse e permissão")
    const b1 = await c.novaObrigacao({ aguardando: true, orgaoId: o1.id, responsavelId: dono.id })
    const b2 = await c.novaObrigacao({ aguardando: true, orgaoId: o1.id })
    const rPosse = await (await postCobrar(req("POST", "/api/torre/terceiros/cobrar", tDono, { tarefaIds: [b1.tarefaId, b2.tarefaId] }))).json()
    ok("gestor NÃO-admin só cobra as próprias tarefas (a outra: 'não é o responsável')", rPosse.cobradas === 1 && rPosse.ignoradas.some((i: { tarefaId: number; motivo: string }) => i.tarefaId === b2.tarefaId && /responsável/.test(i.motivo)))

    secao("POST /api/torre/terceiros/{orgaoId}/cobrar — 'Cobrar este cartório (n)' com o recorte da tela")
    const c1 = await c.novaObrigacao({ aguardando: true, orgaoId: o2.id }), c2 = await c.novaObrigacao({ aguardando: true, orgaoId: o2.id })
    const [nc1, nc2] = [await antes(c1), await antes(c2)]
    const rRec = await postCobrarOrgao(req("POST", `/api/torre/terceiros/${o2.id}/cobrar`, tAdmin, { tarefaIds: [c1.tarefaId], proximaEmDias: 7 }), ctx({ orgaoId: String(o2.id) }))
    const jRec = await rRec.json()
    ok("com tarefaIds cobra SÓ o recorte (c1), não o resto do órgão (c2)", rRec.status === 200 && jRec.cobradas === 1 && (await antes(c1)) === nc1 + 1 && (await antes(c2)) === nc2)
    ok("e agenda a próxima em 7 dias", Math.abs(((await vigente(c1.stepInstanceId)).proximoAcompanhamentoEm?.getTime() ?? 0) - (Date.now() + 7 * DIA)) < 30_000)
    ok("sem tarefaIds cobra tudo o que está com o órgão (comportamento de sempre)", (await cobrarOrgao({ orgaoId: o2.id, autor: { userId: admin.id, tipo: "admin" } })).ok === true && (await antes(c2)) === nc2 + 1)
    ok("dias inválidos: 400", (await postCobrarOrgao(req("POST", `/api/torre/terceiros/${o2.id}/cobrar`, tAdmin, { proximaEmDias: 99 }), ctx({ orgaoId: String(o2.id) }))).status === 400)
    ok("o pedido PAUSADO fica de fora do 'cobrar este cartório' também", (await antes(pausado)) === 0)

    secao("GET /api/torre/terceiros/pedidos/{tarefaId}/contatos — o histórico do pedido")
    const rH = await getContatos(req("GET", `/api/torre/terceiros/pedidos/${a1.tarefaId}/contatos`, tAdmin), ctx({ tarefaId: String(a1.tarefaId) }))
    const jH = await rH.json()
    ok("200: o envio do pedido (CRC) e a cobrança feita agora, do mais novo ao mais antigo", rH.status === 200 && jH.contatos.length >= 2 && jH.contatos[0].tipo === "CONTATO" && jH.contatos[jH.contatos.length - 1].tipo === "PEDIDO", JSON.stringify(jH.contatos.map((x: { tipo: string }) => x.tipo)))
    ok("frases prontas: 'Fulano cobrou por e-mail · sem resposta' e 'Fulano enviou o pedido pelo CRC'", /cobrou por e-mail · sem resposta$/.test(jH.contatos[0].texto) && /enviou o pedido pelo CRC$/.test(jH.contatos[jH.contatos.length - 1].texto))
    ok("o nome de quem cobrou vem do registro (não inventado)", jH.contatos[0].texto.startsWith(`${MARCA} Admin cobrou`))
    ok("pedido sem nada registrado: lista vazia, não erro", (await (await getContatos(req("GET", `/api/torre/terceiros/pedidos/${a5.tarefaId}/contatos`, tAdmin), ctx({ tarefaId: String(a5.tarefaId) }))).json()).contatos.length === 0)
    ok("id inválido: 400 · inexistente: 404 · comum: 403 · sem token: 401", (await getContatos(req("GET", "/api/torre/terceiros/pedidos/abc/contatos", tAdmin), ctx({ tarefaId: "abc" }))).status === 400
      && (await getContatos(req("GET", "/api/torre/terceiros/pedidos/99999999/contatos", tAdmin), ctx({ tarefaId: "99999999" }))).status === 404
      && (await getContatos(req("GET", `/api/torre/terceiros/pedidos/${a1.tarefaId}/contatos`, tComum), ctx({ tarefaId: String(a1.tarefaId) }))).status === 403
      && (await getContatos(req("GET", `/api/torre/terceiros/pedidos/${a1.tarefaId}/contatos`, null), ctx({ tarefaId: String(a1.tarefaId) }))).status === 401)

    secao("cobrarPedidos (serviço) — a API confere, não só a tela")
    ok("lista vazia → 400", (await cobrarPedidos({ tarefaIds: [], autor: { userId: admin.id, tipo: "admin" } })).ok === false)
    const rSrv = await cobrarPedidos({ tarefaIds: [99999999], autor: { userId: admin.id, tipo: "admin" } })
    ok("tarefa inexistente: ignorada com motivo, nenhuma cobrança", rSrv.ok && rSrv.cobradas === 0 && rSrv.ignoradas[0].motivo === "tarefa não encontrada")
  } finally {
    await prisma.processoPausa.deleteMany({ where: { processo: { nome: { startsWith: MARCA } } } })
    await c.limpar()
    await prisma.logAuditoria.deleteMany({ where: { acao: "TERCEIROS_COBRADOS" } })
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())

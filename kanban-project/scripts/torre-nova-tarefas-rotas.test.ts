// scripts/torre-nova-tarefas-rotas.test.ts
// ============================================================================
// ABA TAREFAS DA TORRE NOVA — as ROTAS novas contra o banco de teste (fixture _fixture-torre-gh).
//   npx tsx scripts/torre-nova-tarefas-rotas.test.ts   (banco de teste)
// PROVA: canceladas (só exibição: fora da lista principal, com quem/quando/por quê) · feito (equipe, 14 dias) · gaveta (passos e histórico
// REAIS) · cobrar uma linha (justificativa obrigatória → observação do contato; devolve o próximo acompanhamento) · cobrar cliente ·
// trocar canal com justificativa · vincular órgão (só audita quem de fato tem o órgão) · visão salva com justificativa · permissões.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-nova-tarefas-rotas.test.ts")

import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { montarCenario } from "./_fixture-torre-gh"
import { cancelarTarefa } from "../lib/operacional/tarefa-ciclo"
import { GET as getLista } from "../src/app/api/torre/tarefas/route"
import { GET as getCanceladas } from "../src/app/api/torre/tarefas/canceladas/route"
import { GET as getFeito } from "../src/app/api/torre/tarefas/feito/route"
import { GET as getGaveta } from "../src/app/api/torre/tarefas/[tarefaId]/gaveta/route"
import { POST as postCobrar } from "../src/app/api/torre/tarefas/[tarefaId]/cobrar/route"
import { POST as postCobrarCliente } from "../src/app/api/torre/tarefas/[tarefaId]/cobrar-cliente/route"
import { POST as postCanal } from "../src/app/api/torre/tarefas/[tarefaId]/canal/route"
import { POST as postVincular } from "../src/app/api/torre/tarefas/vincular-orgao/route"
import { POST as postVisao } from "../src/app/api/torre/visoes/route"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORRETF"
const req = (method: string, url: string, token: string | null, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })
const tokenDe = (u: { id: number; email: string; tipo: string }) => signAuthToken({ userId: u.id, email: u.email, tipo: u.tipo, sessaoInicio: Date.now() })

async function main() {
  const c = await montarCenario(MARCA)
  try {
    const mk = (nome: string, tipo: string, perms?: Record<string, boolean>) =>
      prisma.usuario.create({ data: { nome: `${MARCA} ${nome}`, email: `${MARCA.toLowerCase()}-${nome.toLowerCase()}@t.com`, senha: "x", tipo, ...(perms ? { permissoesCustom: perms } : {}) } })
    const admin = await mk("Admin", "admin"), comum = await mk("Comum", "assistente", { "tarefas.ver": true })
    const tAdmin = await tokenDe(admin), tComum = await tokenDe(comum)
    const o1 = await c.novoOrgao("Cartório Um", { email: "um@cartorio.test" })
    const o2 = await c.novoOrgao("Cartório Dois")
    const a1 = await c.novaObrigacao({ aguardando: true, orgaoId: o1.id, comSolicitacao: { canal: "BALCAO" } })
    const a2 = await c.novaObrigacao({ orgaoId: null, comSolicitacao: { canal: "EMAIL" } })
    const a3 = await c.novaObrigacao({})

    secao("Permissões — a API recusa (a tela só mostra o que a API aceita)")
    for (const [nome, r] of [
      ["canceladas", await getCanceladas(req("GET", "/api/torre/tarefas/canceladas", tComum))], ["feito", await getFeito(req("GET", "/api/torre/tarefas/feito", tComum))],
      ["gaveta", await getGaveta(req("GET", `/api/torre/tarefas/${a1.tarefaId}/gaveta`, tComum), ctx({ tarefaId: String(a1.tarefaId) }))],
      ["cobrar", await postCobrar(req("POST", `/api/torre/tarefas/${a1.tarefaId}/cobrar`, tComum, { observacao: "porque sim" }), ctx({ tarefaId: String(a1.tarefaId) }))],
      ["vincular-orgao", await postVincular(req("POST", "/api/torre/tarefas/vincular-orgao", tComum, { tarefaIds: [a1.tarefaId], orgaoId: o1.id, justificativa: "porque sim" }))],
    ] as const) ok(`${nome}: usuário que não é gestor da Torre → 403`, r.status === 403)
    ok("sem token → 401", (await getCanceladas(req("GET", "/api/torre/tarefas/canceladas", null))).status === 401)

    secao("Canceladas — só exibição, com quem / quando / por quê")
    const antes = await (await getLista(req("GET", "/api/torre/tarefas", tAdmin))).json()
    const rc = await cancelarTarefa({ tarefaId: a3.tarefaId, autorId: admin.id, motivo: "Motivo: pessoa deixou de ser casada · Justificativa: conferido na árvore" })
    ok("cancelamento pela porta canônica", rc.ok === true, JSON.stringify(rc))
    const depois = await (await getLista(req("GET", "/api/torre/tarefas", tAdmin))).json()
    ok("a lista principal NÃO traz a cancelada (e o total de trabalho cai 1)", !depois.linhas.some((l: { taskId: number }) => l.taskId === a3.tarefaId) && depois.linhas.length === antes.linhas.length - 1)
    const jc = await (await getCanceladas(req("GET", "/api/torre/tarefas/canceladas", tAdmin))).json()
    const canc = jc.linhas.find((l: { taskId: number }) => l.taskId === a3.tarefaId)
    ok("a rota das canceladas traz a certidão (mesma fonte das linhas) com status CANCELADA", !!canc && canc.statusTarefa === "CANCELADA" && jc.total === jc.linhas.length)
    ok("quem cancelou, quando (rótulo 'hoje HH:MM') e o motivo", canc?.encerramento?.porNome === `${MARCA} Admin` && /^hoje \d{2}:\d{2}$/.test(canc?.encerramento?.quandoRotulo ?? "") && /pessoa deixou de ser casada/.test(canc?.encerramento?.motivo ?? ""), JSON.stringify(canc?.encerramento))
    ok("as canceladas não carregam tarefa de trabalho (nenhuma aberta na rota)", jc.linhas.every((l: { statusTarefa: string }) => l.statusTarefa === "CANCELADA"))
    ok("filtro por processo", (await (await getCanceladas(req("GET", `/api/torre/tarefas/canceladas?processoId=${a3.processoId}`, tAdmin))).json()).linhas.length === 1 && (await (await getCanceladas(req("GET", `/api/torre/tarefas/canceladas?processoId=${a1.processoId}`, tAdmin))).json()).linhas.length === 0)

    secao("Gaveta — passos e histórico reais")
    // a4 não tem documento: a unidade de trabalho é o próprio passo corrente (a1/a2 ganharam documento só para a solicitação da fixture).
    const a4 = await c.novaObrigacao({})
    const si = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: a4.stepInstanceId }, select: { workflowInstanceId: true } })
    await prisma.tarefa.update({ where: { id: a4.tarefaId }, data: { workflowInstanceId: si.workflowInstanceId, workflowStepInstanceId: a4.stepInstanceId } })
    const jg = await (await getGaveta(req("GET", `/api/torre/tarefas/${a4.tarefaId}/gaveta`, tAdmin), ctx({ tarefaId: String(a4.tarefaId) }))).json()
    ok("os passos são os da certidão (do cadastro publicado), com o corrente marcado", Array.isArray(jg.etapas) && jg.etapas.length >= 1 && jg.etapas.some((e: { atual: boolean }) => e.atual) && jg.etapas.every((e: { titulo: string }) => !/^solicitar_/.test(e.titulo)), JSON.stringify(jg.etapas))
    ok("o histórico é lista de fatos reais, com 'quando' pronto e o autor quando existe", Array.isArray(jg.historico) && jg.historico.every((h: { quando: string; texto: string }) => typeof h.quando === "string" && h.texto.length > 0))
    ok("tarefa inexistente → 404 · id inválido → 400", (await getGaveta(req("GET", "/api/torre/tarefas/99999999/gaveta", tAdmin), ctx({ tarefaId: "99999999" }))).status === 404 && (await getGaveta(req("GET", "/api/torre/tarefas/x/gaveta", tAdmin), ctx({ tarefaId: "x" }))).status === 400)

    secao("Cobrar uma linha — justificativa obrigatória, a mesma porta das cobranças em massa")
    const sem = await postCobrar(req("POST", `/api/torre/tarefas/${a1.tarefaId}/cobrar`, tAdmin, { observacao: "abc" }), ctx({ tarefaId: String(a1.tarefaId) }))
    ok("justificativa curta (< 5 letras) → 400 e nada gravado", sem.status === 400 && (await prisma.contatoTerceiro.count({ where: { tarefaId: a1.tarefaId } })) === 0)
    const rc1 = await postCobrar(req("POST", `/api/torre/tarefas/${a1.tarefaId}/cobrar`, tAdmin, { observacao: "  sem retorno há uma semana  " }), ctx({ tarefaId: String(a1.tarefaId) }))
    const j1 = await rc1.json()
    ok("cobrança registrada (200)", rc1.status === 200 && j1.ok === true, JSON.stringify(j1))
    const contato = await prisma.contatoTerceiro.findFirstOrThrow({ where: { tarefaId: a1.tarefaId } })
    ok("a justificativa vai (sem espaços sobrando) como observação do contato; canal = o CADASTRADO (balcão → presencial); órgão gravado", contato.observacao === "sem retorno há uma semana" && contato.canal === "PRESENCIAL" && contato.orgaoId === o1.id && j1.canal === "PRESENCIAL")
    ok("devolve o próximo acompanhamento que a régua marcou (para o toast 'próxima em N dias')", typeof j1.proximoAcompanhamentoEm === "string" && new Date(j1.proximoAcompanhamentoEm).getTime() > Date.now())
    const rc2 = await postCobrar(req("POST", `/api/torre/tarefas/${a1.tarefaId}/cobrar`, tAdmin, { observacao: "de novo", canal: "TELEFONE" }), ctx({ tarefaId: String(a1.tarefaId) }))
    ok("canal escolhido vale", rc2.status === 200 && (await prisma.contatoTerceiro.count({ where: { tarefaId: a1.tarefaId, canal: "TELEFONE" } })) === 1)
    const rc3 = await postCobrar(req("POST", `/api/torre/tarefas/${a2.tarefaId}/cobrar`, tAdmin, { observacao: "tentativa" }), ctx({ tarefaId: String(a2.tarefaId) }))
    ok("tarefa que NÃO está com o terceiro: 422 com o motivo (não vira ruído no histórico)", rc3.status === 422 && /nada a cobrar|não está com o terceiro/.test((await rc3.json()).mensagem) && (await prisma.contatoTerceiro.count({ where: { tarefaId: a2.tarefaId } })) === 0)

    secao("Cobrar cliente e trocar canal — a justificativa vira UMA linha de histórico")
    const sj = await postCobrarCliente(req("POST", `/api/torre/tarefas/${a2.tarefaId}/cobrar-cliente`, tAdmin, { justificativa: "ab" }), ctx({ tarefaId: String(a2.tarefaId) }))
    ok("cobrar cliente sem justificativa válida → 400", sj.status === 400)
    const cc = await postCobrarCliente(req("POST", `/api/torre/tarefas/${a2.tarefaId}/cobrar-cliente`, tAdmin, { justificativa: "cliente prometeu retorno" }), ctx({ tarefaId: String(a2.tarefaId) }))
    ok("cobrar cliente: mensagem no chat do processo + auditoria da porta + a justificativa", cc.status === 200 && (await prisma.mensagem.count({ where: { processoId: a2.processoId } })) === 1
      && (await prisma.logAuditoria.count({ where: { acao: "COBRANCA_CLIENTE_BLOQUEIO", entidadeId: a2.tarefaId } })) === 1
      && (await prisma.logAuditoria.count({ where: { acao: "TORRE_JUSTIFICATIVA", entidadeId: a2.tarefaId, descricao: { contains: "cliente prometeu retorno" } } })) === 1)
    const cn = await postCanal(req("POST", `/api/torre/tarefas/${a1.tarefaId}/canal`, tAdmin, { canal: "EMAIL", justificativa: "ab" }), ctx({ tarefaId: String(a1.tarefaId) }))
    ok("trocar canal com justificativa curta → 400 e o canal NÃO muda", cn.status === 400 && (await prisma.solicitacaoDocumento.findFirstOrThrow({ where: { tarefaId: a1.tarefaId } })).canal === "BALCAO")
    const cn2 = await postCanal(req("POST", `/api/torre/tarefas/${a1.tarefaId}/canal`, tAdmin, { canal: "EMAIL", justificativa: "cartório só responde por e-mail" }), ctx({ tarefaId: String(a1.tarefaId) }))
    ok("trocar canal: troca na solicitação, uma linha da porta + uma com a justificativa", cn2.status === 200 && (await prisma.solicitacaoDocumento.findFirstOrThrow({ where: { tarefaId: a1.tarefaId } })).canal === "EMAIL"
      && (await prisma.logAuditoria.count({ where: { acao: "SOLICITACAO_CANAL_ALTERADO", entidadeId: a1.tarefaId } })) === 1
      && (await prisma.logAuditoria.count({ where: { acao: "TORRE_JUSTIFICATIVA", entidadeId: a1.tarefaId, descricao: { contains: "cartório só responde por e-mail" } } })) === 1)
    const jg2 = await (await getGaveta(req("GET", `/api/torre/tarefas/${a1.tarefaId}/gaveta`, tAdmin), ctx({ tarefaId: String(a1.tarefaId) }))).json()
    ok("a justificativa aparece no HISTÓRICO da gaveta, com o nome de quem a escreveu", jg2.historico.some((h: { texto: string; autor: string | null }) => /cartório só responde por e-mail/.test(h.texto) && h.autor === `${MARCA} Admin`))

    secao("Vincular órgão — a justificativa só entra em quem TEM o órgão")
    await prisma.tarefa.update({ where: { id: a2.tarefaId }, data: { orgaoId: o2.id } }) // simula o vínculo da porta da Operação
    const v0 = await postVincular(req("POST", "/api/torre/tarefas/vincular-orgao", tAdmin, { tarefaIds: [a2.tarefaId, a3.tarefaId], orgaoId: o2.id, justificativa: "ab" }))
    ok("justificativa curta → 400", v0.status === 400)
    const v1 = await postVincular(req("POST", "/api/torre/tarefas/vincular-orgao", tAdmin, { tarefaIds: [a2.tarefaId, a3.tarefaId], orgaoId: o2.id, justificativa: "cartório da comarca do registro" }))
    const jv = await v1.json()
    ok("audita só a tarefa que de fato tem o órgão (a3 não tem → sem linha)", v1.status === 200 && jv.auditadas === 1 && (await prisma.logAuditoria.count({ where: { acao: "TAREFA_ORGAO_VINCULADO", entidadeId: a2.tarefaId } })) === 1 && (await prisma.logAuditoria.count({ where: { acao: "TAREFA_ORGAO_VINCULADO", entidadeId: a3.tarefaId } })) === 0)
    ok("órgão inexistente → 404", (await postVincular(req("POST", "/api/torre/tarefas/vincular-orgao", tAdmin, { tarefaIds: [a2.tarefaId], orgaoId: 99999999, justificativa: "cartório inexistente" }))).status === 404)

    secao("Feito e visão salva")
    const jf = await (await getFeito(req("GET", "/api/torre/tarefas/feito", tAdmin))).json()
    ok("feito responde (lista de concluídas dos últimos 14 dias) com 'concluidaPorNome' por linha", Array.isArray(jf.linhas) && jf.total === jf.linhas.length && jf.linhas.every((l: Record<string, unknown>) => "concluidaPorNome" in l))
    const sv = await postVisao(req("POST", "/api/torre/visoes", tAdmin, { nome: `${MARCA} v`, visao: "bloqueadas", justificativa: "ab" }))
    ok("salvar visão com justificativa curta → 400", sv.status === 400)
    const sv2 = await postVisao(req("POST", "/api/torre/visoes", tAdmin, { nome: `${MARCA} v`, visao: "bloqueadas", filtros: { iniciou: "hoje", iniciouDe: "2026-09-01" }, justificativa: "visão da minha reunião" }))
    const jsv = await sv2.json()
    ok("visão salva: guarda a visão 'bloqueadas' e o filtro Iniciou; a justificativa vai para a auditoria", sv2.status === 200 && (jsv.visao.spec as { visao: string; filtros: { iniciou: string } }).visao === "bloqueadas" && (jsv.visao.spec as { filtros: { iniciou: string } }).filtros.iniciou === "hoje"
      && (await prisma.logAuditoria.count({ where: { acao: "VISAO_TORRE_SALVA", descricao: { contains: "visão da minha reunião" } } })) === 1)
  } finally {
    await prisma.relatorioVisao.deleteMany({ where: { nome: { startsWith: MARCA } } })
    await prisma.logAuditoria.deleteMany({ where: { acao: "VISAO_TORRE_SALVA", descricao: { contains: "visão da minha reunião" } } })
    await prisma.mensagem.deleteMany({ where: { conteudo: { contains: "aguardando um retorno seu" } } }).catch(() => {})
    await c.limpar()
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())

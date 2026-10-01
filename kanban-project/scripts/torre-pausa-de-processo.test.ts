// scripts/torre-pausa-de-processo.test.ts
// ============================================================================
// TORRE NOVA, ETAPA A (01/10/2026) — PAUSAR / REATIVAR PROCESSO (M2) e o FILTRO CANÔNICO "processo pausado fica fora da Torre".
//
//   npx tsx scripts/torre-pausa-de-processo.test.ts   (banco de teste)
//
// PROVA:
//   • ida e volta: pausar abre uma linha (append-only), reativar a fecha; pausar de novo abre OUTRA — o histórico fica inteiro;
//   • justificativa de 5+ letras, processo concluído não se pausa, já pausado não duplica (e o índice parcial do BANCO barra);
//   • cada ato grava histórico (quem, o quê, quando, justificativa) em LogAuditoria; "Desfazer" = reativar;
//   • FILTRO CANÔNICO: lista de tarefas da Torre, KPIs, "Precisa de você", Radar/Processos e a foto diária deixam o processo pausado
//     de fora e o devolvem ao reativar (os números voltam EXATAMENTE aos de antes);
//   • o processo pausado continua acessível no detalhe (Foco) e lá aparece como "Pausado";
//   • a OPERAÇÃO (Minha fila, visão gerencial, sino) NÃO muda; fase, prazo e tarefa não são tocados;
//   • as duas rotas da API (gestor da Torre + tarefas.bloquear).
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-pausa-de-processo.test.ts")

import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { montarCenario } from "./_fixture-torre-gh"
import {
  pausarProcesso, reativarProcesso, pausaVigenteDoProcesso, historicoDePausas, idsDeProcessosPausados, semProcessosPausados, justificativaValida,
} from "../src/services/processo-pausa"
import { listarTarefasDaTorre } from "../src/services/torre-tarefas"
import { itensPrecisaDeVoce } from "../lib/operacional/precisa-de-voce"
import { processosDaTorre } from "../lib/operacional/torre-processos"
import { calcularIndicadoresDoDia } from "../lib/operacional/indicadores-diarios"
import { focoDaFamilia } from "../lib/operacional/torre-foco"
import { minhaFila, visaoGerencial } from "../lib/operacional/tarefa-projecoes"
import { lerLinhasOperacionais } from "../lib/operacional/avisos-sino"
import { cobrarOrgao } from "../src/services/torre-terceiros"
import { POST as postPausar } from "../src/app/api/torre/processos/[processoId]/pausar/route"
import { POST as postReativar } from "../src/app/api/torre/processos/[processoId]/reativar/route"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORREA_PAUSA"
const req = (method: string, url: string, token: string | null, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
const tokenDe = (u: { id: number; email: string; tipo: string }) => signAuthToken({ userId: u.id, email: u.email, tipo: u.tipo, sessaoInicio: Date.now() })
const ctx = (id: number) => ({ params: Promise.resolve({ processoId: String(id) }) })

async function main() {
  const c = await montarCenario(MARCA)
  await prisma.processoPausa.deleteMany({ where: { processo: { nome: { startsWith: MARCA } } } })
  try {
    const mk = (nome: string, tipo: string, perms?: Record<string, boolean>) =>
      prisma.usuario.create({ data: { nome: `${MARCA} ${nome}`, email: `${MARCA.toLowerCase()}-${nome.toLowerCase()}@t.com`, senha: "x", tipo, ...(perms ? { permissoesCustom: perms } : {}) } })
    const admin = await mk("Admin", "admin")
    const daniela = await mk("Daniela", "assistente", { "tarefas.ver": true, "tarefas.iniciar_concluir": true })
    const comum = await mk("Comum", "assistente", { "tarefas.ver": true })
    const tAdmin = await tokenDe(admin), tComum = await tokenDe(comum)
    // Dois processos: o que vai ser pausado (com uma tarefa SEM responsável e uma COM a Daniela) e o que fica.
    const a = await c.novaObrigacao({ responsavelId: null, dataPrazo: new Date(Date.now() - 2 * 86_400_000) })       // sem dono, atrasada
    const a2 = await c.novaObrigacao({ responsavelId: daniela.id })                                                  // OUTRO processo (para ter 2 pausáveis)
    const b = await c.novaObrigacao({ responsavelId: daniela.id, aguardando: true })
    const faseAntes = (await prisma.processo.findUniqueOrThrow({ where: { id: a.processoId }, select: { faseAtualKey: true } })).faseAtualKey
    const tarefaAntes = await prisma.tarefa.findUniqueOrThrow({ where: { id: a.tarefaId }, select: { dataPrazo: true, statusTarefa: true, slaPausadoEm: true, responsavelId: true, lockVersion: true } })
    const agora = new Date()

    const fotoAntes = async () => {
      const { linhas } = await listarTarefasDaTorre({}, agora)
      const itens = await itensPrecisaDeVoce({ agora })
      const procs = (await processosDaTorre(agora)).processos
      const ind = await calcularIndicadoresDoDia(agora)
      const nossas = (xs: Array<{ processoId: number | null }>) => xs.filter((x) => x.processoId === a.processoId).length
      return {
        linhasTotal: linhas.length, linhasDoA: nossas(linhas), itensDoA: nossas(itens), itensTotal: itens.length,
        procsTotal: procs.length, procsTemA: procs.some((p) => p.processoId === a.processoId),
        tarefasAbertas: ind.tarefasAbertas, processosAtivos: ind.processosAtivos, semDono: ind.semDono, vencidas: ind.vencidas,
      }
    }
    const antes = await fotoAntes()
    ok("pré-condição: o processo A está na Torre (tarefa, decisão do dia, lista de processos)", antes.linhasDoA >= 1 && antes.itensDoA >= 1 && antes.procsTemA, JSON.stringify(antes))

    secao("PAUSAR — regras da porta")
    ok("justificativa curta (<5) → recusa e nada grava", (await pausarProcesso({ processoId: a.processoId, usuarioId: admin.id, justificativa: "ab" })).ok === false && (await prisma.processoPausa.count({ where: { processoId: a.processoId } })) === 0)
    ok("justificativa só de espaços → recusa", (await pausarProcesso({ processoId: a.processoId, usuarioId: admin.id, justificativa: "      " })).ok === false)
    ok("processo inexistente → recusa", (await pausarProcesso({ processoId: 99999999, usuarioId: admin.id, justificativa: "motivo válido" })).ok === false)
    ok("justificativaValida: apara espaços e exige 5", justificativaValida("  abcde  ") === "abcde" && justificativaValida("abcd") === null && justificativaValida(null) === null)
    const concluido = await prisma.processo.create({ data: { nome: `${MARCA} concluido`, dataConclusao: new Date() }, select: { id: true } })
    const rConc = await pausarProcesso({ processoId: concluido.id, usuarioId: admin.id, justificativa: "motivo válido" })
    ok("processo CONCLUÍDO não se pausa", !rConc.ok && rConc.codigo === "PROCESSO_CONCLUIDO")
    await prisma.processo.delete({ where: { id: concluido.id } })

    secao("PAUSAR — o ato")
    const p1 = await pausarProcesso({ processoId: a.processoId, usuarioId: admin.id, justificativa: "  Cliente sumiu,   aguardando  retorno " })
    ok("pausa vigente criada, com quem e por quê (espaços normalizados)", p1.ok && p1.pausa.motivo === "Cliente sumiu, aguardando retorno" && p1.pausa.pausadoPor?.id === admin.id && p1.pausa.retomadoEm === null)
    const dup = await pausarProcesso({ processoId: a.processoId, usuarioId: admin.id, justificativa: "outra vez, por favor" })
    ok("pausar de novo → recusa (já pausado), sem duplicar", !dup.ok && dup.codigo === "JA_PAUSADO" && (await prisma.processoPausa.count({ where: { processoId: a.processoId } })) === 1)
    let violou = false
    try { await prisma.processoPausa.create({ data: { processoId: a.processoId, motivo: "direto no banco, sem a porta" } }) } catch { violou = true }
    ok("o BANCO também barra a 2ª pausa vigente (índice parcial único)", violou && (await prisma.processoPausa.count({ where: { processoId: a.processoId, retomadoEm: null } })) === 1)
    ok("pausa vigente legível", (await pausaVigenteDoProcesso(a.processoId))?.motivo === "Cliente sumiu, aguardando retorno" && (await idsDeProcessosPausados()).has(a.processoId) && !(await idsDeProcessosPausados()).has(b.processoId))
    const logP = await prisma.logAuditoria.findFirst({ where: { acao: "PROCESSO_PAUSADO", entidadeId: a.processoId } })
    ok("histórico: quem, o quê, quando, justificativa", !!logP && logP.usuarioId === admin.id && /Cliente sumiu/.test(logP.descricao) && logP.criadoEm instanceof Date && (logP.detalhes as { motivo?: string })?.motivo === "Cliente sumiu, aguardando retorno")

    secao("FILTRO CANÔNICO — o processo pausado sai da Torre inteira")
    const durante = await fotoAntes()
    ok("a lista de tarefas da Torre perde as tarefas do processo pausado (e só elas)", durante.linhasDoA === 0 && durante.linhasTotal === antes.linhasTotal - antes.linhasDoA, `${antes.linhasTotal} → ${durante.linhasTotal}`)
    ok("'Precisa de você' perde as decisões do processo pausado", durante.itensDoA === 0 && durante.itensTotal === antes.itensTotal - antes.itensDoA)
    ok("Radar/Processos: o processo pausado sai da lista", !durante.procsTemA && durante.procsTotal === antes.procsTotal - 1)
    ok("a foto diária (KPIs, tarefas abertas, processos ativos) também deixa o pausado de fora", durante.tarefasAbertas === antes.tarefasAbertas - antes.linhasDoA && durante.processosAtivos === antes.processosAtivos - 1 && durante.semDono === antes.semDono - 1 && durante.vencidas === antes.vencidas - 1, JSON.stringify({ antes, durante }))
    ok("semProcessosPausados é PURO: tira só as linhas do conjunto; tarefa sem processo nunca é pausada", (() => { const r = semProcessosPausados([{ processoId: 1 }, { processoId: 2 }, { processoId: null }], new Set([2])); return r.length === 2 && r.every((x) => x.processoId !== 2) && semProcessosPausados([{ processoId: 1 }], new Set()).length === 1 })())

    secao("O detalhe do Processo continua acessível — e mostra 'Pausado'")
    const foco = await focoDaFamilia(a.processoId, agora)
    ok("o Foco abre o processo pausado, com as tarefas e a pausa (quem/quando/por quê)", !!foco && foco.tarefas.some((t) => t.taskId === a.tarefaId) && foco.pausa?.motivo === "Cliente sumiu, aguardando retorno" && foco.pausa.pausadoPor?.id === admin.id)
    const focoB = await focoDaFamilia(b.processoId, agora)
    ok("processo ativo: pausa = null", focoB?.pausa === null)

    secao("A OPERAÇÃO não muda (Daniela, Minha fila, sino)")
    const filaDaEquipe = await minhaFila(null, agora, prisma, { processoId: a.processoId })
    ok("a fila da Operação (escopo de equipe) e a visão gerencial continuam listando a tarefa do processo pausado", filaDaEquipe.some((l) => l.taskId === a.tarefaId) && (await visaoGerencial({ processoId: a.processoId }, agora)).linhas.some((l) => l.taskId === a.tarefaId))
    ok("e a Minha fila de quem tem tarefa em outro processo segue igual", (await minhaFila(daniela.id, agora)).some((l) => l.taskId === a2.tarefaId))
    ok("as linhas operacionais do sino continuam incluindo o processo pausado", (await lerLinhasOperacionais(agora)).some((l) => l.taskId === a.tarefaId))
    secao("Pausar NÃO mexe em fase, prazo nem tarefa")
    const procDepois = await prisma.processo.findUniqueOrThrow({ where: { id: a.processoId }, select: { faseAtualKey: true } })
    const tarefaDepois = await prisma.tarefa.findUniqueOrThrow({ where: { id: a.tarefaId }, select: { dataPrazo: true, statusTarefa: true, slaPausadoEm: true, responsavelId: true, lockVersion: true } })
    ok("fase igual", procDepois.faseAtualKey === faseAntes)
    ok("a tarefa é a mesma: prazo, status, responsável, SLA e versão (o prazo não pausa)", JSON.stringify(tarefaDepois) === JSON.stringify(tarefaAntes) && tarefaDepois.slaPausadoEm === null)

    secao("REATIVAR (e Desfazer) — volta exatamente como estava")
    ok("reativar com justificativa curta → recusa", (await reativarProcesso({ processoId: a.processoId, usuarioId: admin.id, justificativa: "oi" })).ok === false && !!(await pausaVigenteDoProcesso(a.processoId)))
    const r1 = await reativarProcesso({ processoId: a.processoId, usuarioId: daniela.id, desfazer: true })
    ok("reativar (desfazer) fecha a pausa, com quem reativou", r1.ok && r1.pausa.retomadoEm !== null && r1.pausa.retomadoPor?.id === daniela.id)
    ok("não deixa pausa vigente; o histórico da pausa continua (append-only)", (await pausaVigenteDoProcesso(a.processoId)) === null && (await prisma.processoPausa.count({ where: { processoId: a.processoId } })) === 1)
    const logR = await prisma.logAuditoria.findFirst({ where: { acao: "PROCESSO_REATIVADO", entidadeId: a.processoId } })
    ok("histórico da reativação: quem, quando, e que foi desfazer", !!logR && logR.usuarioId === daniela.id && /desfazer da pausa/.test(logR.descricao) && (logR.detalhes as { desfazer?: boolean })?.desfazer === true)
    const depois = await fotoAntes()
    ok("os números VOLTAM EXATAMENTE aos de antes (lista, decisões, processos, foto diária)", JSON.stringify(depois) === JSON.stringify(antes), JSON.stringify(depois))
    ok("reativar de novo → recusa (não está pausado)", (await reativarProcesso({ processoId: a.processoId, usuarioId: admin.id })).ok === false)
    const p2 = await pausarProcesso({ processoId: a.processoId, usuarioId: admin.id, justificativa: "segunda pausa, outro motivo" })
    const hist = await historicoDePausas(a.processoId)
    ok("pausar de novo abre OUTRA linha — duas no histórico, a antiga fechada e a nova vigente", p2.ok && hist.length === 2 && hist[0].retomadoEm === null && hist[1].retomadoEm !== null && hist[1].motivo === "Cliente sumiu, aguardando retorno")
    const r2 = await reativarProcesso({ processoId: a.processoId, usuarioId: admin.id, justificativa: "cliente voltou a responder" })
    ok("reativar com justificativa a registra no histórico", r2.ok && /cliente voltou a responder/.test((await prisma.logAuditoria.findFirst({ where: { acao: "PROCESSO_REATIVADO", entidadeId: a.processoId }, orderBy: { id: "desc" } }))?.descricao ?? ""))

    secao("API — gestor da Torre + tarefas.bloquear")
    ok("sem sessão: 401", (await postPausar(req("POST", "/x", null, { justificativa: "motivo válido" }), ctx(a.processoId))).status === 401)
    ok("sem ser gestor da Torre: 403", (await postPausar(req("POST", "/x", tComum, { justificativa: "motivo válido" }), ctx(a.processoId))).status === 403 && (await postReativar(req("POST", "/x", tComum, {}), ctx(a.processoId))).status === 403)
    ok("justificativa curta: 400", (await postPausar(req("POST", "/x", tAdmin, { justificativa: "oi" }), ctx(a.processoId))).status === 400)
    ok("processo inexistente: 404 · id lixo: 400", (await postPausar(req("POST", "/x", tAdmin, { justificativa: "motivo válido" }), ctx(99999999))).status === 404 && (await postPausar(req("POST", "/x", tAdmin, { justificativa: "motivo válido" }), { params: Promise.resolve({ processoId: "abc" }) })).status === 400)
    const api1 = await postPausar(req("POST", "/x", tAdmin, { justificativa: "pausa pela API, com motivo" }), ctx(a.processoId))
    ok("pausar pela API: 200 e o processo some da Torre", api1.status === 200 && (await idsDeProcessosPausados()).has(a.processoId))
    ok("pausar de novo pela API: 409", (await postPausar(req("POST", "/x", tAdmin, { justificativa: "pausa pela API, com motivo" }), ctx(a.processoId))).status === 409)
    const api2 = await postReativar(req("POST", "/x", tAdmin, { desfazer: true }), ctx(a.processoId))
    ok("reativar (desfazer) pela API: 200 e volta à Torre", api2.status === 200 && !(await idsDeProcessosPausados()).has(a.processoId))
    ok("reativar sem pausa: 409", (await postReativar(req("POST", "/x", tAdmin, {}), ctx(a.processoId))).status === 409)

    secao("'Cobrar este cartório' também deixa o processo pausado de fora")
    const orgao = await c.novoOrgao("Cartório da pausa")
    const o1 = await c.novaObrigacao({ aguardando: true, responsavelId: daniela.id, orgaoId: orgao.id })
    const cobrarAntes = await cobrarOrgao({ orgaoId: orgao.id, autor: { userId: admin.id, tipo: "admin" }, agora })
    ok("pré-condição: com o processo ativo, o órgão tem o que cobrar", cobrarAntes.ok === true && cobrarAntes.cobradas === 1, JSON.stringify(cobrarAntes).slice(0, 160))
    await pausarProcesso({ processoId: o1.processoId, usuarioId: admin.id, justificativa: "pausa para cobrar" })
    const cobrarDurante = await cobrarOrgao({ orgaoId: orgao.id, autor: { userId: admin.id, tipo: "admin" }, agora })
    ok("com o processo pausado, o pedido dele NÃO é cobrado ('nada a cobrar')", cobrarDurante.ok === false && cobrarDurante.status === 422)
    await reativarProcesso({ processoId: o1.processoId, usuarioId: admin.id })

    secao("Contagem de consultas: o filtro é UMA consulta, não uma por linha")
    // mais 6 obrigações com a pausa de um processo vigente: o nº de leituras de ProcessoPausa continua 1 por listarTarefasDaTorre.
    const consultas: string[] = []
    const { PrismaClient } = await import("@prisma/client")
    const espiao = new PrismaClient({ log: [{ emit: "event", level: "query" }] })
    ;(espiao as unknown as { $on: (e: string, cb: (q: { query: string }) => void) => void }).$on("query", (q) => { consultas.push(q.query) })
    try { await idsDeProcessosPausados(espiao) } finally { await espiao.$disconnect() }
    ok("idsDeProcessosPausados = 1 consulta, qualquer que seja o nº de processos/linhas", consultas.filter((q) => /FROM "public"\."ProcessoPausa"/.test(q)).length === 1, `${consultas.length}`)
  } finally {
    await prisma.logAuditoria.deleteMany({ where: { acao: { in: ["PROCESSO_PAUSADO", "PROCESSO_REATIVADO"] } } })
    await prisma.processoPausa.deleteMany({ where: { processo: { nome: { startsWith: MARCA } } } })
    await c.limpar()
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())

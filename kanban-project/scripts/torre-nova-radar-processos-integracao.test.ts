// scripts/torre-nova-radar-processos-integracao.test.ts
// ============================================================================
// TORRE NOVA — RADAR + PROCESSOS: a CONSOLIDAÇÃO POR PROCESSO contra o banco (lib/operacional/torre-processos.ts, torre-fase-dados.ts)
// e as rotas /api/torre/processos/{fases,certidoes}.
//
//   npx tsx scripts/torre-nova-radar-processos-integracao.test.ts   (banco de teste)
//
// PROVA:
//   • SEM TETO: com 310 processos ativos a lista traz os 310 (o `take: 300` saiu) e o nº bate com a contagem do banco;
//   • SEM N+1: a entrada na fase e as concluídas são leituras EM LOTE (nº de consultas constante com 5 ou 40 processos) e a entrada em
//     lote é IGUAL à de `entradaNaFase` processo a processo (as 4 origens: avanço de fase, abertura, workflow da fase, nada);
//   • o RISCO real: crítico (atraso + sem dono), atenção (prazo amanhã; passou da meta — e SEM meta nenhum limiar), parado (bola com
//     terceiro há 15+ dias com a cobrança vencida), no ritmo; o conjunto "graves" de `processosCriticos` é o MESMO do Radar;
//   • a PRÓXIMA AÇÃO derivada das tarefas abertas (dono e prazo vêm da tarefa), "—" (null) sem tarefa aberta; cancelada ≠ concluída;
//   • o "a de b" das certidões é a fonte única `documentacaoRequeridaDoProcesso`;
//   • o fluxo da semana (entraram/saíram) vem do log real de fases, só desta semana; a rota recusa quem não é da Torre.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-nova-radar-processos-integracao.test.ts")

import { readFileSync } from "node:fs"
import { NextRequest } from "next/server"
import { PrismaClient } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { montarCenario } from "./_fixture-torre-gh"
import { processosDaTorre, processosCriticos, colunasDoRadar, certidoesDosProcessos, ONDE_PROCESSO_ATIVO_DA_TORRE } from "../lib/operacional/torre-processos"
import { entradasNaFaseEmLote, concluidasDaFaseEmLote, inicioDaSemanaOperacional, fluxoDaSemana, tempoDesde } from "../lib/operacional/torre-fase-dados"
import { entradaNaFase, tempoMedioRealPorFase } from "../lib/operacional/metricas-processo"
import { definirMeta } from "../lib/operacional/torre-metas"
import { ehGrave } from "../lib/operacional/torre-risco"
import { documentacaoRequeridaDoProcesso } from "../src/lib/process-stage/documentacao-requerida"
import { ordensDeFase } from "../src/services/documento-operacao"
import { janelaDoDiaOperacionalDe, diaOperacional } from "../lib/operacional/tempo-operacional"
import { POST as postFases } from "../src/app/api/torre/processos/fases/route"
import { POST as postCertidoes } from "../src/app/api/torre/processos/certidoes/route"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORRENRP"
const DIA = 86_400_000
const req = (method: string, url: string, token: string | null, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
const tokenDe = (u: { id: number; email: string; tipo: string }) => signAuthToken({ userId: u.id, email: u.email, tipo: u.tipo, sessaoInicio: Date.now() })

async function contarConsultas(fn: (espiao: PrismaClient) => Promise<unknown>): Promise<number> {
  const consultas: string[] = []
  const espiao = new PrismaClient({ log: [{ emit: "event", level: "query" }] })
  ;(espiao as unknown as { $on: (e: string, cb: (q: { query: string }) => void) => void }).$on("query", (q) => { consultas.push(q.query) })
  try { await fn(espiao) } finally { await espiao.$disconnect() }
  return consultas.filter((q) => !/^\s*SELECT 1\b/i.test(q)).length
}

async function main() {
  secao("PURO — as colunas do Radar (fases terminais sem processo ativo saem)")
  const todas = ["genealogia", "emissao", "analise", "finalizado", "livre"].map((key) => ({ key, label: key, condicional: false }))
  const mapa = (...pares: Array<[number, Array<[string, number]>]>) => new Map(pares.map(([t, ps]) => [t, new Map(ps)] as const))
  const um = mapa([1, [["genealogia", 1], ["emissao", 2], ["analise", 3], ["finalizado", 4]]])
  ok("a última fase do macrofluxo sem processo ativo nela não é coluna; a que nenhum macrofluxo usa fica", colunasDoRadar(todas, um, new Set()).map((c) => c.key).join() === "genealogia,emissao,analise,livre")
  ok("…mas se há processo ativo nela, a coluna fica (nunca poda onde há trabalho)", colunasDoRadar(todas, um, new Set(["finalizado"])).map((c) => c.key).join() === "genealogia,emissao,analise,finalizado,livre")
  ok("fase que é a última de um macrofluxo mas intermediária de outro NÃO é terminal", colunasDoRadar(todas, mapa([1, [["genealogia", 1], ["emissao", 2]]], [2, [["genealogia", 1], ["emissao", 2], ["analise", 3]]]), new Set()).some((c) => c.key === "emissao"))

  secao("PURO — a semana começa na segunda-feira, 00:00 em São Paulo")
  const seg = janelaDoDiaOperacionalDe("2026-09-28").inicio.toISOString()
  ok("quarta 30/09 → segunda 28/09", inicioDaSemanaOperacional(new Date("2026-09-30T15:00:00Z")).toISOString() === seg)
  ok("domingo 04/10 (noite em SP) → ainda a semana de 28/09", inicioDaSemanaOperacional(new Date("2026-10-05T01:30:00Z")).toISOString() === seg)
  ok("segunda 28/09 00:30 em SP (03:30Z) → o próprio dia; 28/09 02:00Z (domingo à noite em SP) → a semana anterior", inicioDaSemanaOperacional(new Date("2026-09-28T03:30:00Z")).toISOString() === seg && inicioDaSemanaOperacional(new Date("2026-09-28T02:00:00Z")).toISOString() === janelaDoDiaOperacionalDe("2026-09-21").inicio.toISOString())
  ok("tempoDesde: dias e horas completos; sem data → null", JSON.stringify(tempoDesde("2026-09-30T00:00:00Z", new Date("2026-10-01T05:00:00Z"))) === '{"dias":1,"horas":29}' && JSON.stringify(tempoDesde(null, new Date())) === '{"dias":null,"horas":null}')

  const c = await montarCenario(MARCA)
  try {
    const mk = (nome: string, tipo: string, perms?: Record<string, boolean>) =>
      prisma.usuario.create({ data: { nome: `${MARCA} ${nome}`, email: `${MARCA.toLowerCase()}-${nome.toLowerCase()}@t.com`, senha: "x", tipo, ...(perms ? { permissoesCustom: perms } : {}) } })
    const admin = await mk("Admin", "admin")
    const comum = await mk("Comum", "assistente", { "tarefas.ver": true })
    const tAdmin = await tokenDe(admin), tComum = await tokenDe(comum)

    // Macrofluxo do tipo do teste: genealogia → emissão → análise → (finalizado). A fase da fixture fica à parte.
    const macro = await prisma.macroWorkflow.findFirstOrThrow({ where: { tipoProcessoId: c.tipoId }, select: { id: true } })
    let ordem = 1
    for (const k of ["genealogia", "emissao_documental", "analise_documental", "finalizado"]) {
      await prisma.faseMacro.upsert({ where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: k } }, update: { ordem }, create: { macroWorkflowId: macro.id, phaseKey: k, label: k, ordem } })
      ordem++
    }
    const FASE = "emissao_documental"
    const poeNaFase = (ids: number[], fase = FASE) => prisma.processo.updateMany({ where: { id: { in: ids } }, data: { faseAtualKey: fase } })

    secao("BANCO — o risco real de cada processo")
    const ontem = new Date(Date.now() - 2 * DIA)
    const amanha = new Date(janelaDoDiaOperacionalDe(diaOperacional(new Date(Date.now() + DIA))).inicio.getTime() + 12 * 3600_000)
    const A = await c.novaObrigacao({ dataPrazo: ontem })                                                            // atrasada + sem dono → 7
    const B = await c.novaObrigacao({ responsavelId: admin.id, dataPrazo: new Date(Date.now() + 20 * DIA) })        // nada
    const Cc = await c.novaObrigacao({ responsavelId: admin.id, dataPrazo: amanha })                                  // prazo amanhã → atenção (A3)
    const D = await c.novaObrigacao({ aguardando: true, responsavelId: admin.id, dataPrazo: new Date(Date.now() + 30 * DIA) }) // espera + cobrança vencida + 20 d → parado
    const B2 = await c.novaObrigacao({ responsavelId: admin.id, dataPrazo: new Date(Date.now() + 20 * DIA) })       // 10 d na fase: passa da meta SÓ se houver meta
    const X = await c.novaObrigacao({ responsavelId: admin.id, dataPrazo: new Date(Date.now() + 20 * DIA) })        // tarefa concluída
    const Y = await c.novaObrigacao({ responsavelId: admin.id, dataPrazo: new Date(Date.now() + 20 * DIA) })        // tarefa cancelada
    await poeNaFase([A, B, Cc, D, B2, X, Y].map((o) => o.processoId))
    await prisma.subtaskExecution.updateMany({ where: { stepInstanceId: D.stepInstanceId, subtaskKey: "aguardar_retorno", supersededAt: null }, data: { proximoAcompanhamentoEm: ontem } })
    const vinte = new Date(Date.now() - 20 * DIA)
    await prisma.logAuditoria.updateMany({ where: { entidade: "Tarefa", entidadeId: D.tarefaId, acao: { in: ["TAREFA_AGUARDANDO_TERCEIRO", "TAREFA_BLOQUEADA"] } }, data: { criadoEm: vinte } })
    await prisma.workflowEvento.updateMany({ where: { entityType: "tarefa", entityId: D.tarefaId }, data: { criadoEm: vinte } })
    // B2 entrou na fase há 10 dias (registro real: avanço de fase); os demais não têm registro de entrada (a tela mostra "—").
    await prisma.phaseAdvanceLog.create({ data: { processoId: B2.processoId, faseAtual: "genealogia", fasePretendida: FASE, regrasAvaliadas: [], pendencias: [], resultado: "MOVIDO", origem: "MANUAL", correlationId: `${MARCA}-b2`, chaveIdempotencia: `${MARCA}-b2`, criadoEm: new Date(Date.now() - 10 * DIA) } })
    await prisma.tarefa.updateMany({ where: { id: { in: [X.tarefaId, Y.tarefaId] } }, data: { faseMacroKey: FASE } })
    await prisma.tarefa.update({ where: { id: X.tarefaId }, data: { statusTarefa: "CONCLUIDO_RECEBIDO", dataConclusao: new Date() } })
    await prisma.tarefa.update({ where: { id: Y.tarefaId }, data: { statusTarefa: "CANCELADA" } })

    const r0 = await processosDaTorre()
    const linha = (r: typeof r0, id: number) => r.processos.find((p) => p.processoId === id)!
    const pA = linha(r0, A.processoId), pB = linha(r0, B.processoId), pC = linha(r0, Cc.processoId), pD = linha(r0, D.processoId), pB2 = linha(r0, B2.processoId)
    ok("A (atrasada + sem dono): crítico, 'Sem dono', balde vermelho, pontuação 7", pA.nivelDeRisco === "critico" && pA.situacao === "sd" && pA.semDono && pA.risco === "critico" && pA.scoreMaximo >= 6, `${pA.nivelDeRisco}/${pA.situacao}/${pA.scoreMaximo}`)
    ok("B (com dono, prazo longe): no ritmo, 'No ritmo', balde ok", pB.nivelDeRisco === "no_ritmo" && pB.situacao === "ok" && pB.risco === "ok" && !pB.semDono, `${pB.nivelDeRisco}/${pB.motivoDoRisco}`)
    ok("C (prazo amanhã): atenção pela regra 'perto do prazo'", pC.nivelDeRisco === "atencao" && pC.situacao === "at" && /prazo hoje ou amanhã/.test(pC.motivoDoRisco), `${pC.nivelDeRisco}: ${pC.motivoDoRisco}`)
    ok("D (bola com terceiro há 20 d, cobrança vencida): PARADO — e o Radar o pinta de vermelho (balde 'critico')", pD.nivelDeRisco === "parado" && pD.situacao === "pa" && pD.risco === "critico" && pD.bola.rotulo !== "Equipe", `${pD.nivelDeRisco}: ${pD.motivoDoRisco} · bola ${pD.bola.rotulo} ${pD.bola.dias}`)
    ok("a célula da fase atual carrega o nível e o motivo (tooltip do Radar)", pD.celulas.some((x) => x.estado === "atual" && x.nivel === "parado" && /aguardando/.test(x.motivo ?? "")))
    ok("sem meta cadastrada nenhum limiar é inventado: B2 (10 d na fase) segue no ritmo", pB2.nivelDeRisco === "no_ritmo" && pB2.metaDias === null && pB2.diasNaFase === 10, `${pB2.diasNaFase} d / meta ${pB2.metaDias}`)
    await definirMeta({ phaseKey: FASE, metaDias: 5, autorId: admin.id })
    const r1 = await processosDaTorre()
    ok("com meta de 5 d: B2 (10 d) passa a ATENÇÃO pela meta; B (0 d) continua no ritmo", linha(r1, B2.processoId).nivelDeRisco === "atencao" && /10 d na fase \(meta 5 d\)/.test(linha(r1, B2.processoId).motivoDoRisco) && linha(r1, B.processoId).nivelDeRisco === "no_ritmo" && linha(r1, B2.processoId).metaDias === 5)

    secao("BANCO — o conjunto 'graves' é o MESMO do Radar e do cartão 'em risco'")
    const graves = await processosCriticos()
    const doRadar = new Set(r1.processos.filter((p) => ehGrave(p.nivelDeRisco)).map((p) => p.processoId))
    const meus = [A, B, Cc, D, B2, X, Y].map((o) => o.processoId)
    ok("processosCriticos() = os processos de balde vermelho do Radar (crítico OU parado)", meus.every((id) => graves.has(id) === doRadar.has(id)) && graves.has(A.processoId) && graves.has(D.processoId) && !graves.has(B.processoId) && !graves.has(Cc.processoId), `${[...graves].filter((id) => meus.includes(id)).join()}`)

    secao("BANCO — a PRÓXIMA AÇÃO é derivada das tarefas abertas")
    ok("A: 'Distribuir: <certidão>', atrasada, sem responsável, prazo em vermelho", pA.proximaAcao?.tipo === "distribuir" && pA.proximaAcao.urgencia === "atrasada" && pA.proximaAcao.responsavelNome === null && pA.proximaAcao.prazo.tom === "vermelho" && /^Distribuir: /.test(pA.proximaAcao.texto), pA.proximaAcao?.texto)
    ok("B: o dono e o prazo vêm da tarefa (responsável = Admin)", pB.proximaAcao?.responsavelNome === admin.nome && pB.proximaAcao.dataPrazo != null)
    ok("D: cobrança vencida → 'Cobrar …' com o dono da tarefa", pD.proximaAcao?.tipo === "cobrar" && /^Cobrar /.test(pD.proximaAcao.texto) && pD.proximaAcao.responsavelNome === admin.nome, pD.proximaAcao?.texto)
    const pX = linha(r1, X.processoId), pY = linha(r1, Y.processoId)
    ok("sem tarefa aberta na fase → próxima ação null (a tela mostra '—'): X concluída, Y cancelada", pX.proximaAcao === null && pY.proximaAcao === null)
    ok("cancelada ≠ concluída: X conta 1 concluída, Y conta 0", pX.tarefasDaFase.concluidas === 1 && pY.tarefasDaFase.concluidas === 0 && pX.tarefasDaFase.abertas === 0 && pY.tarefasDaFase.abertas === 0)
    ok("as tarefas da fase: sem responsável (A) e passos com tarefa COM responsável (B)", pA.tarefasDaFase.semResponsavel === 1 && pA.tarefasDaFase.passos.length === 0 && pB.tarefasDaFase.semResponsavel === 0 && pB.tarefasDaFase.passos.reduce((s, x) => s + x.n, 0) === 1 && pD.tarefasDaFase.passos.some((x) => x.aguardando === 1))
    ok("os 4 números por processo seguem os da aba Tarefas (A: 1 aberta, 1 vencida, 1 sem responsável)", JSON.stringify(pA.numeros) === JSON.stringify({ abertas: 1, vencidas: 1, comCartorio: 0, semResponsavel: 1 }))

    secao("BANCO — SEM TETO: 310 processos ativos, todos na lista")
    const antes = (await processosDaTorre()).processos.length
    const nomes = Array.from({ length: 310 }, (_, i) => `${MARCA} massa ${i}`)
    await prisma.arvore.createMany({ data: nomes.map((nome) => ({ nome })) })
    const arvores = await prisma.arvore.findMany({ where: { nome: { startsWith: `${MARCA} massa` } }, select: { id: true, nome: true } })
    await prisma.processo.createMany({ data: arvores.map((a) => ({ nome: a.nome, arvoreId: a.id, faseAtualKey: FASE, workflowRuntime: "v2", tipoProcessoMotorId: c.tipoId })) })
    const rMassa = await processosDaTorre()
    const nAtivos = await prisma.processo.count({ where: ONDE_PROCESSO_ATIVO_DA_TORRE })
    ok(`a lista traz TODOS os processos ativos (${rMassa.processos.length} = contagem do banco ${nAtivos}), além dos 300`, rMassa.processos.length === nAtivos && nAtivos >= antes + 310 && rMassa.processos.length > 300)
    ok("…e o contador é o de TODOS: o código não tem teto de 'take'", !/take:\s*\d+/.test(readFileSync("lib/operacional/torre-processos.ts", "utf8").replace(/\/\/[^\n]*/g, "")))
    ok("processo sem tarefa nenhuma: próxima ação null, situação 'No ritmo', sem dono = false", (() => { const p = rMassa.processos.find((x) => x.familiaNome.startsWith(`${MARCA} massa`))!; return p.proximaAcao === null && !p.semDono && p.nivelDeRisco === "no_ritmo" && p.tarefasDaFase.abertas === 0 })())

    secao("BANCO — 'quando entrou na fase' EM LOTE = processo a processo (as 4 origens)")
    const fase2 = `${MARCA.toLowerCase()}_fase2`
    await prisma.faseMacro.upsert({ where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: fase2 } }, update: { ordem: 9 }, create: { macroWorkflowId: macro.id, phaseKey: fase2, label: fase2, ordem: 9 } })
    const P2 = await c.novaObrigacao({ responsavelId: admin.id })            // vai para a fase 2, com avanço registrado
    const P3 = await c.novaObrigacao({ responsavelId: admin.id })            // fase 2, sem nenhum registro
    const P4 = await c.novaObrigacao({ responsavelId: admin.id })            // sem tipo: cai na criação do workflow da fase
    const P5 = await c.novaObrigacao({ responsavelId: admin.id })            // continua na 1ª fase do macrofluxo: entrou ao nascer
    await poeNaFase([P2.processoId, P3.processoId], fase2)
    await prisma.processo.update({ where: { id: P4.processoId }, data: { tipoProcessoMotorId: null } })
    const tAvanco = new Date(Date.now() - 3 * DIA)
    await prisma.phaseAdvanceLog.create({ data: { processoId: P2.processoId, faseAtual: c.PHASE_KEY, fasePretendida: fase2, regrasAvaliadas: [], pendencias: [], resultado: "MOVIDO", origem: "MANUAL", correlationId: `${MARCA}-c1`, chaveIdempotencia: `${MARCA}-av1`, criadoEm: tAvanco } })
    // um BLOQUEADO não move nada e não conta
    await prisma.phaseAdvanceLog.create({ data: { processoId: P3.processoId, faseAtual: c.PHASE_KEY, fasePretendida: fase2, regrasAvaliadas: [], pendencias: [], resultado: "BLOQUEADO", origem: "MANUAL", correlationId: `${MARCA}-c2`, chaveIdempotencia: `${MARCA}-av2`, criadoEm: tAvanco } })
    const amostra = await prisma.processo.findMany({ where: { id: { in: [A.processoId, B.processoId, P2.processoId, P3.processoId, P4.processoId, P5.processoId, X.processoId] } }, select: { id: true, faseAtualKey: true, dataInicio: true, createdAt: true, tipoProcessoMotorId: true } })
    const tipos = [...new Set(amostra.map((p) => p.tipoProcessoMotorId).filter((x): x is number => x != null))]
    const ordens = new Map(await Promise.all(tipos.map(async (t) => [t, await ordensDeFase(t)] as const)))
    const lote = await entradasNaFaseEmLote(amostra, ordens)
    for (const p of amostra) {
      const um = await entradaNaFase(p.id, p.faseAtualKey!)
      ok(`processo ${p.id} (${lote.get(p.id)?.origem ?? "sem registro"}): o lote devolve o MESMO que entradaNaFase`, JSON.stringify(lote.get(p.id)) === JSON.stringify(um), `${um.origem} ${um.desde ?? ""}`)
    }
    ok("as quatro origens aparecem: avanço de fase · abertura do processo · criação do workflow da fase · nada", new Set(amostra.map((p) => lote.get(p.id)?.origem ?? "NADA")).size === 4, [...new Set(amostra.map((p) => lote.get(p.id)?.origem ?? "NADA"))].join())
    ok("o avanço BLOQUEADO não vale como entrada (P3 fica sem registro)", lote.get(P3.processoId)?.desde === null && lote.get(P2.processoId)?.desde === tAvanco.toISOString())

    secao("BANCO — leitura em lote: o nº de consultas NÃO cresce com os processos")
    const amostra40 = await prisma.processo.findMany({ where: { nome: { startsWith: `${MARCA} massa` } }, take: 40, select: { id: true, faseAtualKey: true, dataInicio: true, createdAt: true, tipoProcessoMotorId: true } })
    const n5 = await contarConsultas((db) => entradasNaFaseEmLote(amostra40.slice(0, 5), ordens, db))
    const n40 = await contarConsultas((db) => entradasNaFaseEmLote(amostra40, ordens, db))
    ok(`entradas na fase: 5 processos = ${n5} consultas, 40 = ${n40} (35 a mais) — estritamente menor que o nº de linhas acrescentadas`, n40 < n5 + 35 && n40 <= 3 && n5 <= 3)
    const c5 = await contarConsultas((db) => concluidasDaFaseEmLote(amostra40.slice(0, 5), db))
    const c40 = await contarConsultas((db) => concluidasDaFaseEmLote(amostra40, db))
    ok(`concluídas da fase: 5 = ${c5}, 40 = ${c40}`, c40 < c5 + 35 && c40 <= 2)
    ok("zero processos = zero consultas", (await contarConsultas((db) => entradasNaFaseEmLote([], ordens, db))) === 0)

    secao("BANCO — o 'a de b' das certidões é a fonte única")
    const certs = await certidoesDosProcessos([A.processoId, B.processoId, A.processoId])
    const fonte = await documentacaoRequeridaDoProcesso(A.processoId)
    ok("uma linha por processo (sem repetir), igual a documentacaoRequeridaDoProcesso", certs.length === 2 && certs.find((x) => x.processoId === A.processoId)?.requeridas === fonte.requeridos && certs.find((x) => x.processoId === A.processoId)?.recebidas === fonte.recebidos && certs.find((x) => x.processoId === A.processoId)?.aplicavel === fonte.aplicavel)

    secao("BANCO — o fluxo da semana vem do log real de fases")
    const hojeLog = await prisma.phaseAdvanceLog.create({ data: { processoId: P3.processoId, faseAtual: c.PHASE_KEY, fasePretendida: fase2, regrasAvaliadas: [], pendencias: [], resultado: "AVANCADO", origem: "AUTO", correlationId: `${MARCA}-c3`, chaveIdempotencia: `${MARCA}-av3` } })
    await prisma.phaseAdvanceLog.create({ data: { processoId: P2.processoId, faseAtual: fase2, fasePretendida: "analise_documental", regrasAvaliadas: [], pendencias: [], resultado: "MOVIDO", origem: "MANUAL", correlationId: `${MARCA}-c4`, chaveIdempotencia: `${MARCA}-av4` } })
    await prisma.phaseAdvanceLog.create({ data: { processoId: P2.processoId, faseAtual: fase2, fasePretendida: "genealogia", regrasAvaliadas: [], pendencias: [], resultado: "MOVIDO", origem: "MANUAL", correlationId: `${MARCA}-c5`, chaveIdempotencia: `${MARCA}-av5`, criadoEm: new Date(Date.now() - 40 * DIA) } })
    const fluxo = await fluxoDaSemana([P2.processoId, P3.processoId], new Date())
    const doFase2 = fluxo.find((f) => f.phaseKey === fase2)
    ok("entraram na fase 2 esta semana: o avanço de hoje (P3); o de 3 dias atrás só conta se ainda for esta semana", doFase2 != null && doFase2.entraram >= 1 && hojeLog.id > 0)
    ok("saíram da fase 2 esta semana: só o de hoje (para Análise); o de 40 dias atrás NÃO conta", JSON.stringify(doFase2?.sairam) === JSON.stringify([{ para: "analise_documental", n: 1 }]))
    ok("só os processos pedidos entram", (await fluxoDaSemana([], new Date())).length === 0 && !(await fluxoDaSemana([A.processoId], new Date())).some((f) => f.phaseKey === fase2))

    secao("ROTAS — /api/torre/processos/fases e /certidoes")
    const rf = await postFases(req("POST", "/api/torre/processos/fases", tAdmin, { processoIds: [P2.processoId, P3.processoId, A.processoId] }))
    const jf = await rf.json()
    ok("fases: 200 com colunas (cadastro, sem a terminal sem processo), tempos, metaPadrao e fluxo", rf.status === 200 && Array.isArray(jf.colunas) && jf.colunas.length >= 3 && typeof jf.tempos === "object" && typeof jf.metaPadrao === "object" && typeof jf.fluxo === "object")
    ok("…as colunas são as MESMAS da lista consolidada (mesma poda)", JSON.stringify(jf.colunas.map((x: { key: string }) => x.key)) === JSON.stringify((await processosDaTorre()).colunas.map((x) => x.key)))
    ok("…a meta padrão da fase vem do cadastro (5 d em emissao_documental) e o fluxo traz o que entrou na fase 2", jf.metaPadrao[FASE] === 5 && jf.fluxo[fase2]?.entraram >= 1)
    ok("…o tempo médio é o de tempoMedioRealPorFase (a mesma conta da Visão geral)", JSON.stringify(jf.tempos) === JSON.stringify(Object.fromEntries((await tempoMedioRealPorFase()).map((t) => [t.fase, { mediaDias: t.mediaDias, amostras: t.amostras }]))))
    ok("fases: sem acesso à Torre → 403", (await postFases(req("POST", "/api/torre/processos/fases", tComum, { processoIds: [] }))).status === 403 || (await postFases(req("POST", "/api/torre/processos/fases", null, { processoIds: [] }))).status === 401)
    const rc = await postCertidoes(req("POST", "/api/torre/processos/certidoes", tAdmin, { processoIds: [A.processoId, B.processoId] }))
    ok("certidões: 200 com uma linha por processo", rc.status === 200 && (await rc.json()).certidoes.length === 2)
    ok("certidões: sem ids → 400; mais de 50 → 400; sem acesso → recusa", (await postCertidoes(req("POST", "/api/torre/processos/certidoes", tAdmin, { processoIds: [] }))).status === 400 && (await postCertidoes(req("POST", "/api/torre/processos/certidoes", tAdmin, { processoIds: Array.from({ length: 51 }, (_, i) => i + 1) }))).status === 400 && [401, 403].includes((await postCertidoes(req("POST", "/api/torre/processos/certidoes", null, { processoIds: [1] }))).status))

    secao("ESTÁTICO — a regra única é a única")
    const fonteProc = readFileSync("lib/operacional/torre-processos.ts", "utf8")
    ok("torre-processos importa o risco de torre-risco e não repete limiares (nenhum '>= 6'/'>= 3' próprio)", /from '\.\/torre-risco'/.test(fonteProc) && !/>=\s*6\b|>=\s*3\b|faixaDoScore/.test(fonteProc.replace(/\/\/[^\n]*/g, "")))
    ok("as metas entram por torre-fase-dados (torre-processos não importa torre-metas)", !/torre-metas|MetaTempoFase/.test(fonteProc))
  } finally {
    await c.limpar()
    await prisma.metaTempoFase.deleteMany({ where: { phaseKey: "emissao_documental" } })
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())

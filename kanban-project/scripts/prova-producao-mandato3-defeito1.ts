// scripts/prova-producao-mandato3-defeito1.ts
//
// MANDATO "MÓDULO DE FASES" (21/09/2026), Mandato #3 — prova em PRODUÇÃO do
// Defeito 1 (retroação não disparada) usando EXCLUSIVAMENTE os processos
// sintéticos 632-637 e a fase sintética auditoria_final_fase_sintetica já
// preparados (Workflow Interno #47, macro tipo TESTEVIS_TIPO_AUDITORIA).
//
// 632/633/635/637 JÁ estavam corretamente reconciliados (1 instância + 1
// tarefa "Validar fase sintética" cada) antes deste script rodar — via o
// caminho fase.macro.reconciliar (publicação/resave do Macro), que já
// funcionava mesmo antes do fix. O que este script prova é o caminho NOVO:
// publicar uma NOVA VERSÃO do Workflow Interno #47 (via o serviço canônico
// `publicarWorkflow`, o mesmo endpoint que `?acao=publicar` usa) agora
// também dispara reconciliação (origem WORKFLOW_INTERNO) — sem duplicar
// nada do que já existia, e idempotente numa segunda execução.
//
// Mudança feita: slaDays do passo "Validar fase sintética" 0 → 1 → 0 (trivial,
// real, revertida ao final — não altera contagem de instância/tarefa).
//
// Uso:
//   EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/prova-producao-mandato3-defeito1.ts
import { exigirConfirmacaoDeEscritaEmProducao } from "./_banco-de-teste"
exigirConfirmacaoDeEscritaEmProducao(
  "mandato Módulo de Fases 21/09/2026, Mandato #3 — prova em produção do Defeito 1: publicar nova versão do Workflow Interno #47 (auditoria_final_fase_sintetica) dispara retroação; processos 632/633/635/637 e fase sintética já preparados, slaDays revertido ao final",
  "prova-producao-mandato3-defeito1.ts",
)

import { prisma } from "../lib/prisma"
import { publicarWorkflow } from "../src/services/publicacao-de-workflow"
import { enqueueReconciliacaoCatalogoFase } from "../src/lib/motor/reconciliar-fase-macro"
import { processarOutbox } from "../src/services/outbox-dispatcher"

const PROCESSOS_EM_ANDAMENTO = [632, 633, 635, 637]
const PROCESSOS_FINALIZADOS = [634, 636]
const FASE = "auditoria_final_fase_sintetica"
const WF_ID = 47
const STEP_ID = 518

let ok = 0, falhou = 0
const matriz: Array<{ requisito: string; esperado: string; encontrado: string; passou: boolean }> = []
function prova(requisito: string, esperado: string, encontrado: string, passou: boolean) {
  matriz.push({ requisito, esperado, encontrado, passou })
  if (passou) { ok++; console.log(`  ✅ ${requisito} — ${encontrado}`) }
  else { falhou++; console.error(`  ❌ ${requisito}\n     esperado : ${esperado}\n     encontrado: ${encontrado}`) }
}

async function contar(processoId: number) {
  const [instancias, tarefas] = await Promise.all([
    prisma.phaseWorkflowInstance.count({ where: { processoId, faseMacroKey: FASE } }),
    prisma.tarefa.count({ where: { processoId, faseMacroKey: FASE } }),
  ])
  return { instancias, tarefas }
}

async function main() {
  console.log("\n===================================================================")
  console.log("PROVA EM PRODUÇÃO — MANDATO #3, DEFEITO 1 (retroação não disparada)")
  console.log("===================================================================\n")

  // ── 0) Segurança — trava por construção ──────────────────────────────────
  const todos = [...PROCESSOS_EM_ANDAMENTO, ...PROCESSOS_FINALIZADOS]
  const processos = await prisma.processo.findMany({ where: { id: { in: todos } }, select: { id: true, nome: true } })
  if (processos.length !== todos.length) throw new Error("nem todos os processos sintéticos foram encontrados — abortando")
  for (const p of processos) {
    if (!p.nome.startsWith("[TESTE VISUAL]")) throw new Error(`SEGURANÇA: processo ${p.id} ("${p.nome}") não é sintético — abortando`)
  }
  const wf = await prisma.phaseInternalWorkflow.findUnique({ where: { id: WF_ID }, select: { phaseKey: true } })
  if (!wf || wf.phaseKey !== FASE) throw new Error(`SEGURANÇA: workflow #${WF_ID} não é o esperado (${FASE}) — abortando`)
  const admin = await prisma.usuario.findFirst({ where: { tipo: "admin" }, orderBy: { id: "asc" }, select: { id: true, nome: true } })
  if (!admin) throw new Error("nenhum admin no banco")
  console.log(`  ✅ ${todos.length}/${todos.length} processos confirmados sintéticos; workflow #${WF_ID} confirmado (${FASE}); autor: ${admin.nome} (#${admin.id})`)

  // ── 1) ANTES ───────────────────────────────────────────────────────────
  console.log("\n── 1) Estado ANTES ──")
  const antes: Record<number, { instancias: number; tarefas: number }> = {}
  for (const pid of todos) antes[pid] = await contar(pid)
  console.log(JSON.stringify(antes))
  for (const pid of PROCESSOS_EM_ANDAMENTO) {
    prova(`${pid}: já reconciliado antes deste script (estado herdado, correto)`, "instancias=1, tarefas=1", JSON.stringify(antes[pid]), antes[pid].instancias === 1 && antes[pid].tarefas === 1)
  }
  for (const pid of PROCESSOS_FINALIZADOS) {
    prova(`${pid} (finalizado): zero instância/tarefa`, "instancias=0, tarefas=0", JSON.stringify(antes[pid]), antes[pid].instancias === 0 && antes[pid].tarefas === 0)
  }
  const outboxAntes = await prisma.domainOutbox.count({ where: { chaveIdempotencia: { contains: `::${FASE}::WORKFLOW_INTERNO::` } } })
  prova("outbox WORKFLOW_INTERNO desta fase: zero antes (mecanismo nunca disparou)", "0", String(outboxAntes), outboxAntes === 0)

  // ── 2) Publicar NOVA VERSÃO do Workflow Interno (mudança trivial e real) ──
  console.log("\n── 2) Publicar nova versão do Workflow Interno #47 (slaDays 0→1) ──")
  await prisma.phaseInternalWorkflowStep.update({ where: { id: STEP_ID }, data: { slaDays: 1 } })
  const pub = await publicarWorkflow({ workflowId: WF_ID, actorId: admin.id })
  prova("publicação aceita", "ok=true", JSON.stringify(pub), pub.ok === true)

  await processarOutbox({ forcar: true })

  // ── 3) DEPOIS — outbox WORKFLOW_INTERNO disparou e alcançou os certos ────
  console.log("\n── 3) Prova: o gatilho novo disparou ──")
  const outboxDepois = await prisma.domainOutbox.findMany({
    where: { chaveIdempotencia: { contains: `::${FASE}::WORKFLOW_INTERNO::` } },
    select: { aggregateId: true, status: true, chaveIdempotencia: true },
  })
  const idsAlcancados = new Set(outboxDepois.map((o) => o.aggregateId))
  prova(
    "outbox WORKFLOW_INTERNO alcançou exatamente 632/633/635/637 (nunca 634/636)",
    JSON.stringify(PROCESSOS_EM_ANDAMENTO.sort()),
    JSON.stringify([...idsAlcancados].sort((a, b) => (a ?? 0) - (b ?? 0))),
    PROCESSOS_EM_ANDAMENTO.every((id) => idsAlcancados.has(id)) && PROCESSOS_FINALIZADOS.every((id) => !idsAlcancados.has(id)),
  )
  prova("todos os eventos WORKFLOW_INTERNO ficaram ENVIADO (processados)", "todos ENVIADO", JSON.stringify(outboxDepois.map((o) => o.status)), outboxDepois.every((o) => o.status === "ENVIADO"))

  console.log("\n── 4) Contagens continuam exatamente 1/1 — idempotente, sem duplicar ──")
  const depois: Record<number, { instancias: number; tarefas: number }> = {}
  for (const pid of todos) depois[pid] = await contar(pid)
  for (const pid of PROCESSOS_EM_ANDAMENTO) {
    prova(`${pid}: continua exatamente 1 instância + 1 tarefa (zero duplicação)`, "instancias=1, tarefas=1", JSON.stringify(depois[pid]), depois[pid].instancias === 1 && depois[pid].tarefas === 1)
  }
  for (const pid of PROCESSOS_FINALIZADOS) {
    const p = await prisma.processo.findUniqueOrThrow({ where: { id: pid }, select: { faseAtualKey: true, dataConclusao: true } })
    prova(`${pid} (finalizado): absolutamente intocado`, "instancias=0, tarefas=0, dataConclusao!=null", `${JSON.stringify(depois[pid])}, dataConclusao=${p.dataConclusao ? "sim" : "null"}`, depois[pid].instancias === 0 && depois[pid].tarefas === 0 && p.dataConclusao != null)
  }

  // ── 5) Segunda reconciliação (chamada direta, mesma origem) — idempotência ──
  console.log("\n── 5) Segunda reconciliação — zero duplicação ──")
  await enqueueReconciliacaoCatalogoFase({
    phaseKey: FASE, catalogoFaseId: (await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey: FASE }, select: { id: true } })).id,
    revisaoAnterior: pub.versaoAnterior ?? 0, revisaoNova: pub.versaoNova ?? 0,
    escopoMudou: false, publicadoPorId: admin.id, origem: "WORKFLOW_INTERNO",
  })
  await processarOutbox({ forcar: true })
  const depois2: Record<number, { instancias: number; tarefas: number }> = {}
  for (const pid of todos) depois2[pid] = await contar(pid)
  for (const pid of PROCESSOS_EM_ANDAMENTO) {
    prova(`${pid}: segunda reconciliação não duplica`, "instancias=1, tarefas=1", JSON.stringify(depois2[pid]), depois2[pid].instancias === 1 && depois2[pid].tarefas === 1)
  }

  // ── 6) Histórico registra a reconciliação com a origem correta ───────────
  console.log("\n── 6) Histórico ──")
  const historico = await prisma.logAuditoria.count({
    where: { entidade: "PROCESSO", entidadeId: { in: PROCESSOS_EM_ANDAMENTO }, acao: { in: ["RECONCILIACAO_SOLICITADA", "RECONCILIACAO_FASE_MACRO"] }, criadoEm: { gte: new Date(Date.now() - 10 * 60 * 1000) } },
  })
  prova("histórico registrou entradas de reconciliação nos últimos 10min", "> 0", String(historico), historico > 0)

  // ── 7) Reverter a mudança trivial (slaDays 1→0) ───────────────────────────
  console.log("\n── 7) Reverter slaDays (1→0) — devolve o Workflow Interno ao estado anterior ──")
  await prisma.phaseInternalWorkflowStep.update({ where: { id: STEP_ID }, data: { slaDays: 0 } })
  const pubRevert = await publicarWorkflow({ workflowId: WF_ID, actorId: admin.id })
  prova("reversão publicada", "ok=true", JSON.stringify(pubRevert), pubRevert.ok === true)
  const stepFinal = await prisma.phaseInternalWorkflowStep.findUniqueOrThrow({ where: { id: STEP_ID }, select: { slaDays: true } })
  prova("slaDays restaurado", "0", String(stepFinal.slaDays), stepFinal.slaDays === 0)

  console.log(`\n=== RESULTADO: ${ok} ok, ${falhou} falhas ===`)
  console.log(JSON.stringify(matriz, null, 2))
  if (falhou > 0) process.exitCode = 1
}

main().finally(() => prisma.$disconnect())

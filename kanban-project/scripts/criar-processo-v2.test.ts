// scripts/criar-processo-v2.test.ts
// Testes da criação V2-nativa. Rodar: tsx scripts/criar-processo-v2.test.ts
// Integração contra o banco (cria processos de teste marcados e os REMOVE no fim).
import { prisma } from "@/lib/prisma"
import { randomUUID } from "crypto"
import { criarProcessoV2 } from "@/src/services/criar-processo"
import { primeiraFasePorOrdem, montarEventoEntered } from "@/src/lib/motor/phase-advance-helpers"

const TIPO_ID = 14 // Nacionalidade Alemã · Administrativa (alemanha)
const PAIS = "alemanha"
const MARK = "__TEST_V2__"

let passed = 0, failed = 0
const criados = new Set<number>()
function ok(cond: boolean, nome: string, extra?: unknown) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; console.log(`  ❌ ${nome}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`) }
}

async function limpar(processoId: number) {
  const tarefas = await prisma.tarefa.findMany({ where: { processoId }, select: { id: true } })
  const taskIds = tarefas.map((t) => t.id)
  const insts = await prisma.phaseWorkflowInstance.findMany({ where: { processoId }, select: { id: true } })
  const instIds = insts.map((i) => i.id)
  await prisma.domainOutbox.deleteMany({ where: { OR: [
    { aggregateType: "Processo", aggregateId: processoId },
    { aggregateType: "Tarefa", aggregateId: { in: taskIds.length ? taskIds : [-1] } },
    { aggregateType: "PhaseWorkflowInstance", aggregateId: { in: instIds.length ? instIds : [-1] } },
  ] } })
  await prisma.workflowEvento.deleteMany({ where: { processoId } })
  await prisma.phaseAdvanceLog.deleteMany({ where: { processoId } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: "PROCESSO", entidadeId: processoId } })
  await prisma.processo.delete({ where: { id: processoId } }).catch(() => {})
}

async function main() {
  console.log("\nCriação V2-nativa — testes\n")

  // ── PUROS (sem DB) ────────────────────────────────────────────────────────
  console.log("1) Helpers puros")
  ok(primeiraFasePorOrdem([{ phaseKey: "b", ordem: 2 }, { phaseKey: "a", ordem: 1 }]) === "a", "primeira fase = menor ordem (não por label)")
  ok(primeiraFasePorOrdem([]) === null, "sem fases → null")
  const evt = montarEventoEntered({
    processoId: 1, faseAnteriorKey: "", faseAnteriorInstanceId: null, faseNovaKey: "genealogia",
    faseNovaInstanceId: 9, ciclo: 1, operacao: "AVANCAR", origem: "process_created",
    macroVersion: 1, chaveTransicao: "criar|x", correlationId: "c", occurredAt: "2026-01-01T00:00:00Z",
    transitionReason: "initial_phase",
  })
  ok(evt.tipo === "phase.entered", "evento é phase.entered")
  ok((evt.payload.previousPhaseId ?? null) === null, "previousPhaseId = null no nascimento")
  ok(evt.payload.source === "process_created", "source = process_created")
  ok(evt.payload.transitionReason === "initial_phase", "transitionReason = initial_phase")

  // ── VALIDAÇÕES (rejeições baratas, sem mutação) ───────────────────────────
  console.log("\n2) Rejeições de configuração")
  const r1 = await criarProcessoV2({ nome: "", pais: PAIS, tipoProcessoMotorId: TIPO_ID })
  ok(!r1.success && r1.code === "NOME_OBRIGATORIO", "nome vazio → NOME_OBRIGATORIO")
  const r2 = await criarProcessoV2({ nome: MARK, pais: "narnia", tipoProcessoMotorId: TIPO_ID })
  ok(!r2.success && r2.code === "PAIS_INVALIDO", "país inexistente → PAIS_INVALIDO")
  const r3 = await criarProcessoV2({ nome: MARK, pais: PAIS, tipoProcessoMotorId: 999999 })
  ok(!r3.success && r3.code === "TIPO_INVALIDO", "tipo inexistente → TIPO_INVALIDO")

  // ── HAPPY PATH (nascimento completo) ──────────────────────────────────────
  console.log("\n3) Nascimento V2 completo")
  const res = await criarProcessoV2({ nome: `${MARK} happy`, pais: PAIS, tipoProcessoMotorId: TIPO_ID })
  if (!res.success) { ok(false, "criação bem-sucedida", res); return }
  criados.add(res.processId)
  ok(res.success && res.created, "criado (created=true)")
  ok(res.workflowRuntime === "v2", "runtime = v2")
  ok(res.currentPhaseKey === "genealogia", "1ª fase = genealogia (menor ordem)", res.currentPhaseKey)
  ok(res.currentPhaseInstanceId > 0, "PhaseInstance criada")
  ok(res.workflowMacroVersionId > 0, "versão do macro registrada (snapshot)")
  ok(res.tarefasIniciais === 5, "5 tarefas iniciais geradas", res.tarefasIniciais)
  ok(res.initializationStatus === "INITIALIZED", "initializationStatus = INITIALIZED")

  const proc = await prisma.processo.findUnique({ where: { id: res.processId } })
  ok(proc?.workflowRuntime === "v2", "Processo.workflowRuntime persistido = v2")
  ok(proc?.faseAtualKey === "genealogia", "faseAtualKey persistida")
  ok(proc?.macroWorkflowVersion != null, "macroWorkflowVersion persistida")

  const insts = await prisma.phaseWorkflowInstance.count({ where: { processoId: res.processId } })
  ok(insts === 1, "exatamente 1 instância de Workflow Interno", insts)
  const steps = await prisma.phaseWorkflowStepInstance.count({ where: { processoId: res.processId } })
  ok(steps === 5, "5 passos instanciados", steps)
  const tarefas = await prisma.tarefa.count({ where: { processoId: res.processId } })
  ok(tarefas === 5, "5 tarefas no banco", tarefas)
  const entered = await prisma.domainOutbox.findFirst({ where: { aggregateType: "Processo", aggregateId: res.processId, tipo: "phase.entered" } })
  ok(entered != null, "phase.entered inicial na outbox")
  ok((entered?.payload as Record<string, unknown>)?.transitionReason === "initial_phase", "phase.entered.transitionReason = initial_phase")
  const audit = await prisma.logAuditoria.findFirst({ where: { entidade: "PROCESSO", entidadeId: res.processId, acao: "PROCESSO_INICIALIZADO_V2" } })
  ok(audit != null, "auditoria de inicialização registrada")

  // ── IDEMPOTÊNCIA (mesma chave ⇒ mesmo processo) ───────────────────────────
  console.log("\n4) Idempotência")
  const key = `it-${randomUUID()}`
  const a = await criarProcessoV2({ nome: `${MARK} idem`, pais: PAIS, tipoProcessoMotorId: TIPO_ID, idempotencyKey: key })
  const b = await criarProcessoV2({ nome: `${MARK} idem`, pais: PAIS, tipoProcessoMotorId: TIPO_ID, idempotencyKey: key })
  if (a.success) criados.add(a.processId)
  ok(a.success && b.success && a.processId === b.processId, "mesma idempotencyKey → mesmo processId", { a: a.success && a.processId, b: b.success && b.processId })
  ok(b.success && !b.created, "2ª chamada devolve created=false (não duplicou)")
  if (a.success) {
    const dupInst = await prisma.phaseWorkflowInstance.count({ where: { processoId: a.processId } })
    const dupTar = await prisma.tarefa.count({ where: { processoId: a.processId } })
    ok(dupInst === 1, "sem instância duplicada", dupInst)
    ok(dupTar === 5, "sem tarefa duplicada", dupTar)
  }

  // ── CONCORRÊNCIA (2 requisições simultâneas, mesma chave) ─────────────────
  console.log("\n5) Concorrência (mesma idempotencyKey)")
  const ck = `cc-${randomUUID()}`
  const [c1, c2] = await Promise.all([
    criarProcessoV2({ nome: `${MARK} conc`, pais: PAIS, tipoProcessoMotorId: TIPO_ID, idempotencyKey: ck }),
    criarProcessoV2({ nome: `${MARK} conc`, pais: PAIS, tipoProcessoMotorId: TIPO_ID, idempotencyKey: ck }),
  ])
  if (c1.success) criados.add(c1.processId)
  if (c2.success) criados.add(c2.processId)
  ok(c1.success && c2.success && c1.processId === c2.processId, "corrida → UM único processo", { c1: c1.success && c1.processId, c2: c2.success && c2.processId })
  if (c1.success) {
    const n = await prisma.processo.count({ where: { chaveIdempotenciaCriacao: `criar|${ck}` } })
    ok(n === 1, "exatamente 1 processo com a chave", n)
    const ci = await prisma.phaseWorkflowInstance.count({ where: { processoId: c1.processId } })
    ok(ci === 1, "1 instância na corrida", ci)
    const ct = await prisma.tarefa.count({ where: { processoId: c1.processId } })
    ok(ct === 5, "5 tarefas na corrida (sem duplicar)", ct)
  }
}

main()
  .catch((e) => { failed++; console.error("ERRO FATAL:", e) })
  .finally(async () => {
    console.log(`\n🧹 limpando ${criados.size} processo(s) de teste...`)
    for (const id of criados) await limpar(id)
    // varredura extra por marcador (garante zero resíduo mesmo em falha parcial)
    const resto = await prisma.processo.findMany({ where: { nome: { startsWith: MARK } }, select: { id: true } })
    for (const p of resto) await limpar(p.id)
    const sobra = await prisma.processo.count({ where: { nome: { startsWith: MARK } } })
    ok(sobra === 0, "cleanup: nenhum processo de teste remanescente", sobra)
    console.log(`\n${passed} passaram, ${failed} falharam`)
    await prisma.$disconnect()
    process.exit(failed === 0 ? 0 : 1)
  })

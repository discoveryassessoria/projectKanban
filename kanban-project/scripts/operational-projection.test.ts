/**
 * TESTE — núcleo puro do RESOLVER CANÔNICO da projeção operacional.
 * Rodar: tsx scripts/operational-projection.test.ts
 *
 * Cobre (sem banco): os 3 ESCOPOS (PROCESSO/NECESSIDADE/DOCUMENTO), coexistência de
 * passos genéricos legados + vinculados (genéricos ignorados), 100% sem bloqueio,
 * bloqueio caindo o percentual abaixo de 100, e metrics/nextAction/operationalState.
 */
import {
  buildOperationalProjection,
  type ProjectionInput,
  type GateStepData,
  type NecessidadeData,
  type DocumentoData,
} from "../src/lib/motor/operational-projection-core"
import type { WorkflowScope } from "../src/lib/process-stage/fases-catalog"

let passed = 0, failed = 0
const viol: string[] = []
function ok(c: boolean, n: string) { if (c) { passed++; console.log(`  ✅ ${n}`) } else { failed++; viol.push(n); console.log(`  ❌ ${n}`) } }

// ---- builders de passo ----
let sid = 0
function step(p: Partial<GateStepData> & { ordem: number; status: string }): GateStepData {
  return {
    id: ++sid, stepKey: p.stepKey ?? `step_${p.ordem}`, ordem: p.ordem, status: p.status,
    obrigatorio: p.obrigatorio ?? true, tipo: p.tipo ?? "HUMANO", geraTarefa: p.geraTarefa ?? false,
    documentoId: p.documentoId ?? null, necessidadeId: p.necessidadeId ?? null,
    bloqueadoManual: p.bloqueadoManual ?? false, motivo: p.motivo ?? null,
    snapshot: p.snapshot ?? null, dependeDeStepKeys: p.dependeDeStepKeys ?? null, tarefas: p.tarefas ?? [],
  }
}
function base(scope: WorkflowScope, over: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    processId: 1, faseCode: null, faseMacroKey: "fase_x", phaseName: "Fase X", scope,
    processoExists: true, hasActiveInstance: true, steps: [], necessidades: [], documentos: [],
    hasArvore: true, requerentesCount: 1, ...over,
  }
}

// ============================================================
console.log("\n1) PROCESSO — progresso parcial sobre passos genéricos legítimos")
{
  const input = base("PROCESSO", {
    steps: [
      step({ ordem: 1, status: "CONCLUIDO", stepKey: "a" }),
      step({ ordem: 2, status: "DISPONIVEL", stepKey: "b" }),
      step({ ordem: 3, status: "PENDENTE", stepKey: "c" }),
    ],
  })
  const p = buildOperationalProjection(input)
  ok(p.activePhase?.scope === "PROCESSO", "escopo PROCESSO")
  ok(p.progress.totalWeight === 3 && p.progress.completedWeight === 1, "1/3 passos concluídos")
  ok(p.progress.percentage === 33, "33%")
  ok(p.status.blocked === true && p.status.canAdvance === false, "bloqueado (passos obrigatórios abertos)")
  ok(p.status.operationalState === "BLOQUEADA", "estado BLOQUEADA")
  ok(p.nextAction?.key === "b", "próxima ação = 1º passo pendente (b)")
  ok(p.metrics.required === 3 && p.metrics.completed === 1 && p.metrics.blocked >= 1, "metrics coerentes")
}

console.log("\n2) PROCESSO — 100% sem bloqueio → PRONTA_PARA_AVANCAR")
{
  const input = base("PROCESSO", {
    steps: [step({ ordem: 1, status: "CONCLUIDO" }), step({ ordem: 2, status: "DISPENSADO" })],
  })
  const p = buildOperationalProjection(input)
  ok(p.progress.percentage === 100, "100%")
  ok(p.status.blocked === false && p.status.canAdvance === true, "sem bloqueio, pode avançar")
  ok(p.status.operationalState === "PRONTA_PARA_AVANCAR", "estado PRONTA_PARA_AVANCAR")
  ok(p.nextAction?.key === "advance_phase", "próxima ação = avançar fase")
}

console.log("\n3) NECESSIDADE — múltiplas necessidades, progresso pelas OBRIGATÓRIAS localizadas")
{
  const necessidades: NecessidadeData[] = [
    { id: 10, status: "PENDENTE", obrigatoria: true, ehCertidao: true },
    { id: 11, status: "PENDENTE", obrigatoria: true, ehCertidao: true },
    { id: 12, status: "PENDENTE", obrigatoria: true, ehCertidao: true },
    { id: 13, status: "PENDENTE", obrigatoria: false, ehCertidao: true }, // opcional não entra no %
    { id: 14, status: "PENDENTE", obrigatoria: true, ehCertidao: false }, // não-certidão ignorada
  ]
  const steps = [
    step({ ordem: 1, status: "CONCLUIDO", necessidadeId: 10, stepKey: "localizar_registro" }),
    step({ ordem: 1, status: "CONCLUIDO", necessidadeId: 11, stepKey: "localizar_registro" }),
    step({ ordem: 1, status: "DISPONIVEL", necessidadeId: 12, stepKey: "localizar_registro" }),
  ]
  const p = buildOperationalProjection(base("NECESSIDADE", { necessidades, steps }))
  ok(p.activePhase?.scope === "NECESSIDADE", "escopo NECESSIDADE")
  ok(p.progress.totalWeight === 3, "denominador = 3 obrigatórias de certidão (ignora opcional e não-certidão)")
  ok(p.progress.completedWeight === 2 && p.progress.percentage === 67, "2/3 localizadas = 67%")
  ok(p.status.blocked === true, "bloqueado (passo obrigatório da nec 12 aberto)")
}

console.log("\n4) NECESSIDADE — sem necessidades geradas → bloqueia NECESSIDADE_NAO_GERADA")
{
  const p = buildOperationalProjection(base("NECESSIDADE", { necessidades: [] }))
  ok(p.status.blocked === true, "bloqueado")
  ok(p.progress.percentage === 0, "0% (nada gerado)")
  ok(p.metrics.blocked >= 1, "há bloqueio contabilizado")
}

console.log("\n5) DOCUMENTO — múltiplos documentos; doc concluído = última etapa concluída")
{
  const documentos: DocumentoData[] = [
    { id: 100, status: "PENDENTE", linhaReta: true },
    { id: 101, status: "PENDENTE", linhaReta: true },
    { id: 102, status: "PENDENTE", linhaReta: true },
    { id: 103, status: "CANCELADO", linhaReta: true }, // excluído do denominador
  ]
  const mk = (doc: number, lastStatus: string) => ([
    step({ ordem: 1, status: "CONCLUIDO", documentoId: doc, stepKey: "solicitar" }),
    step({ ordem: 2, status: lastStatus, documentoId: doc, stepKey: "validar" }),
  ])
  const steps = [...mk(100, "CONCLUIDO"), ...mk(101, "CONCLUIDO"), ...mk(102, "DISPONIVEL")]
  const p = buildOperationalProjection(base("DOCUMENTO", { documentos, steps }))
  ok(p.activePhase?.scope === "DOCUMENTO", "escopo DOCUMENTO")
  ok(p.progress.totalWeight === 3, "denominador = 3 docs da linha reta (exclui CANCELADO)")
  ok(p.progress.completedWeight === 2 && p.progress.percentage === 67, "2/3 docs concluídos = 67%")
}

console.log("\n6) Coexistência de passos GENÉRICOS legados + VINCULADOS (genéricos ignorados)")
{
  const documentos: DocumentoData[] = [
    { id: 100, status: "PENDENTE", linhaReta: true },
    { id: 101, status: "PENDENTE", linhaReta: true },
  ]
  const steps = [
    step({ ordem: 1, status: "PENDENTE", stepKey: "generico_a" }),   // órfão legado
    step({ ordem: 2, status: "PENDENTE", stepKey: "generico_b" }),   // órfão legado
    step({ ordem: 1, status: "CONCLUIDO", documentoId: 100, stepKey: "validar" }),
    step({ ordem: 1, status: "CONCLUIDO", documentoId: 101, stepKey: "validar" }),
  ]
  const p = buildOperationalProjection(base("DOCUMENTO", { documentos, steps }))
  ok(p.progress.percentage === 100, "genéricos órfãos NÃO contam nem bloqueiam → 100%")
  ok(p.status.blocked === false && p.status.canAdvance === true, "sem bloqueio pelos genéricos legados")
}

console.log("\n7) DOCUMENTO — fase recém-ativada (sem passo por-doc) → necessidade GATA como proxy")
{
  const necessidades: NecessidadeData[] = [{ id: 10, status: "PENDENTE", obrigatoria: true, ehCertidao: true }]
  const documentos: DocumentoData[] = [{ id: 100, status: "PENDENTE", linhaReta: true }]
  const p = buildOperationalProjection(base("DOCUMENTO", { necessidades, documentos, steps: [], hasActiveInstance: false }))
  ok(p.status.blocked === true, "necessidade obrigatória pendente gata a fase DOCUMENTO não materializada")
  ok(p.status.canAdvance === false, "não pode avançar prematuramente")
}

console.log("\n8) SEM_FASE — processo sem fase ativa")
{
  const p = buildOperationalProjection(base("PROCESSO", { faseMacroKey: null, phaseName: null }))
  ok(p.activePhase === null, "activePhase null")
  ok(p.status.operationalState === "SEM_FASE", "estado SEM_FASE")
}

// ============================================================
console.log(`\n${failed === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("Violações:", viol.join("; ")); process.exit(1) }

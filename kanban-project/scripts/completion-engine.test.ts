/**
 * Motor de Conclusão — testes do núcleo PURO (sem servidor/DB).
 * Rodar: npm run test:completion
 */

import {
  evaluateStepCompletion,
  evaluateWorkflowProgress,
  evaluatePhaseProgress,
  canCompletePhase,
  normalizePolicy,
  type DocumentFact,
  type StepCompletionResult,
} from "../src/services/completion-engine/policies"

const NOW = new Date("2026-01-01T00:00:00Z")

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

const doc = (over: Partial<DocumentFact>): DocumentFact => ({
  located: false, received: false, validated: false, required: true, ...over,
})
const stepInput = (result: StepCompletionResult, weight = 1) => ({ weight, result })

console.log("Motor de Conclusão — núcleo puro\n")

// 1) Documento em SOLICITAR: passo aberto, workflow < 100%, fase não concluída
console.log("1) Documento em SOLICITAR (não localizado):")
{
  const step = evaluateStepCompletion({
    rawPolicy: "ALL_REQUIRED_DOCUMENTS_LOCATED",
    now: NOW,
    requiredDocuments: [doc({ ref: "1", located: false })],
  })
  ok(step.completed === false, "passo NÃO concluído")
  ok(step.progress < 100, "progresso < 100%")
  ok(step.blockers.some((b) => b.mandatory), "tem blocker obrigatório")
  const wf = evaluateWorkflowProgress([stepInput(step)], NOW)
  ok(wf.completed === false && wf.progress < 100, "workflow < 100% e não concluído")
  const phase = evaluatePhaseProgress([wf], [], NOW)
  ok(phase.completed === false, "fase não concluída")
}

// 2) Tarefa humana concluída, documento não localizado → step aberto (regra 1)
console.log("\n2) Tarefa concluída, documento NÃO localizado:")
{
  const step = evaluateStepCompletion({
    rawPolicy: "DOCUMENT_LOCATED",
    now: NOW,
    self: doc({ located: false }),
    linkedTasks: [{ completed: true }], // tarefa concluída NÃO conclui o passo
  })
  ok(step.completed === false, "tarefa concluída NÃO conclui passo (regra 1)")
  const wf = evaluateWorkflowProgress([stepInput(step)], NOW)
  ok(wf.completed === false, "workflow não concluído")
}

// 3) Dez documentos, nove localizados → 90%, não avança
console.log("\n3) 10 documentos, 9 localizados:")
{
  const docs = Array.from({ length: 10 }, (_, i) => doc({ ref: String(i), located: i < 9 }))
  const step = evaluateStepCompletion({ rawPolicy: "ALL_REQUIRED_DOCUMENTS_LOCATED", now: NOW, requiredDocuments: docs })
  ok(step.progress === 90, "progresso = 90%")
  ok(step.completed === false, "passo não concluído")
  const phase = evaluatePhaseProgress([evaluateWorkflowProgress([stepInput(step)], NOW)], [], NOW)
  ok(canCompletePhase(phase).can === false, "avanço bloqueado")
}

// 4) Último documento localizado → passo/workflow/fase concluídos
console.log("\n4) Último documento localizado (10/10):")
{
  const docs = Array.from({ length: 10 }, (_, i) => doc({ ref: String(i), located: true }))
  const step = evaluateStepCompletion({ rawPolicy: "ALL_REQUIRED_DOCUMENTS_LOCATED", now: NOW, requiredDocuments: docs })
  ok(step.completed === true && step.progress === 100, "passo concluído a 100%")
  const wf = evaluateWorkflowProgress([stepInput(step)], NOW)
  ok(wf.completed === true, "workflow concluído")
  const phase = evaluatePhaseProgress([wf], [], NOW)
  ok(phase.completed === true && canCompletePhase(phase).can === true, "fase concluída e avanço liberado")
}

// 5) Blocker obrigatório aberto → workflow/fase não concluídos, avanço negado
console.log("\n5) Blocker obrigatório aberto:")
{
  const step = evaluateStepCompletion({ rawPolicy: "DOCUMENT_RECEIVED", now: NOW, self: doc({ received: false }) })
  const wf = evaluateWorkflowProgress([stepInput(step)], NOW)
  ok(wf.completed === false, "workflow não concluído com blocker obrigatório (regra 6)")
  const phase = evaluatePhaseProgress([wf], [], NOW)
  ok(phase.completed === false, "fase não concluída")
  ok(canCompletePhase(phase).can === false, "avanço negado (regra 9)")
}

// 6) completionPolicy = TASK_COMPLETED → tarefa concluída pode concluir o passo
console.log("\n6) completionPolicy = TASK_COMPLETED:")
{
  const okStep = evaluateStepCompletion({ rawPolicy: "TASK_COMPLETED", now: NOW, linkedTasks: [{ completed: true }] })
  ok(okStep.completed === true, "tarefa concluída conclui o passo (policy explícita)")
  const pendStep = evaluateStepCompletion({ rawPolicy: "TASK_COMPLETED", now: NOW, linkedTasks: [{ completed: false }] })
  ok(pendStep.completed === false, "tarefa pendente NÃO conclui")
}

// 7) completionPolicy ausente/desconhecida → NEEDS_REVIEW, não conclui
console.log("\n7) Política ausente/desconhecida:")
{
  ok(normalizePolicy(null) === "NEEDS_REVIEW", "null → NEEDS_REVIEW")
  ok(normalizePolicy("QUALQUER_COISA") === "NEEDS_REVIEW", "desconhecida → NEEDS_REVIEW")
  const s1 = evaluateStepCompletion({ rawPolicy: null, now: NOW })
  ok(s1.completed === false && s1.policy === "NEEDS_REVIEW", "ausente: não conclui + NEEDS_REVIEW")
  const s2 = evaluateStepCompletion({ rawPolicy: "GARBAGE_POLICY", now: NOW })
  ok(s2.completed === false, "desconhecida: não conclui")
  ok(s2.policy !== "TASK_COMPLETED", "NUNCA assume TASK_COMPLETED por padrão (regra 8)")
  ok(s2.blockers.some((b) => b.code === "POLICY_NEEDS_REVIEW" && b.mandatory), "blocker POLICY_NEEDS_REVIEW obrigatório")
}

// 8) Legacy sem regressão: MANUAL_CONFIRMATION e DOCUMENT_* seguem funcionando
console.log("\n8) Legacy (sem regressão):")
{
  const manual = evaluateStepCompletion({ rawPolicy: "MANUAL_CONFIRMATION", now: NOW })
  ok(manual.completed === true, "MANUAL_CONFIRMATION continua liberando (sem trava)")
  const locOk = evaluateStepCompletion({ rawPolicy: "DOCUMENT_LOCATED", now: NOW, self: doc({ located: true }) })
  ok(locOk.completed === true, "DOCUMENT_LOCATED com ato localizado conclui")
  const recNo = evaluateStepCompletion({ rawPolicy: "DOCUMENT_RECEIVED", now: NOW, self: doc({ received: false }) })
  ok(recNo.completed === false && recNo.reason.length > 0, "DOCUMENT_RECEIVED sem arquivo trava com mensagem")
}

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
console.log("Motor de Conclusão: todos os testes verdes ✅")

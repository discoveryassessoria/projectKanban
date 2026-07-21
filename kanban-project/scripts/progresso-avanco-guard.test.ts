// scripts/progresso-avanco-guard.test.ts
// GUARDA PERMANENTE das invariantes de progresso/avanço (regressão do 99%).
// Puro (sem DB): exercita buildOperationalProjection/computeGate diretamente.
// Rodar: tsx scripts/progresso-avanco-guard.test.ts
import { buildOperationalProjection, computeGate, type ProjectionInput, type GateStepData } from "@/src/lib/motor/operational-projection-core";

let ok = 0, fail = 0;
function check(cond: boolean, nome: string, extra?: unknown) { if (cond) { ok++; console.log(`  OK  ${nome}`); } else { fail++; console.log(`  XX  ${nome}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`); } }

function step(over: Partial<GateStepData> = {}): GateStepData {
  return { id: 1, stepKey: "localizar_registro", ordem: 1, status: "CONCLUIDO", obrigatorio: true, tipo: "HUMANO", geraTarefa: false, documentoId: null, necessidadeId: 23, bloqueadoManual: false, motivo: null, snapshot: null, dependeDeStepKeys: null, tarefas: [], ...over };
}
function baseInput(over: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    processId: 1, faseCode: null, faseMacroKey: "genealogia", phaseName: "Genealogia", scope: "NECESSIDADE",
    processoExists: true, hasActiveInstance: true,
    steps: [step()],
    necessidades: [{ id: 23, status: "ATENDIDA", obrigatoria: true, ehCertidao: true }],
    documentos: [{ id: 2067, status: "SOLICITAR", linhaReta: true, necessidadeId: 23 }],
    hasArvore: true, requerentesCount: 1, ...over,
  };
}

console.log("\nGuarda progresso↔avanço (regressão 99%)\n");

// 1) 1/1 obrigatório concluído + requerente na árvore + sem blocker → 100% + avança
{
  const proj = buildOperationalProjection(baseInput());
  check(proj.progress.percentage === 100, "1) 1/1 concluído sem blocker → 100%", proj.progress);
  check(proj.status.blocked === false && proj.status.canAdvance === true, "1b) blocked=false, canAdvance=true", proj.status);
  check(proj.status.operationalState === "PRONTA_PARA_AVANCAR", "1c) PRONTA_PARA_AVANCAR", proj.status);
  check(proj.nextAction?.key === "advance_phase", "1d) próxima ação = avançar fase (sem 'Solicitar certidão')", proj.nextAction);
}

// 2) passo CONCLUÍDO com tarefa PENDENTE não pode bloquear (guarda do passo concluído)
{
  const proj = buildOperationalProjection(baseInput({ steps: [step({ tarefas: [{ id: 9, statusTarefa: "PENDENTE", responsavelId: null }] })] }));
  check(proj.status.blocked === false && proj.progress.percentage === 100, "2) passo concluído c/ tarefa pendente → 100%, não bloqueia", { b: proj.status.blocked, p: proj.progress.percentage });
}

// 3) requerente da ÁRVORE = 0 → bloqueado (regra legítima, não mascarada por 99)
{
  const proj = buildOperationalProjection(baseInput({ requerentesCount: 0 }));
  check(proj.status.blocked === true && proj.metrics.blocked >= 1, "3) sem requerente → bloqueado com issue real", proj.status);
  check(proj.progress.percentage <= 99, "3b) bloqueado nunca exibe 100%", proj.progress);
}

// 4) FONTE ÚNICA: blocked da projeção == existe BLOCKING no computeGate
{
  const inp = baseInput();
  const gate = computeGate(inp).filter((i) => i.severity === "BLOCKING");
  const proj = buildOperationalProjection(inp);
  check((gate.length > 0) === proj.status.blocked, "4) gate e projeção concordam (fonte única)", { gate: gate.length, blocked: proj.status.blocked });
}

// 5) nunca 99 quando desbloqueado e tudo concluído (invariante 100 ⟺ pode avançar)
{
  const proj = buildOperationalProjection(baseInput());
  check(!(proj.status.canAdvance && proj.progress.percentage !== 100), "5) canAdvance ⟹ 100% (nunca 99 travado)", proj.progress);
}

console.log(`\n${ok} passaram, ${fail} falharam\n`);
process.exit(fail > 0 ? 1 : 0);

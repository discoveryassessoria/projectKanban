// src/services/workflow-definition-validator.ts
// CP-4B — validação COMPLETA da definição antes de qualquer escrita (seção 7).
// PURO (sem prisma). Se houver erro: nenhuma escrita deverá ocorrer.

import {
  type DefWorkflow,
  type DefStep,
  type WorkflowValidationIssue,
  type WorkflowValidationResult,
  mapearTipoPasso,
  detectarCicloDependencia,
  dependenciasInvalidas,
  detectarOrdemDuplicada,
} from "./phase-workflow-helpers"

export function validarDefinicao(workflow: DefWorkflow, steps: DefStep[]): WorkflowValidationResult {
  const errors: WorkflowValidationIssue[] = []
  const warnings: WorkflowValidationIssue[] = []

  // Workflow
  if (!workflow.active || workflow.arquivado) {
    errors.push({ code: "SEM_VERSAO_ATIVA", message: "Workflow interno inativo/arquivado" })
  }
  if (!Number.isInteger(workflow.versao) || workflow.versao < 1) {
    errors.push({ code: "SEM_VERSAO_ATIVA", message: `Versão inválida: ${workflow.versao}` })
  }

  // Pelo menos um passo
  if (!steps || steps.length === 0) {
    errors.push({ code: "WORKFLOW_SEM_PASSOS", message: "Workflow interno sem passos" })
    return { valid: false, errors, warnings }
  }

  // stepKey presente + única
  const vistos = new Set<string>()
  for (const s of steps) {
    if (!s.key || !s.key.trim()) {
      errors.push({ code: "STEP_SEM_KEY", message: `Passo ${s.id} sem stepKey estável`, entityId: s.id })
      continue
    }
    if (vistos.has(s.key)) {
      errors.push({ code: "STEP_KEY_DUPLICADA", message: `stepKey duplicada: ${s.key}`, stepKey: s.key })
    }
    vistos.add(s.key)

    if (!Number.isInteger(s.ordem) || s.ordem < 0) {
      errors.push({ code: "CONFIGURACAO_INVALIDA", message: `ordem inválida no passo ${s.key}`, stepKey: s.key })
    }
    if (!Number.isInteger(s.versao) || s.versao < 1) {
      warnings.push({ code: "STEP_VERSAO_AUSENTE", message: `stepDefinitionVersion ausente/inválida em ${s.key}`, stepKey: s.key })
    }

    // tipo resolvível
    const t = mapearTipoPasso(s)
    if (t.error) errors.push({ ...t.error, stepKey: s.key })
    warnings.push(...t.warnings.map((w) => ({ ...w, stepKey: s.key })))
  }

  // dependências
  const depInvalid = dependenciasInvalidas(steps)
  errors.push(...depInvalid)
  const ciclo = detectarCicloDependencia(steps)
  if (ciclo) {
    errors.push({ code: "CICLO_DE_DEPENDENCIA", message: `Ciclo de dependência: ${ciclo.join(" -> ")}` })
  }

  // ordem duplicada => warning (não bloqueia; desempate por stepKey)
  warnings.push(...detectarOrdemDuplicada(steps.map((s) => ({ ordem: s.ordem, key: s.key }))))

  return { valid: errors.length === 0, errors, warnings }
}

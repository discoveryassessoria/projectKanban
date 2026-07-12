// src/services/workflow-activation-helpers.ts
// CP-4G — helpers PUROS da ativação controlada do runtime v2 por Processo.
// A ativação é ADMINISTRATIVA e SEGURA: só é elegível quando TODOS os critérios
// passam. Sem rollout automático. Kill switch global OFF ⇒ nunca efetiva.

export type CriterioChave =
  | "killSwitchGlobal"
  | "unresolvedZero"
  | "workflowInternoValido"
  | "faseMacroResolvida"
  | "snapshotPossivel"
  | "semConflitos"
  | "justificativa"

export interface Criterio {
  chave: CriterioChave
  ok: boolean
  detalhe: string
}

export interface AvaliacaoAtivacao {
  criterios: Criterio[]
  elegivel: boolean
  bloqueios: CriterioChave[]
  // Só é elegível para ativação EFETIVA se, além de elegível, o kill switch estiver ON.
  podeAtivarEfetivo: boolean
}

export interface EntradaCriterios {
  killSwitchGlobal: boolean
  unresolvedCount: number
  workflowInternoValido: boolean
  faseMacroResolvida: boolean
  snapshotPossivel: boolean
  conflitos: number
  justificativaPresente: boolean
}

/** Avalia todos os critérios de forma determinística e ordenada. */
export function avaliarCriterios(e: EntradaCriterios): AvaliacaoAtivacao {
  const criterios: Criterio[] = [
    { chave: "killSwitchGlobal", ok: e.killSwitchGlobal, detalhe: e.killSwitchGlobal ? "Kill switch global habilitado" : "Kill switch global DESLIGADO — ativação efetiva bloqueada" },
    { chave: "unresolvedZero", ok: e.unresolvedCount === 0, detalhe: `unresolvedCount=${e.unresolvedCount}` },
    { chave: "workflowInternoValido", ok: e.workflowInternoValido, detalhe: e.workflowInternoValido ? "Workflow Interno válido" : "Workflow Interno inválido/ausente" },
    { chave: "faseMacroResolvida", ok: e.faseMacroResolvida, detalhe: e.faseMacroResolvida ? "Fase Macro resolvida" : "Fase Macro não resolvida por chave estável" },
    { chave: "snapshotPossivel", ok: e.snapshotPossivel, detalhe: e.snapshotPossivel ? "Snapshot possível" : "Snapshot não construível" },
    { chave: "semConflitos", ok: e.conflitos === 0, detalhe: `conflitos=${e.conflitos}` },
    { chave: "justificativa", ok: e.justificativaPresente, detalhe: e.justificativaPresente ? "Justificativa presente" : "Justificativa obrigatória ausente" },
  ]
  // "Elegível" = todos os pré-requisitos de configuração/compatibilidade (exceto o
  // kill switch, que governa apenas a ATIVAÇÃO EFETIVA, permitindo preparação/simulação).
  const bloqueiosPreparo = criterios.filter((c) => c.chave !== "killSwitchGlobal" && !c.ok).map((c) => c.chave)
  const elegivel = bloqueiosPreparo.length === 0
  const bloqueios = criterios.filter((c) => !c.ok).map((c) => c.chave)
  return { criterios, elegivel, bloqueios, podeAtivarEfetivo: elegivel && e.killSwitchGlobal }
}

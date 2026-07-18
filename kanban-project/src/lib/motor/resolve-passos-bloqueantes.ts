// src/lib/motor/resolve-passos-bloqueantes.ts
//
// RESOLVER CANÔNICO do conjunto de passos que PODEM bloquear o avanço de uma fase,
// orientado pelo ESCOPO OPERACIONAL (PROCESSO / NECESSIDADE / DOCUMENTO) — sem lista
// hardcoded de fases nem de stepKeys. A classificação é derivada dos próprios dados:
//
//   • Se a instância da fase tem ALGUM passo vinculado a uma entidade (documentoId ou
//     necessidadeId), a fase é operada por ENTIDADE. Nesse caso, os passos GENÉRICOS
//     (documentoId=null E necessidadeId=null) são apenas cópia do template do Workflow
//     Interno — NÃO representam operação real e NÃO bloqueiam. Só os passos por-entidade
//     bloqueiam.
//   • Se NENHUM passo tem entidade (todos genéricos), a fase é operada no escopo
//     PROCESSO: os passos genéricos SÃO a esteira operacional legítima e bloqueiam
//     normalmente.
//
// Assim, o mesmo mecanismo cobre Genealogia (necessidade), Emissão (documento) e as fases
// de processo (Análise/Retificação/Tradução/Apostilamento/Protocolo), atuais e futuras,
// e é compatível com instâncias LEGADAS (que têm as duas esteiras).

export type EscopoOperacao = "PROCESSO" | "NECESSIDADE" | "DOCUMENTO"

export interface PassoEscopo {
  documentoId: number | null
  necessidadeId: number | null
}

/** Escopo operacional de UM passo, pelos vínculos persistidos. */
export function escopoDoPasso(p: PassoEscopo): EscopoOperacao {
  if (p.documentoId != null) return "DOCUMENTO"
  if (p.necessidadeId != null) return "NECESSIDADE"
  return "PROCESSO"
}

/** A fase é operada por entidade (documento/necessidade)? (há ≥1 passo vinculado). */
export function faseOperadaPorEntidade(passos: PassoEscopo[]): boolean {
  return passos.some((p) => p.documentoId != null || p.necessidadeId != null)
}

/**
 * Subconjunto de passos que efetivamente participam do GATE da fase.
 * - Fase por-entidade: só os passos com entidade (genéricos = template, ignorados).
 * - Fase por-processo: todos os passos (genéricos são a esteira legítima).
 */
export function resolvePassosBloqueantesDaFase<T extends PassoEscopo>(passos: T[]): T[] {
  if (!faseOperadaPorEntidade(passos)) return passos
  return passos.filter((p) => p.documentoId != null || p.necessidadeId != null)
}

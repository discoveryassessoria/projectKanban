// src/lib/motor/motivos-movimentacao.ts
//
// CATÁLOGO OFICIAL dos motivos de movimentação manual de fase.
//
// Fica no SERVIDOR e é servido por API. O frontend NUNCA cadastra, inventa ou
// completa esta lista: um motivo digitado à mão vira, no dia seguinte, uma auditoria
// que ninguém consegue agrupar nem consultar. O código é a identidade; o rótulo é só
// o que o operador lê.
//
// Acrescentar um motivo é acrescentar uma entrada AQUI. Nunca remova um código já
// usado — registros antigos apontam para ele.

export interface MotivoMovimentacao {
  codigo: string
  label: string
  descricao: string
}

export const MOTIVOS_MOVIMENTACAO: readonly MotivoMovimentacao[] = [
  {
    codigo: "PROCESSO_JA_EM_ANDAMENTO",
    label: "Processo já estava em andamento",
    descricao: "O processo chegou ao Discovery numa fase adiantada e precisa ser posicionado onde de fato está.",
  },
  {
    codigo: "CORRECAO_DE_FASE",
    label: "Correção de fase",
    descricao: "O processo está na fase errada por engano operacional e precisa ser reposicionado.",
  },
  {
    codigo: "OPERACAO_ADMINISTRATIVA",
    label: "Operação administrativa",
    descricao: "Decisão administrativa que reposiciona o processo fora do fluxo automático.",
  },
  {
    codigo: "RETORNO_PARA_REGULARIZACAO",
    label: "Retorno para regularização",
    descricao: "Voltar a uma fase anterior para regularizar trabalho que ficou incompleto.",
  },
  {
    codigo: "OUTRO_AUTORIZADO",
    label: "Outro (autorizado)",
    descricao: "Situação não coberta pelos demais motivos. A justificativa passa a ser a explicação inteira.",
  },
] as const

const CODIGOS = new Set(MOTIVOS_MOVIMENTACAO.map((m) => m.codigo))

/** O código veio do catálogo oficial? Texto livre estrutural não é aceito. */
export function motivoValido(codigo: string): boolean {
  return CODIGOS.has(codigo)
}

// LIMITES DA JUSTIFICATIVA — a justificativa é o que explica a decisão para quem ler
// a auditoria daqui a um ano. Curta demais não explica nada; longa demais não é
// justificativa, é anexo.
export const JUSTIFICATIVA_MIN = 10
export const JUSTIFICATIVA_MAX = 500

/** Normaliza a justificativa: colapsa espaços e apara as pontas. */
export function normalizarJustificativa(texto: string): string {
  return texto.replace(/\s+/g, " ").trim()
}

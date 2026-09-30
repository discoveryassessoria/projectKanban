// src/lib/documentos/status-inativos.ts
// ============================================================================
// QUANDO UM DOCUMENTO DEIXA DE SER TRABALHO A FAZER — UMA definição só.
//
// Documento.status tem dois estados "fora do jogo" que NÃO se misturam:
//
//   CANCELADO    decisão HUMANA sobre o papel/a operação (operador cancelou).
//   NAO_EXIGIDO  a ÁRVORE deixou de exigir o documento (pessoa deixou de ser
//                casada, faleceu, saiu da linha reta, regra inativada…). Ninguém
//                invalidou o papel — a obrigação é que deixou de existir. Anexos,
//                solicitações e histórico permanecem; se a árvore voltar a exigir,
//                o MESMO Documento é reativado (nunca duplicado).
//
// Para QUALQUER leitura que pergunte "este documento ainda conta como
// requerido/pendente/pronto, vira passo ou tarefa?", os dois são iguais: NÃO.
// Espalhar `status: { not: 'CANCELADO' }` deixaria o NAO_EXIGIDO contando como
// pendência — exatamente o bug que este módulo existe para impedir. Toda leitura
// de "documento ativo" usa esta constante.
// ============================================================================

export const STATUS_DOCUMENTO_INATIVOS = ["CANCELADO", "NAO_EXIGIDO"] as const
export type StatusDocumentoInativo = (typeof STATUS_DOCUMENTO_INATIVOS)[number]

/** true = o documento ainda é obrigação/trabalho; false = CANCELADO ou NAO_EXIGIDO. */
export function documentoAtivo(status: string | null | undefined): boolean {
  return !(STATUS_DOCUMENTO_INATIVOS as readonly string[]).includes(String(status ?? ""))
}

/** Para `where: { status: { notIn: ... } }` do Prisma (array mutável, tipo do enum). */
export const DOCUMENTO_STATUS_NOT_IN_INATIVOS: ("CANCELADO" | "NAO_EXIGIDO")[] = [...STATUS_DOCUMENTO_INATIVOS]

/** Rótulo humano — nunca o código técnico na tela. */
export const ROTULO_NAO_EXIGIDO = "Não exigido"

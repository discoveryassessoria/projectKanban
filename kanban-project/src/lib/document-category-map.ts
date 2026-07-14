// LOTE A — PONTE LEGADA ÚNICA entre a classificação canônica e a coluna legada.
// ============================================================================
// FONTE CANÔNICA de classificação documental = CategoriaDocumental (consumida por
// ID / code estável). A coluna TipoDocumentoCadastro.category (string livre) é
// APENAS compatibilidade transitória.
//
// Este módulo é a ÚNICA ponte permitida entre `category` (legado) e o `code` do
// mestre. É usado por: dual-write (API), resolver oficial, backfill (core),
// proteção de exclusão e testes. NÃO duplicar este mapa em nenhum outro arquivo.
//
// Puro (sem Prisma / sem I/O) → importável por testes via tsx sem abrir conexão.
//
// Condições de descontinuação (ver runbook):
//   - remover DUAL-READ  : quando 100% dos TipoDocumento tiverem categoriaDocumentalId.
//   - remover DUAL-WRITE : quando nenhum consumidor legado ler mais `category`.
//   - remover COLUNA     : após dual-read e dual-write removidos (migração destrutiva à parte).
// ============================================================================

/** code (CategoriaDocumental) -> valor histórico da coluna legada `category`. */
export const CODE_TO_LEGACY: Record<string, string> = {
  REGISTRO_CIVIL: 'civil_registry',
  IDENTIDADE: 'identity',
  JUDICIAL: 'judicial',
  CONSULAR: 'consular',
  TRADUCAO: 'translation',
  APOSTILA: 'apostille',
  OUTRO: 'other',
}

/** valor legado `category` -> code (CategoriaDocumental). Inverso de CODE_TO_LEGACY. */
export const LEGACY_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(CODE_TO_LEGACY).map(([code, legacy]) => [legacy, code]),
)

/** Codes das categorias de BOOTSTRAP (sistema). Semeadas pela migration; imutáveis. */
export const SYSTEM_CATEGORY_CODES: readonly string[] = Object.keys(CODE_TO_LEGACY)

/**
 * Deriva o valor legado `category` a partir do code da categoria mestre (DUAL-WRITE).
 * Retorna null quando não há correspondência legada conhecida (categoria nova, ex.:
 * MILITAR): nesse caso NÃO se escreve lixo na coluna legada — a FK é a fonte.
 */
export function legacyFromCode(code: string | null | undefined): string | null {
  if (!code) return null
  return CODE_TO_LEGACY[code] ?? null
}

/**
 * Deriva o code canônico a partir do valor legado `category` (BACKFILL / DUAL-READ
 * de linhas ainda não migradas). Retorna null para valores desconhecidos (reporta,
 * nunca inventa categoria).
 */
export function codeFromLegacy(legacy: string | null | undefined): string | null {
  if (!legacy) return null
  return LEGACY_TO_CODE[legacy] ?? null
}

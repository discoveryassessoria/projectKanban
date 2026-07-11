// src/services/catalogo-helpers.ts
// CP-2 — helpers PUROS do Catálogo Mestre (sem prisma/sem alias @/),
// para poderem ser importados por scripts (tsx) e testes.

/** Código canônico do ItemCatalogo mestre derivado de um valor do enum TipoDocumento. */
export function codeDocumentoMestre(enumKey: string): string {
  return `DOC_${enumKey}`.toUpperCase()
}

/** Nome legível a partir do valor do enum (ex.: CERTIDAO_NASCIMENTO -> "Certidao Nascimento"). */
export function nomeDocumentoMestre(enumKey: string): string {
  return enumKey
    .split("_")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ")
    .trim()
}

/** Preferir o vínculo canônico do TipoServico; fallback null (legado sem vínculo). */
export function resolverItemCatalogoDeTipoServico(ts: { itemCatalogoId?: number | null }): number | null {
  return ts.itemCatalogoId ?? null
}

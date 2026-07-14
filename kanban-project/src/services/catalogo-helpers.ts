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

// LOTE B — ItemCatalogo é a FONTE CANÔNICA de Serviços & Produtos. As ilhas legadas
// (ServicoProduto, ProdutoFinanceiro) projetam-se no mestre por um `code` estável e
// determinístico, permitindo dual-write/backfill idempotentes. Puro/testável.

/** code canônico do ItemCatalogo (natureza SERVICO) derivado de ServicoProduto.code. */
export function codeServicoMestre(code: string): string {
  return `SRV_${String(code).trim()}`.toUpperCase()
}

/** code canônico do ItemCatalogo (natureza PRODUTO) derivado de ProdutoFinanceiro.codigo. */
export function codeProdutoMestre(codigo: string): string {
  return `PRD_${String(codigo).trim()}`.toUpperCase()
}

/** Preferir o vínculo canônico do ServicoProduto; fallback null (legado sem vínculo). */
export function resolverItemCatalogoDeServico(s: { itemCatalogoId?: number | null }): number | null {
  return s.itemCatalogoId ?? null
}

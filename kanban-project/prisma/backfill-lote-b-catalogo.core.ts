// LOTE B — NÚCLEO PURO do backfill Serviços/Produtos → ItemCatalogo (mestre).
// Sem Prisma / sem conexão / sem main(). Importável em testes via tsx.
// Deriva o `code` canônico do mestre; idempotente (pula quem já tem vínculo).

import { codeServicoMestre, codeProdutoMestre } from '../src/services/catalogo-helpers'

export interface ServicoRow { id: number; code: string; name: string; category?: string | null; itemCatalogoId: number | null }
export interface ProdutoRow { id: number; codigo: string; nome: string; itemCatalogoId: number | null }

export interface UpsertServico { id: number; code: string; name: string; categoria: string | null }
export interface UpsertProduto { id: number; code: string; name: string }

/** Serviços SEM vínculo → upsert ItemCatalogo (natureza SERVICO) + link. */
export function planejarServicos(servicos: ServicoRow[]): UpsertServico[] {
  return servicos
    .filter((s) => s.itemCatalogoId == null)
    .map((s) => ({ id: s.id, code: codeServicoMestre(s.code), name: s.name, categoria: s.category ?? null }))
}

/** Produtos SEM vínculo → upsert ItemCatalogo (natureza PRODUTO) + link. */
export function planejarProdutos(produtos: ProdutoRow[]): UpsertProduto[] {
  return produtos
    .filter((p) => p.itemCatalogoId == null)
    .map((p) => ({ id: p.id, code: codeProdutoMestre(p.codigo), name: p.nome }))
}

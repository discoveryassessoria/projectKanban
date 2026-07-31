// src/services/catalogo-sync.ts
// PROJEÇÃO no ItemCatalogo — o mestre é a fonte canônica de identidade do item.
// Mantém o mestre em sincronia quando o registro operacional (ServicoProduto,
// ProdutoFinanceiro) é criado ou editado. Idempotente por `code` (upsert), roda
// DENTRO da transação da escrita (recebe o tx client) e não remove nada.
//
// A CATEGORIA é referência estrutural: viaja por `categoriaId` (FK para
// CategoriaServico) e vive EXCLUSIVAMENTE no mestre. Nenhum ponto do sistema
// transporta categoria como texto.

import { Prisma, NaturezaItem } from '@prisma/client'
import { codeServicoMestre, codeProdutoMestre } from './catalogo-helpers'

/**
 * Garante o ItemCatalogo (natureza SERVICO) espelho de um ServicoProduto e retorna
 * seu id, para gravar em ServicoProduto.itemCatalogoId (o vínculo canônico).
 *
 * `existingItemId`: quando o ServicoProduto JÁ possui um item vinculado (edição),
 * renomeia ESSE item no lugar (code/name/categoriaId) em vez de criar um novo por
 * `code` mudado. Assim o vínculo dos consumidores (ex.: Configuração Financeira que
 * aponta itemCatalogoId) sobrevive à edição do CÓDIGO do mestre — a leitura do
 * Financeiro resolve o código real automaticamente, sem editar nada no Financeiro.
 */
export async function sincronizarItemDeServico(
  tx: Prisma.TransactionClient,
  s: { code: string; name: string; categoriaId?: number | null },
  existingItemId?: number | null,
): Promise<number> {
  const code = codeServicoMestre(s.code)
  if (existingItemId != null) {
    await tx.itemCatalogo.update({
      where: { id: existingItemId },
      data: { code, name: s.name, categoriaId: s.categoriaId ?? null },
    })
    return existingItemId
  }
  const item = await tx.itemCatalogo.upsert({
    where: { code },
    create: { code, name: s.name, natureza: NaturezaItem.SERVICO, categoriaId: s.categoriaId ?? null },
    update: { name: s.name, categoriaId: s.categoriaId ?? null },
    select: { id: true },
  })
  return item.id
}

/**
 * Garante o ItemCatalogo espelho de um ProdutoFinanceiro (Configuração Financeira
 * cujo mestre não é, ele próprio, um item) e retorna seu id.
 *
 * A natureza é OUTRO — genérica e OFICIAL. Antes o espelho nascia como PRODUTO,
 * nomenclatura ELIMINADA da arquitetura (a empresa cadastra Serviços): isso fazia
 * itens fantasma de cadastros legados aparecerem no seletor de lançamento. Itens
 * já gravados como PRODUTO/HONORARIO são preservados para leitura histórica e
 * ficam fora da elegibilidade por `lib/financeiro/catalogo-oficial`.
 */
export async function sincronizarItemDeProduto(
  tx: Prisma.TransactionClient,
  p: { codigo: string; nome: string; categoriaId?: number | null },
): Promise<number> {
  const code = codeProdutoMestre(p.codigo)
  const item = await tx.itemCatalogo.upsert({
    where: { code },
    create: { code, name: p.nome, natureza: NaturezaItem.OUTRO, categoriaId: p.categoriaId ?? null },
    update: { name: p.nome, categoriaId: p.categoriaId ?? null },
    select: { id: true },
  })
  return item.id
}

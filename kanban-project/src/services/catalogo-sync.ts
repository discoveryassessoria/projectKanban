// src/services/catalogo-sync.ts
// LOTE B — DUAL-WRITE: mantém o ItemCatalogo (fonte canônica) em sincronia quando
// as ilhas legadas (ServicoProduto, ProdutoFinanceiro) são criadas/editadas.
// Idempotente por `code` canônico (upsert). NÃO remove nada. Deve rodar DENTRO da
// mesma transação da escrita da ilha (recebe o tx client).

import { Prisma, NaturezaItem } from '@prisma/client'
import { codeServicoMestre, codeProdutoMestre } from './catalogo-helpers'

/**
 * Garante o ItemCatalogo (natureza SERVICO) espelho de um ServicoProduto e retorna
 * seu id, para gravar em ServicoProduto.itemCatalogoId (o vínculo canônico).
 */
export async function sincronizarItemDeServico(
  tx: Prisma.TransactionClient,
  s: { code: string; name: string; category?: string | null },
): Promise<number> {
  const code = codeServicoMestre(s.code)
  const item = await tx.itemCatalogo.upsert({
    where: { code },
    create: { code, name: s.name, natureza: NaturezaItem.SERVICO, categoria: s.category ?? null },
    update: { name: s.name, categoria: s.category ?? null },
    select: { id: true },
  })
  return item.id
}

/**
 * Garante o ItemCatalogo (natureza PRODUTO) espelho de um ProdutoFinanceiro e retorna
 * seu id, para gravar em ProdutoFinanceiro.itemCatalogoId.
 */
export async function sincronizarItemDeProduto(
  tx: Prisma.TransactionClient,
  p: { codigo: string; nome: string; categoria?: string | null },
): Promise<number> {
  const code = codeProdutoMestre(p.codigo)
  const item = await tx.itemCatalogo.upsert({
    where: { code },
    create: { code, name: p.nome, natureza: NaturezaItem.PRODUTO, categoria: p.categoria ?? null },
    update: { name: p.nome, categoria: p.categoria ?? null },
    select: { id: true },
  })
  return item.id
}

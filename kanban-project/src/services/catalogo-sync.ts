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
import { slugTecnico, gerarChaveUnica } from '@/src/lib/catalogo/chave-tecnica-interna'

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

/** Chave técnica do ServicoProduto derivada do code do mestre ("SRV_X" → "X"). */
export function codeServicoDeMestre(codeItem: string): string {
  const c = String(codeItem).trim().toUpperCase()
  return c.startsWith('SRV_') ? c.slice(4) : c
}

export interface ServicoGarantido {
  servicoId: number
  publicCode: string | null
  criado: boolean
}

/**
 * DIREÇÃO INVERSA de `sincronizarItemDeServico`: garante o ServicoProduto de um
 * ItemCatalogo de natureza SERVICO.
 *
 * POR QUE EXISTE
 * --------------
 * O código canônico do serviço (SRV-n) é `ServicoProduto.publicCode` — gerado
 * pelo CodeGeneratorService via extensão do Prisma Client. Um serviço que existe
 * SÓ como item do mestre não tem onde carregar esse código: ele aparece no
 * Catálogo com "—" não porque a geração falhou, mas porque nasceu do lado que não
 * é portador do código. Foi exatamente assim que seis serviços do pré-cadastro
 * estrutural ficaram sem SRV-n.
 *
 * A correção é promover o item ao cadastro canônico, não dar um segundo portador
 * de código ao mestre — dois portadores seriam duas fontes da verdade para o
 * mesmo identificador.
 *
 * IDEMPOTENTE: item que já tem serviço devolve o existente, sem tocar em nada e
 * sem consumir número da sequência. A chave técnica é derivada do code do mestre
 * (mesma convenção do caminho de criação, invertida) e desambiguada se colidir.
 * O item permanece intacto — nada é apagado, renomeado ou renumerado.
 */
export async function garantirServicoDoItem(
  tx: Prisma.TransactionClient,
  itemId: number,
): Promise<ServicoGarantido> {
  const item = await tx.itemCatalogo.findUnique({
    where: { id: itemId },
    select: { id: true, code: true, name: true, descricao: true, natureza: true, unidade: true, ativo: true },
  })
  if (!item) throw new Error(`ItemCatalogo ${itemId} não encontrado`)
  if (item.natureza !== NaturezaItem.SERVICO) {
    throw new Error(`ItemCatalogo ${itemId} ("${item.name}") tem natureza ${item.natureza} — só natureza SERVICO vira ServicoProduto`)
  }

  const existente = await tx.servicoProduto.findFirst({
    where: { itemCatalogoId: itemId },
    select: { id: true, publicCode: true },
    orderBy: { id: 'asc' },
  })
  if (existente) return { servicoId: existente.id, publicCode: existente.publicCode, criado: false }

  const base = slugTecnico(codeServicoDeMestre(item.code), 'SERVICO')
  const code = await gerarChaveUnica(base, async (c) =>
    !!(await tx.servicoProduto.findUnique({ where: { code: c }, select: { id: true } })),
  )
  const s = await tx.servicoProduto.create({
    data: {
      code,
      name: item.name,
      descricao: item.descricao,
      unidadePadrao: item.unidade,
      ativo: item.ativo,
      itemCatalogoId: itemId,
    },
    select: { id: true, publicCode: true },
  })
  // O código é OBRIGATÓRIO. Se a extensão não gravou, o serviço nasceria com o
  // mesmo defeito que este caminho existe para corrigir — a transação cai.
  if (!s.publicCode) {
    throw new Error(`ServicoProduto ${s.id} criado sem publicCode — geração de código falhou, transação abortada`)
  }
  return { servicoId: s.id, publicCode: s.publicCode, criado: true }
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

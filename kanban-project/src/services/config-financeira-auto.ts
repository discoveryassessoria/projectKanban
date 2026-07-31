// src/services/config-financeira-auto.ts
// DOMÍNIO: cada item do Cadastro Mestre (Documento/Serviço) deve ter EXATAMENTE uma
// Configuração Financeira (ProdutoFinanceiro). O vínculo é ESTRUTURAL — a FK
// itemCatalogoId (pivô do mestre), nunca por nome/código/parsing de texto. A unicidade
// é garantida pelo @@unique([itemCatalogoId]) do schema. Idempotente: se já existe
// config para o item, NÃO cria outra (não duplica, não altera preços/config existente).

import { Prisma, NaturezaFinanceira } from '@prisma/client'

/**
 * Garante a Configuração Financeira de QUALQUER item do Cadastro Mestre —
 * serviço, documento, taxa, protocolo. O vínculo é estrutural (itemCatalogoId) e
 * a natureza do item não muda nada aqui: config é config.
 *
 * É o que permite precificar um Documento Mestre sem convertê-lo em Serviço: o
 * preço pertence à config, a config pertence ao item, e o item continua sendo o
 * que sempre foi.
 * Natureza padrão CUSTO_E_RECEITA — mesmo padrão das configs de Documento já existentes
 * (um serviço pode gerar custo operacional e valor de venda). Idempotente por item.
 * Retorna { id, criado } — criado=false quando a config já existia.
 */
export async function garantirConfigFinanceiraDeItem(
  tx: Prisma.TransactionClient,
  s: { itemCatalogoId: number; nome: string },
): Promise<{ id: number; criado: boolean }> {
  const existente = await tx.produtoFinanceiro.findUnique({
    where: { itemCatalogoId: s.itemCatalogoId },
    select: { id: true },
  })
  if (existente) return { id: existente.id, criado: false }

  // ID técnico interno (referencia o mestre por ID; a exibição resolve nome/código reais).
  const codigo = `CFG_ITEM_${s.itemCatalogoId}`.slice(0, 30)
  const cfg = await tx.produtoFinanceiro.create({
    data: {
      codigo,
      nome: s.nome,
      itemCatalogoId: s.itemCatalogoId,
      naturezaFin: NaturezaFinanceira.CUSTO_E_RECEITA,
      possuiCusto: true,
      possuiReceita: true,
      moedaPadrao: 'BRL',
      naturezaFinanceira: 'revenue',
      ativo: true,
    },
    select: { id: true },
  })
  return { id: cfg.id, criado: true }
}

/**
 * Reflete o estado ativo/inativo e o nome atual do mestre na config vinculada, SEM
 * apagar a config nem tocar em preços/histórico. Usado ao editar/desativar o Serviço.
 * No-op se ainda não houver config para o item.
 */
export async function refletirEstadoNaConfigDeServico(
  tx: Prisma.TransactionClient,
  s: { itemCatalogoId: number; nome: string; ativo: boolean },
): Promise<void> {
  await tx.produtoFinanceiro.updateMany({
    where: { itemCatalogoId: s.itemCatalogoId },
    data: { ativo: s.ativo, nome: s.nome },
  })
}

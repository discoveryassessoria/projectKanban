// prisma/_financeiro-coleta.ts
// ============================================================================
// Coleta SOMENTE LEITURA dos dados financeiros (findMany) e normalização
// Decimal→number. Escrita ZERO. Fonte única usada pelo inventário e pela
// validação (gate). Separado das checagens puras (_financeiro-checks.ts).
// ============================================================================

import type { PrismaClient } from '@prisma/client'
import type { DadosFinanceiros } from './_financeiro-checks'

const num = (v: unknown): number | null => (v == null ? null : Number(v))

/** Lê tudo que as checagens precisam. Apenas findMany — nunca escreve. */
export async function coletarDadosFinanceiros(prisma: PrismaClient): Promise<DadosFinanceiros> {
  const [produtos, itens, precos, honorarios, econRules, triggerRules, tiposDoc, servicos, tiposServico] =
    await Promise.all([
      prisma.produtoFinanceiro.findMany({ select: { id: true, codigo: true, nome: true, naturezaFinanceira: true, itemCatalogoId: true, valorPadrao: true, ativo: true } }),
      prisma.itemCatalogo.findMany({
        select: { id: true, code: true, name: true, natureza: true, ativo: true,
          _count: { select: { tiposDocumento: true, produtos: true, servicos: true, precos: true, tiposServico: true, necessidades: true } } },
      }),
      prisma.tabelaValor.findMany({ select: { id: true, name: true, valor: true, moeda: true, natureza: true, itemCatalogoId: true, arquivado: true } }),
      prisma.honorario.findMany({ select: { id: true, code: true, name: true, servico: true, valorPadrao: true, momentoCobranca: true, ativo: true } }),
      prisma.phaseEconomicRule.findMany({ select: { id: true, documentTypeCode: true, custoProdutoCode: true, receitaProdutoCode: true, componentName: true, componentKey: true } }),
      prisma.phaseTriggerRule.findMany({ select: { id: true, itemCode: true, financialItemId: true, name: true, active: true } }),
      prisma.tipoDocumentoCadastro.findMany({ select: { id: true, code: true, name: true, legacyEnumKey: true, itemCatalogoId: true } }),
      prisma.servicoProduto.findMany({ select: { id: true, code: true, name: true, itemCatalogoId: true } }),
      prisma.tipoServico.findMany({ select: { id: true, nome: true, itemCatalogoId: true } }),
    ])

  return {
    produtos: produtos.map((p) => ({ ...p, valorPadrao: num(p.valorPadrao) })),
    itens,
    precos: precos.map((v) => ({ ...v, valor: Number(v.valor) })),
    honorarios: honorarios.map((h) => ({ ...h, valorPadrao: num(h.valorPadrao) })),
    econRules,
    triggerRules,
    tiposDoc,
    servicos,
    tiposServico,
  }
}

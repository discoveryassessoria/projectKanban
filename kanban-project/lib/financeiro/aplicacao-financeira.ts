// lib/financeiro/aplicacao-financeira.ts
// FONTE ÚNICA da "Aplicação financeira" de uma automação → quais preços aplicar.
// A automação NÃO decide natureza por texto/tipo legado: ela declara a DIREÇÃO
// (RECEITA/CUSTO/AMBOS) e esta função converte para as naturezas de preço reais.
// NÃO duplicar esta lógica em rota/componente/executor.

import { NaturezaPreco } from '@prisma/client'

export type AplicacaoFinanceira = 'RECEITA' | 'CUSTO' | 'AMBOS'
export const APLICACOES: AplicacaoFinanceira[] = ['RECEITA', 'CUSTO', 'AMBOS']

export function aplicacaoValida(v: unknown): v is AplicacaoFinanceira {
  return v === 'RECEITA' || v === 'CUSTO' || v === 'AMBOS'
}

/** RECEITA → [VENDA]; CUSTO → [CUSTO]; AMBOS → [VENDA, CUSTO]. */
export function naturezasDaAplicacao(ap: AplicacaoFinanceira): NaturezaPreco[] {
  if (ap === 'RECEITA') return [NaturezaPreco.VENDA]
  if (ap === 'CUSTO') return [NaturezaPreco.CUSTO]
  return [NaturezaPreco.VENDA, NaturezaPreco.CUSTO]
}

/** AMBOS só é permitido quando a Configuração Financeira habilita custo E receita. */
export function aplicacaoPermitida(ap: AplicacaoFinanceira, cfg: { possuiCusto: boolean; possuiReceita: boolean }): boolean {
  if (ap === 'RECEITA') return cfg.possuiReceita
  if (ap === 'CUSTO') return cfg.possuiCusto
  return cfg.possuiCusto && cfg.possuiReceita
}

export function rotuloAplicacao(ap: string | null | undefined): string {
  return ap === 'RECEITA' ? 'Receita' : ap === 'CUSTO' ? 'Custo' : ap === 'AMBOS' ? 'Custo e receita' : '—'
}

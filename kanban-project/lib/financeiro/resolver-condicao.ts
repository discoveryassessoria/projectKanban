// lib/financeiro/resolver-condicao.ts
// ============================================================================
// Ponte entre a Configuração Financeira e o motor de cronograma.
//
// Fluxo oficial:
//   Tabela de Preços (valor) → Configuração Financeira → Condição de Pagamento
//   → FinanceRuleEngine → Lançamento → Parcelas → Recebimentos
//
// O motor NÃO conhece mais detalhes de parcelamento: ele pede o cronograma
// pronto. Enquanto uma configuração ainda não tiver condição vinculada, o
// resolvedor devolve null e o cronograma cai no comportamento histórico
// (1 parcela na data base) — adoção incremental, sem regressão.
// ============================================================================

import { prisma } from '@/lib/prisma'
import {
  condicaoAplicavel,
  type CondicaoPagamentoView,
  type ContextoAplicabilidade,
  type Periodicidade,
} from './condicao-pagamento'
import type { TaxaView } from './taxas-pagamento'

/** Converte o registro Prisma (Decimal/Date) para a view pura do motor. */
export function paraView(c: Record<string, unknown> | null): CondicaoPagamentoView | null {
  if (!c) return null
  const n = (v: unknown) => (v == null ? null : Number(v))
  return {
    id: c.id as number,
    codigo: (c.codigo as string) ?? null,
    nome: (c.name as string) ?? null,
    versao: (c.versao as number) ?? 1,
    ativo: (c.ativo as boolean) ?? true,
    vigenciaInicio: (c.vigenciaInicio as Date) ?? null,
    vigenciaFim: (c.vigenciaFim as Date) ?? null,

    tipoPagamento: (c.tipoPagamento as 'AVISTA' | 'PARCELADO') ?? 'PARCELADO',

    temEntrada: (c.temEntrada as boolean) ?? false,
    entradaObrigatoria: (c.entradaObrigatoria as boolean) ?? false,
    percentEntrada: n(c.percentEntrada),
    valorEntradaFixo: n(c.valorEntradaFixo),

    parcelasMin: (c.parcelasMin as number) ?? null,
    parcelasMax: (c.parcelasMax as number) ?? null,
    // `parcelas` é o campo histórico do cadastro: continua servindo de padrão.
    parcelasPadrao: (c.parcelasPadrao as number) ?? (c.parcelas as number) ?? null,

    inicioCronograma: (c.inicioCronograma as 'IMEDIATA' | 'DIAS' | 'DATA_ESPECIFICA') ?? 'IMEDIATA',
    primeiraParcelaDias: (c.primeiraParcelaDias as number) ?? null,
    primeiraParcelaData: (c.primeiraParcelaData as Date) ?? null,
    periodicidade: ((c.periodicidade as string) ?? 'MENSAL') as Periodicidade,
    periodicidadeDias: (c.periodicidadeDias as number) ?? null,
    // `diaVencimento` é o campo histórico equivalente ao dia fixo.
    diaFixo: (c.diaFixo as number) ?? (c.diaVencimento as number) ?? null,
    ajusteDiaUtil: (c.ajusteDiaUtil as 'NENHUM' | 'ULTIMO_DIA_UTIL' | 'PROXIMO_DIA_UTIL') ?? 'NENHUM',
    ajustarFimDeSemana: (c.ajustarFimDeSemana as boolean) ?? false,
    ajustarFeriados: (c.ajustarFeriados as boolean) ?? false,

    distribuicao: (c.distribuicao as CondicaoPagamentoView['distribuicao']) ?? 'ULTIMA_AJUSTA',
    primeiraParcelaPercent: n(c.primeiraParcelaPercent),

    multaPercent: n(c.multaPercent),
    jurosMesPercent: n(c.jurosMesPercent),
    descontoPercent: n(c.descontoPercent),
    descontoAntecipacaoPercent: n(c.descontoAntecipacaoPercent),
    descontoAVistaPercent: n(c.descontoAVistaPercent),

    politicaCambio: (c.politicaCambio as CondicaoPagamentoView['politicaCambio']) ?? 'VARIAVEL',
    travaCambial: (c.travaCambial as boolean) ?? false,

    aplicaA: (c.aplicaA as 'RECEITA' | 'CUSTO' | 'AMBOS') ?? 'AMBOS',
    moedasPermitidas: (c.moedasPermitidas as string[]) ?? [],
    valorMinimo: n(c.valorMinimo),
    valorMaximo: n(c.valorMaximo),
    paises: (c.paises as string[]) ?? [],
    modalidades: (c.modalidades as string[]) ?? [],
    tiposProcesso: (c.tiposProcesso as string[]) ?? [],
  }
}

export interface ResultadoCondicao {
  condicao: CondicaoPagamentoView | null
  /** Taxas vinculadas à condição (CondicaoPagamentoTaxa). Vazio quando não há. */
  taxas: TaxaView[]
  /** Por que a condição vinculada não foi usada (quando houver uma). */
  motivoDescarte: string | null
}

/** Converte TaxaPagamento (Prisma) para a view do motor de taxas. */
export function taxaParaView(t: Record<string, unknown>): TaxaView {
  const n = (v: unknown) => (v == null ? null : Number(v))
  const feeType = String(t.feeType ?? 'PERCENTUAL').toUpperCase()
  const tipo = (
    feeType.includes('FIX') && feeType.includes('PERCENT') ? 'PERCENTUAL_MAIS_FIXA'
      : feeType.includes('TARIFA') || feeType.includes('BANC') ? 'TARIFA_BANCARIA'
      : feeType.includes('ANTECIP') ? 'ANTECIPACAO'
      : feeType.includes('FIX') ? 'FIXA'
      : 'PERCENTUAL'
  ) as TaxaView['tipo']
  return {
    id: t.id as number,
    nome: (t.name as string) ?? null,
    codigo: (t.code as string) ?? null,
    tipo,
    percentual: n(t.feePercent),
    valorFixo: n(t.fixedFee),
    baseIncidencia: ((t.baseIncidencia as string) ?? 'TOTAL') as TaxaView['baseIncidencia'],
    quemAbsorve: ((t.quemAbsorve as string) ?? 'EMPRESA') as TaxaView['quemAbsorve'],
    adquirente: (t.adquirente as string) ?? null,
    parcelasDe: (t.installmentsFrom as number) ?? null,
    parcelasAte: (t.installmentsTo as number) ?? null,
    antecipacaoAtiva: (t.anticipationEnabled as boolean) ?? false,
    antecipacaoPercent: n(t.anticipationPercent),
    ativo: (t.ativo as boolean) ?? true,
    vigenciaInicio: (t.vigenciaInicio as Date) ?? null,
    vigenciaFim: (t.vigenciaFim as Date) ?? null,
  }
}

/**
 * Condição de pagamento da Configuração Financeira, já validada contra as
 * restrições do lançamento. Nunca lança: sem condição válida devolve null e o
 * motor segue com o comportamento histórico.
 */
export async function condicaoDaConfig(
  configId: number | null | undefined,
  ctx: ContextoAplicabilidade,
): Promise<ResultadoCondicao> {
  if (!configId) return { condicao: null, taxas: [], motivoDescarte: null }
  try {
    const config = await prisma.produtoFinanceiro.findUnique({
      where: { id: configId },
      select: { condicaoPagamento: { include: { taxasVinculadas: { include: { taxa: true } } } } },
    })
    const bruto = config?.condicaoPagamento as unknown as Record<string, unknown> | null
    const view = paraView(bruto)
    if (!view) return { condicao: null, taxas: [], motivoDescarte: null }

    const veredito = condicaoAplicavel(view, ctx)
    if (!veredito.aplicavel) return { condicao: null, taxas: [], motivoDescarte: veredito.motivo }

    const taxas = extrairTaxas(bruto)
    return { condicao: view, taxas, motivoDescarte: null }
  } catch (err) {
    console.error('[condicaoDaConfig] erro ao resolver condição de pagamento:', err)
    return { condicao: null, taxas: [], motivoDescarte: 'Falha ao resolver a condição de pagamento.' }
  }
}

/** Busca uma condição por id, validada contra o contexto (reparcelamento). */
export async function condicaoPorId(
  condicaoId: number,
  ctx: ContextoAplicabilidade,
): Promise<ResultadoCondicao> {
  try {
    const c = await prisma.condicaoPagamento.findUnique({
      where: { id: condicaoId },
      include: { taxasVinculadas: { include: { taxa: true } } },
    })
    const bruto = c as unknown as Record<string, unknown> | null
    const view = paraView(bruto)
    if (!view) return { condicao: null, taxas: [], motivoDescarte: 'Condição de pagamento não encontrada.' }
    const veredito = condicaoAplicavel(view, ctx)
    if (!veredito.aplicavel) return { condicao: null, taxas: [], motivoDescarte: veredito.motivo }
    return { condicao: view, taxas: extrairTaxas(bruto), motivoDescarte: null }
  } catch (err) {
    console.error('[condicaoPorId] erro:', err)
    return { condicao: null, taxas: [], motivoDescarte: 'Falha ao carregar a condição de pagamento.' }
  }
}

/** Extrai as taxas vinculadas de uma condição carregada com include. */
function extrairTaxas(bruto: Record<string, unknown> | null): TaxaView[] {
  if (!bruto) return []
  const vinculos = (bruto.taxasVinculadas as Array<{ taxa?: Record<string, unknown> }> | undefined) ?? []
  return vinculos.map((v) => v.taxa).filter(Boolean).map((t) => taxaParaView(t as Record<string, unknown>))
}

const ROTULO_PERIODICIDADE: Record<Periodicidade, string> = {
  SEMANAL: 'Semanal',
  QUINZENAL: 'Quinzenal',
  MENSAL: 'Mensal',
  BIMESTRAL: 'Bimestral',
  TRIMESTRAL: 'Trimestral',
  SEMESTRAL: 'Semestral',
  ANUAL: 'Anual',
  PERSONALIZADA: 'Personalizada',
}

/** Rótulo gravado em Receita.periodicidade (campo textual histórico). */
export function rotuloPeriodicidade(p: Periodicidade): string {
  return ROTULO_PERIODICIDADE[p] ?? 'Mensal'
}

/**
 * Cálculos do módulo Financeiro — v3.
 *
 * Funções puras. Recebem dados e retornam agregados. Não fazem IO.
 *
 * Path: @/src/lib/financeiro/calculos
 */

import type {
  FaturaEnriquecida,
  OutroCusto,
  PastaDocumentalItem,
  ResumoFinanceiro,
  FinanceiroContext,
} from '@/src/types/financeiro';
import { paraBRL } from './helpers';

// ============================================================================
// Faturas — totais em BRL
// ============================================================================

function valorFaturaBRL(f: FaturaEnriquecida): number {
  return paraBRL(Number(f.valor), f.moeda, f.cambio);
}

function valorPagamentoBRL(
  p: { valor: number | string; estornado: boolean; cambio?: number | null },
  moedaFatura: 'BRL' | 'EUR' | 'USD'
): number {
  if (p.estornado) return 0;
  return paraBRL(Number(p.valor), moedaFatura, p.cambio);
}

export function totalFaturado(faturas: FaturaEnriquecida[]): number {
  return faturas.reduce((acc, f) => acc + valorFaturaBRL(f), 0);
}

export function totalRecebido(faturas: FaturaEnriquecida[]): number {
  return faturas.reduce((acc, f) => {
    const pagos = (f.pagamentos ?? []).reduce(
      (s, p) => s + valorPagamentoBRL(p, f.moeda),
      0
    );
    return acc + pagos;
  }, 0);
}

export function totalAReceber(faturas: FaturaEnriquecida[]): number {
  return Math.max(0, totalFaturado(faturas) - totalRecebido(faturas));
}

export function totalVencido(
  faturas: FaturaEnriquecida[],
  hoje: Date = new Date()
): number {
  const hojeMs = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime();
  return faturas.reduce((acc, f) => {
    if (!f.dataVencimento) return acc;
    const venc = new Date(f.dataVencimento).getTime();
    if (venc >= hojeMs) return acc;
    const total = valorFaturaBRL(f);
    const pagos = (f.pagamentos ?? []).reduce(
      (s, p) => s + valorPagamentoBRL(p, f.moeda),
      0
    );
    return acc + Math.max(0, total - pagos);
  }, 0);
}

/**
 * Conta quantas faturas estão vencidas (dataVencimento < hoje E valorRestante > 0).
 */
export function countFaturasVencidas(
  faturas: FaturaEnriquecida[],
  hoje: Date = new Date()
): number {
  const hojeMs = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime();
  return faturas.reduce((n, f) => {
    if (!f.dataVencimento) return n;
    const venc = new Date(f.dataVencimento).getTime();
    if (venc >= hojeMs) return n;
    const total = valorFaturaBRL(f);
    const pagos = (f.pagamentos ?? []).reduce(
      (s, p) => s + valorPagamentoBRL(p, f.moeda),
      0
    );
    return total - pagos > 0 ? n + 1 : n;
  }, 0);
}

// ============================================================================
// Outros Custos
// ============================================================================

function valorOutroCustoBRL(c: OutroCusto): number {
  return paraBRL(Number(c.valor), c.moeda, c.cambio);
}

export function totalOutrosCustosRepassar(outrosCustos: OutroCusto[]): number {
  return outrosCustos
    .filter((c) => c.natureza === 'REPASSAR')
    .reduce((acc, c) => acc + valorOutroCustoBRL(c), 0);
}

export function totalOutrosCustosCobrar(outrosCustos: OutroCusto[]): number {
  return outrosCustos
    .filter((c) => c.natureza === 'COBRAR')
    .reduce((acc, c) => acc + valorOutroCustoBRL(c), 0);
}

export function totalOutrosCustosPagos(outrosCustos: OutroCusto[]): number {
  return outrosCustos.reduce((acc, c) => {
    const pagos = (c.pagamentos ?? [])
      .filter((p) => !p.estornado)
      .reduce((s, p) => s + Number(p.valor), 0);
    return acc + pagos;
  }, 0);
}

// ============================================================================
// Pasta Documental
// ============================================================================

export function consolidarPasta(detalhes: PastaDocumentalItem[]): {
  total: number;
  pago: number;
  detalhes: PastaDocumentalItem[];
} {
  const total = detalhes.reduce((s, d) => s + Number(d.valor), 0);
  const pago = detalhes
    .filter((d) => d.pago === true)
    .reduce((s, d) => s + Number(d.valor), 0);
  return { total, pago, detalhes };
}

// ============================================================================
// Enriquecimento de fatura (popula valorPago, valorRestante, *BRL)
// ============================================================================

/**
 * Enriquece uma fatura crua com os campos derivados:
 *   valorPago, valorRestante (na moeda original)
 *   valorTotalBRL, valorPagoBRL, valorRestanteBRL (em BRL)
 */
export function enriquecerFatura(
  f: Omit<
    FaturaEnriquecida,
    'valorPago' | 'valorRestante' | 'valorTotalBRL' | 'valorPagoBRL' | 'valorRestanteBRL'
  >
): FaturaEnriquecida {
  const pagos = (f.pagamentos ?? [])
    .filter((p) => !p.estornado)
    .reduce((s, p) => s + Number(p.valor), 0);

  const valorPago = pagos;
  const valorRestante = Math.max(0, Number(f.valor) - valorPago);

  const valorTotalBRL = paraBRL(Number(f.valor), f.moeda, f.cambio);
  const valorPagoBRL = paraBRL(valorPago, f.moeda, f.cambio);
  const valorRestanteBRL = Math.max(0, valorTotalBRL - valorPagoBRL);

  return {
    ...f,
    valorPago,
    valorRestante,
    valorTotalBRL,
    valorPagoBRL,
    valorRestanteBRL,
  };
}

// ============================================================================
// Receitas consolidado
// ============================================================================

export function calcReceitasConsolidado(
  faturas: FaturaEnriquecida[],
  outrosCustos: OutroCusto[]
): {
  total: number;
  totalRecebido: number;
  totalAReceber: number;
  totalVencido: number;
} {
  const tFat = totalFaturado(faturas);
  const tCobrar = totalOutrosCustosCobrar(outrosCustos);
  return {
    total: tFat + tCobrar,
    totalRecebido: totalRecebido(faturas),
    totalAReceber: totalAReceber(faturas),
    totalVencido: totalVencido(faturas),
  };
}

// ============================================================================
// Resumo completo — popula AMBOS os nomes (novos e legados)
// ============================================================================

export function calcularResumo(
  faturas: FaturaEnriquecida[],
  outrosCustos: OutroCusto[],
  pasta: { total: number; pago: number }
): ResumoFinanceiro {
  // Valores base
  const tFaturado = totalFaturado(faturas);
  const tRecebido = totalRecebido(faturas);
  const tAReceber = totalAReceber(faturas);
  const tVencido = totalVencido(faturas);

  const custosRepassar = totalOutrosCustosRepassar(outrosCustos);
  const custosPagos = totalOutrosCustosPagos(outrosCustos);

  const totalCustos = pasta.total + custosRepassar;
  const totalCustosPagos = pasta.pago + custosPagos;
  const custoPendente = Math.max(0, totalCustos - totalCustosPagos);

  const lucroProjetado = tFaturado - totalCustos;
  const margem = tFaturado > 0 ? (lucroProjetado / tFaturado) * 100 : 0;
  const saldoAtual = tRecebido - totalCustosPagos;

  const pctRecebido = tFaturado > 0 ? (tRecebido / tFaturado) * 100 : 0;
  const pctPago = totalCustos > 0 ? (totalCustosPagos / totalCustos) * 100 : 0;

  return {
    // Nomes novos
    totalFaturado: tFaturado,
    totalRecebido: tRecebido,
    totalAReceber: tAReceber,
    totalVencido: tVencido,
    totalCustos,
    totalCustosPagos,
    lucroProjetado,
    margem,
    saldoAtual,

    // Nomes legados (aliases)
    totalCobrado: tFaturado,
    recebido: tRecebido,
    aReceber: tAReceber,
    vencido: tVencido,
    custo: totalCustos,
    custoPago: totalCustosPagos,
    custoPendente,
    lucro: lucroProjetado,
    numFaturas: faturas.length,
    vencidasCount: countFaturasVencidas(faturas),
    pctRecebido,
    pctPago,
  };
}

// ============================================================================
// Builder do contexto completo
// ============================================================================

export function montarContexto(params: {
  processoId: number;
  nomeFamilia: string;
  pais?: string | null;
  etapaAtual?: string | null;
  faturas: FaturaEnriquecida[];
  outrosCustos: OutroCusto[];
  pastaDetalhes: PastaDocumentalItem[];
  pessoas?: FinanceiroContext['pessoas'];
  contasPagar?: FinanceiroContext['contasPagar'];
  refresh?: () => void | Promise<void>;
}): FinanceiroContext {
  const {
    processoId,
    nomeFamilia,
    pais = null,
    etapaAtual = null,
    faturas,
    outrosCustos,
    pastaDetalhes,
    pessoas = [],
    contasPagar = [],
    refresh = () => {},
  } = params;

  const pasta = consolidarPasta(pastaDetalhes);

  return {
    processoId,
    nomeFamilia,
    pais,
    etapaAtual,
    faturas,
    outrosCustos,
    pessoas,
    pastaTotal: pasta.total,
    pastaPago: pasta.pago,
    pastaDetalhes: pasta.detalhes,
    contasPagar,
    resumo: calcularResumo(faturas, outrosCustos, pasta),
    moedaBase: 'BRL',
    atualizadoEm: new Date().toISOString(),
    refresh,
  };
}
/**
 * Helpers de formatação do módulo Financeiro — v3 final.
 *
 * Substitui o antigo `src/lib/financeiro/helpers-v2.ts` (deletado).
 * Contém TODAS as funções que os componentes e PDFs usavam.
 *
 * Path correto: @/src/lib/financeiro/helpers
 */

import type {
  Moeda,
  FaturaEnriquecida,
  PagamentoFaturaEnriquecido,
} from '@/src/types/financeiro';

// ============================================================================
// Data / tempo
// ============================================================================

/**
 * Retorna a data de hoje (zeroed — 00:00:00).
 * Usado nos PDFs pra "emitido em".
 */
export function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// ============================================================================
// Símbolo/identificação de moeda
// ============================================================================

export function simboloMoeda(moeda: Moeda | string | null | undefined): string {
  switch (moeda) {
    case 'BRL':
      return 'R$';
    case 'EUR':
      return '€';
    case 'USD':
      return 'US$';
    default:
      return 'R$';
  }
}

// ============================================================================
// Formatação de moeda / números
// ============================================================================

/** Formata valor em BRL completo (R$ 1.234,56). */
export function fmtBRL(valor: number | string | null | undefined): string {
  const n = Number(valor ?? 0);
  if (!Number.isFinite(n)) return 'R$ 0,00';
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Formata valor em BRL compacto (R$ 1,2k, R$ 3,5M). */
export function fmtBRLCompact(valor: number | string | null | undefined): string {
  const raw = Number(valor ?? 0);
  if (!Number.isFinite(raw)) return 'R$ 0';
  const n = Math.abs(raw);
  const sign = raw < 0 ? '-' : '';
  if (n >= 1_000_000) return `${sign}R$ ${(n / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (n >= 1_000) return `${sign}R$ ${(n / 1_000).toFixed(1).replace('.', ',')}k`;
  return `${sign}R$ ${n.toFixed(0)}`;
}

/** Formata um valor em qualquer moeda suportada. */
export function fmtMoeda(
  valor: number | string | null | undefined,
  moeda: Moeda = 'BRL'
): string {
  const n = Number(valor ?? 0);
  if (!Number.isFinite(n)) return '0,00';

  const localeMap: Record<Moeda, string> = {
    BRL: 'pt-BR',
    EUR: 'de-DE',
    USD: 'en-US',
  };

  return n.toLocaleString(localeMap[moeda], {
    style: 'currency',
    currency: moeda,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Formata número com flexibilidade:
 *   fmt(1234.5)        → "1.234,50"
 *   fmt(1234.5, 'BRL') → "R$ 1.234,50"
 *   fmt(1234.5, 2)     → "1.234,50"
 */
export function fmt(
  valor: number | string | null | undefined,
  arg2?: Moeda | number
): string {
  const n = Number(valor ?? 0);

  if (typeof arg2 === 'string') {
    return fmtMoeda(n, arg2 as Moeda);
  }

  const casas = typeof arg2 === 'number' ? arg2 : 2;
  if (!Number.isFinite(n)) return '0,00';
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

/** Formata percentual (0.42 → "42%"). */
export function fmtPct(valor: number | null | undefined, casas = 0): string {
  const n = Number(valor ?? 0);
  if (!Number.isFinite(n)) return '0%';
  return `${(n * 100).toFixed(casas).replace('.', ',')}%`;
}

// ============================================================================
// Formatação de datas
// ============================================================================

/** Formata data ISO ou Date para dd/mm/aaaa (pt-BR). */
export function fmtDataBR(data: string | Date | null | undefined): string {
  if (!data) return '-';
  const d = typeof data === 'string' ? new Date(data) : data;
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Formata data+hora ISO para dd/mm/aaaa hh:mm. */
export function fmtDataHoraBR(data: string | Date | null | undefined): string {
  if (!data) return '-';
  const d = typeof data === 'string' ? new Date(data) : data;
  if (Number.isNaN(d.getTime())) return '-';
  return `${fmtDataBR(d)} ${d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

/** Quantos dias faltam (+) ou passaram (−) até a data. */
export function diasAte(data: string | Date | null | undefined): number | null {
  if (!data) return null;
  const d = typeof data === 'string' ? new Date(data) : data;
  if (Number.isNaN(d.getTime())) return null;
  const h = new Date();
  h.setHours(0, 0, 0, 0);
  const alvo = new Date(d);
  alvo.setHours(0, 0, 0, 0);
  return Math.round((alvo.getTime() - h.getTime()) / (1000 * 60 * 60 * 24));
}

// ============================================================================
// Conversão pra BRL (multi-moeda)
// ============================================================================

export function paraBRL(
  valor: number | string | null | undefined,
  moeda: Moeda = 'BRL',
  cambio?: number | null
): number {
  const n = Number(valor ?? 0);
  if (!Number.isFinite(n)) return 0;
  if (moeda === 'BRL') return n;
  const c = Number(cambio ?? 0);
  if (!Number.isFinite(c) || c <= 0) return n;
  return n * c;
}

// ============================================================================
// Helpers de pagamento
// ============================================================================

/**
 * Nome do pagador de um pagamento (olhando nos destinatários).
 */
export function nomeDoPagador(p: PagamentoFaturaEnriquecido): string {
  const dests = p.destinatarios ?? [];
  if (dests.length === 0) return '—';
  if (dests.length === 1) return dests[0].nome;
  return `${dests[0].nome} e mais ${dests.length - 1}`;
}

/** Pagamentos ativos (não estornados) de uma fatura. */
export function pagamentosAtivos(
  fatura: FaturaEnriquecida
): PagamentoFaturaEnriquecido[] {
  return (fatura.pagamentos ?? []).filter((p) => !p.estornado);
}

// ============================================================================
// Valor por extenso (para recibos)
// ============================================================================

const UNIDADES = [
  '',
  'um',
  'dois',
  'três',
  'quatro',
  'cinco',
  'seis',
  'sete',
  'oito',
  'nove',
  'dez',
  'onze',
  'doze',
  'treze',
  'quatorze',
  'quinze',
  'dezesseis',
  'dezessete',
  'dezoito',
  'dezenove',
];
const DEZENAS = [
  '',
  '',
  'vinte',
  'trinta',
  'quarenta',
  'cinquenta',
  'sessenta',
  'setenta',
  'oitenta',
  'noventa',
];
const CENTENAS = [
  '',
  'cento',
  'duzentos',
  'trezentos',
  'quatrocentos',
  'quinhentos',
  'seiscentos',
  'setecentos',
  'oitocentos',
  'novecentos',
];

function grupoPorExtenso(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const parts: string[] = [];
  if (c > 0) parts.push(CENTENAS[c]);
  if (resto > 0) {
    if (resto < 20) {
      parts.push(UNIDADES[resto]);
    } else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      if (u === 0) parts.push(DEZENAS[d]);
      else parts.push(`${DEZENAS[d]} e ${UNIDADES[u]}`);
    }
  }
  return parts.join(' e ');
}

/**
 * Converte um valor em BRL para a forma escrita (para recibos).
 *
 * Ex.: valorPorExtenso(1234.56) → "mil, duzentos e trinta e quatro reais e cinquenta e seis centavos"
 */
export function valorPorExtenso(valor: number): string {
  if (!Number.isFinite(valor)) return 'zero reais';
  const v = Math.round(Math.abs(valor) * 100) / 100;

  const inteiros = Math.floor(v);
  const centavos = Math.round((v - inteiros) * 100);

  function numeroParaExtenso(n: number): string {
    if (n === 0) return 'zero';
    if (n === 1000) return 'mil';

    const bilhoes = Math.floor(n / 1_000_000_000);
    const milhoes = Math.floor((n % 1_000_000_000) / 1_000_000);
    const milhares = Math.floor((n % 1_000_000) / 1_000);
    const unidades = n % 1000;

    const partes: string[] = [];

    if (bilhoes > 0) {
      partes.push(
        bilhoes === 1
          ? 'um bilhão'
          : `${grupoPorExtenso(bilhoes)} bilhões`
      );
    }
    if (milhoes > 0) {
      partes.push(
        milhoes === 1
          ? 'um milhão'
          : `${grupoPorExtenso(milhoes)} milhões`
      );
    }
    if (milhares > 0) {
      partes.push(milhares === 1 ? 'mil' : `${grupoPorExtenso(milhares)} mil`);
    }
    if (unidades > 0) {
      partes.push(grupoPorExtenso(unidades));
    }

    return partes.join(', ');
  }

  const parteInteira =
    inteiros === 0
      ? 'zero reais'
      : inteiros === 1
        ? 'um real'
        : `${numeroParaExtenso(inteiros)} reais`;

  if (centavos === 0) return parteInteira;

  const parteCentavos =
    centavos === 1 ? 'um centavo' : `${numeroParaExtenso(centavos)} centavos`;

  return `${parteInteira} e ${parteCentavos}`;
}
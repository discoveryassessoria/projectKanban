// lib/financeiro/encargos-boleto.ts
// ============================================================================
// ENCARGOS DE BOLETO por EVENTO — emissão, liquidação, multa e juros aplicados
// no MOMENTO CORRETO, nunca antecipados no cronograma. PURO (sem Prisma).
//
//   • Emissão (R$ 5,00): quando o título é efetivamente EMITIDO.
//   • Liquidação/pagamento (R$ 5,00): somente quando o recebimento é CONFIRMADO.
//   • Multa (2%): uma única vez, após a carência (3º dia de atraso).
//   • Juros (1% a.m., simples, pro-rata): durante o atraso REAL, sem capitalizar.
//
// O cronograma guarda apenas as REGRAS/snapshot; estes valores só existem quando
// o evento acontece. Antecipar liquidação/multa/juros é proibido.
// ============================================================================

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100
const num = (v: unknown) => { const n = Number(v); return isFinite(n) ? n : 0 }

export interface RegrasBoleto {
  /** Taxa fixa de emissão (default 5,00). */
  taxaEmissao?: number | string | null
  /** Taxa fixa de liquidação/pagamento (default 5,00). */
  taxaLiquidacao?: number | string | null
  /** Multa % sobre a parcela após a carência (default 2). */
  multaPercent?: number | string | null
  /** Carência da multa em dias (default 3 — "após o terceiro dia"). */
  carenciaMultaDias?: number | null
  /** Juros % ao mês, simples, pro-rata (default 1). */
  jurosMesPercent?: number | string | null
}

export interface EventoBoleto {
  /** Base da parcela do boleto. */
  base: number
  /** O título foi emitido? (aplica taxa de emissão) */
  emitido?: boolean
  /** O recebimento foi confirmado? (aplica taxa de liquidação) */
  liquidado?: boolean
  /** Dias de atraso reais na data de referência (0 = em dia / não vencido). */
  diasAtraso?: number
}

export interface ResultadoBoleto {
  base: number
  taxaEmissao: number
  taxaLiquidacao: number
  multa: number
  juros: number
  /** Encargos que se somam ao valor a receber (multa + juros). */
  totalEncargos: number
  /** Custos do escritório (emissão + liquidação) — não cobrados do cliente. */
  totalCustos: number
  memoria: string[]
}

/**
 * Encargos de UMA parcela de boleto no momento de referência. Cada componente
 * só existe quando seu evento ocorre — nada é antecipado.
 */
export function encargosBoletoNoEvento(ev: EventoBoleto, r: RegrasBoleto = {}): ResultadoBoleto {
  const base = cent(ev.base)
  const dias = Math.max(0, Math.trunc(ev.diasAtraso ?? 0))
  const memoria: string[] = []

  // Emissão: só quando emitido.
  const taxaEmissao = ev.emitido ? cent(num(r.taxaEmissao ?? 5)) : 0
  if (ev.emitido) memoria.push(`Emissão: ${taxaEmissao.toFixed(2)} (título emitido).`)
  else memoria.push('Emissão: não aplicada (título ainda não emitido).')

  // Liquidação: só quando o pagamento é confirmado.
  const taxaLiquidacao = ev.liquidado ? cent(num(r.taxaLiquidacao ?? 5)) : 0
  if (ev.liquidado) memoria.push(`Liquidação: ${taxaLiquidacao.toFixed(2)} (pagamento confirmado).`)
  else memoria.push('Liquidação: não aplicada (boleto não pago — não antecipar).')

  // Multa: uma vez, após a carência (3º dia). Nunca antes.
  const carenciaMulta = Math.max(0, Math.trunc(r.carenciaMultaDias ?? 3))
  let multa = 0
  if (dias > carenciaMulta) {
    const p = num(r.multaPercent ?? 2)
    multa = cent((base * p) / 100)
    memoria.push(`Multa ${p}% (atraso ${dias}d > carência ${carenciaMulta}d): ${multa.toFixed(2)}.`)
  } else if (dias > 0) {
    memoria.push(`Sem multa: atraso ${dias}d dentro da carência (${carenciaMulta}d).`)
  }

  // Juros: simples, pro-rata sobre a base mensal, durante o atraso REAL (desde o
  // 1º dia de atraso). Não capitaliza. Nunca calculado antecipadamente.
  let juros = 0
  if (dias > 0) {
    const taxaMes = num(r.jurosMesPercent ?? 1)
    const taxaDia = (taxaMes / 100) / 30
    juros = cent(base * taxaDia * dias)
    memoria.push(`Juros simples ${taxaMes}% a.m. pro-rata × ${dias}d: ${juros.toFixed(2)} (sem capitalização).`)
  }

  const totalEncargos = cent(multa + juros)
  const totalCustos = cent(taxaEmissao + taxaLiquidacao)
  return { base, taxaEmissao, taxaLiquidacao, multa, juros, totalEncargos, totalCustos, memoria }
}

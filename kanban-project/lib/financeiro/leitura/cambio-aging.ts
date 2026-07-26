// lib/financeiro/leitura/cambio-aging.ts
// ============================================================================
// Núcleo COMPARTILHADO de câmbio + aging + conversão BRL de uma receita/obrigação.
// Usado por listarReceitas (lista) E carregarReceitaDetalhe (detalhe) — garante que
// os MESMOS números apareçam nas duas telas. BRL = operacional; EUR = base do contrato.
//
// Identidades garantidas por construção:
//   valorContratadoBrl = recebidoBrl + saldoBrl
//   saldoBrl           = aVencerBrl + vencidoBrl
// ============================================================================
import {
  carregarCotacoesCorrentes, resolverTaxa, converter, cent as centCanonico,
  type CotacoesCorrentes,
} from '@/lib/financeiro/cambio/canonico'

export const cent = centCanonico
const num = (x: unknown): number | null => (x == null ? null : Number(x))

export type TipoCambio = 'FIXO' | 'VARIAVEL' | 'HOJE' | 'BRL' | 'NAO_DEFINIDO'

export interface ReceitaFx {
  fxRule?: string | null
  fxEstimado?: unknown
  fxFixo?: unknown
  fxData?: Date | null
  valorBrlFixo?: unknown
}
export interface ParcelaLite {
  vencimento: Date | string
  valor: unknown
  status: string
  cambioAplicado?: unknown
  valorBrl?: unknown
}
export interface CotacoesVivas {
  rates: Record<string, number | null>
  data: string | null
  /** forma canônica — presente quando veio de cotacoesVivas(). */
  correntes?: CotacoesCorrentes
}

export interface CambioAging {
  moedaBase: string
  valorBase: number
  cotacaoAplicada: number | null
  tipoCambio: TipoCambio
  dataCotacao: string | null
  valorContratadoBrl: number
  /**
   * Valor na MOEDA DE ORIGEM que não pôde ser convertido (estado AUSENTE).
   * > 0 significa: `valorContratadoBrl` NÃO representa este montante.
   * Zero aqui não é conversão — é ausência declarada.
   */
  valorNaoConvertido: number
  recebidoBrl: number
  saldoBrl: number
  aVencerBrl: number
  vencidoBrl: number
  parcelas: number
  parcelasRecebidas: number
  parcelasAVencer: number
  parcelasVencidas: number
  proximoVencimento: string | null
  statusLabel: string
}

/** Cotações vigentes (LÊ SÓ O BANCO — fonte Confidence). EUR/USD → BRL. Chamar UMA vez por request. */
export async function cotacoesVivas(): Promise<CotacoesVivas> {
  // Delega ao SERVIÇO CANÔNICO — consulta e política de ausência vivem lá.
  const c = await carregarCotacoesCorrentes()
  const rates: Record<string, number | null> = { ...c.taxas }
  for (const m of c.indisponiveis) rates[m] = null
  return { rates, data: c.dataReferencia, correntes: c }
}

/** Enum de categoria/serviço → label amigável (nunca vazar "HONORARIOS" cru p/ o usuário). */
export const CAT_LABEL: Record<string, string> = {
  HONORARIOS: 'Honorários',
  HONORARIOS_PRINCIPAIS: 'Honorários principais',
  REEMBOLSO: 'Reembolso',
  PASTA_DOCUMENTAL: 'Pasta documental',
  TRADUCOES_JURAMENTACOES: 'Traduções e juramentações',
  APOSTILAMENTOS: 'Apostilamentos',
  EMOLUMENTOS: 'Emolumentos',
  TAXAS: 'Taxas',
  OUTROS: 'Outros',
}
export const labelServico = (raw?: string | null): string | null => {
  if (!raw) return null
  if (CAT_LABEL[raw]) return CAT_LABEL[raw]
  if (/^[A-Z0-9_]+$/.test(raw)) return raw.charAt(0) + raw.slice(1).toLowerCase().replace(/_/g, ' ')
  return raw
}

export function computeCambioAging(input: {
  moedaBase: string
  valorBase: number
  saldoLedger: number
  recebidoLedger: number
  vencimento: Date | string | null
  receita: ReceitaFx | null
  parcelas: ParcelaLite[]
  live: CotacoesVivas
  agora?: number
}): CambioAging {
  const agora = input.agora ?? Date.now()
  const { moedaBase, valorBase, receita: rec, parcelas: pcs, live } = input
  const venc = input.vencimento ? new Date(input.vencimento) : null

  // ── câmbio: resolvido pelo SERVIÇO CANÔNICO ────────────────────────────────
  // O fato financeiro do processo é CONSOLIDADO, então a taxa congelada na
  // Receita de origem tem precedência sobre a cotação corrente
  // (preferirHistorico). Sem taxa congelada nem cotação oficial, o estado é
  // AUSENTE: o valor NÃO é convertido e vai para `valorNaoConvertido` — nunca
  // mais entra no BRL como se fosse 1:1.
  const correntes: CotacoesCorrentes = live.correntes ?? {
    taxas: Object.fromEntries(Object.entries(live.rates).filter(([, v]) => v != null) as [string, number][]),
    indisponiveis: Object.entries(live.rates).filter(([, v]) => v == null).map(([m]) => m),
    dataReferencia: live.data,
    fonte: 'CotacaoCambio',
  }
  const fixo = rec?.fxRule === 'FIXO'
  const taxaCongelada = rec ? (fixo ? (num(rec.fxFixo) ?? num(rec.fxEstimado)) : (num(rec.fxEstimado) ?? num(rec.fxFixo))) : null
  const resolucao = resolverTaxa({
    moeda: moedaBase,
    correntes,
    snapshotHistorico: rec ? { taxa: taxaCongelada, data: rec.fxData ?? null } : null,
    preferirHistorico: true,
  })

  const cotacao: number | null = resolucao.taxa
  let tipo: TipoCambio
  if (resolucao.estado === 'BRL') tipo = 'BRL'
  else if (resolucao.estado === 'AUSENTE') tipo = 'NAO_DEFINIDO'
  else if (resolucao.estado === 'HISTORICO') tipo = fixo ? 'FIXO' : 'VARIAVEL'
  else tipo = 'HOJE'

  const dataCotacao: string | null = resolucao.dataCotacao
  const brlFixo = rec ? num(rec.valorBrlFixo) : null
  // BRL congelado é o próprio fato: manda quando a regra é FIXO.
  const contratadoConvertido =
    resolucao.estado === 'HISTORICO' && fixo && brlFixo != null
      ? cent(brlFixo)
      : converter(valorBase, resolucao)
  const contratadoBrl = contratadoConvertido ?? 0
  // rastreabilidade da ausência: o valor NÃO convertido, na moeda de origem
  const valorNaoConvertido = contratadoConvertido == null ? cent(valorBase) : 0

  const cot = cotacao
  const parcelaBrl = (pc: ParcelaLite): number => {
    const vb = num(pc.valorBrl); if (vb != null) return vb
    const ca = num(pc.cambioAplicado); if (ca) return Number(pc.valor) * ca
    // sem taxa: NÃO converte (0) — o montante é reportado em valorNaoConvertido
    return cot ? Number(pc.valor) * cot : 0
  }

  // recebido em BRL — FONTE ÚNICA = Ledger V3 (recebidoLedger, verdade do recebimento).
  // O motor V3 (registrarOcorrencia) baixa o razão mas NÃO vira ParcelaFinanceira.status;
  // por isso o razão manda sempre que tem movimento. Parcelas quitadas só cobrem dados
  // LEGADOS sem lançamento no razão. Taxa efetiva = contratadoBrl/valorBase (precisão total).
  const taxaEfetiva = valorBase > 0 ? contratadoBrl / valorBase : (cot ?? 1)
  const recebidoLedgerBrl = moedaBase === 'BRL' ? cent(input.recebidoLedger) : cent(input.recebidoLedger * taxaEfetiva)
  const recebidoParcelaBrl = cent(pcs.filter((pc) => pc.status === 'RECEBIDA' || pc.status === 'PAGA').reduce((s, pc) => s + parcelaBrl(pc), 0))
  const recebidoBrl = input.recebidoLedger > 0.005 ? recebidoLedgerBrl : recebidoParcelaBrl
  const saldoBrl = cent(contratadoBrl - recebidoBrl)

  // aging: divide o saldoBrl em vencido/a-vencer pela data das parcelas em aberto.
  const open = pcs.filter((pc) => pc.status === 'PENDENTE')
  let rawVenc = 0, rawAV = 0, nVenc = 0, nAV = 0
  for (const pc of open) {
    const brl = parcelaBrl(pc)
    if (new Date(pc.vencimento).getTime() < agora) { rawVenc += brl; nVenc++ } else { rawAV += brl; nAV++ }
  }
  let vencidoBrl = 0, aVencerBrl = 0
  const rawTot = rawVenc + rawAV
  if (rawTot > 0.005) {
    vencidoBrl = cent((saldoBrl * rawVenc) / rawTot)
    aVencerBrl = cent(saldoBrl - vencidoBrl)
  } else if (saldoBrl > 0.005) {
    const overdue = venc ? venc.getTime() < agora : false
    if (overdue) { vencidoBrl = saldoBrl; nVenc = nVenc || 1 } else { aVencerBrl = saldoBrl; nAV = nAV || 1 }
  }

  const overdueUnico = venc ? venc.getTime() < agora : false
  const parcelas = pcs.length > 0 ? pcs.length : 1
  // parcelas recebidas: por status (legado) OU, se o razão pagou sem virar status, por
  // COBERTURA do recebido sobre as parcelas em ordem de vencimento (consistente c/ o Ledger).
  let parcelasRecebidas: number
  if (pcs.length > 0) {
    const porStatus = pcs.filter((pc) => pc.status === 'RECEBIDA' || pc.status === 'PAGA').length
    if (porStatus > 0) parcelasRecebidas = porStatus
    else {
      let resto = recebidoBrl, n = 0
      for (const pc of [...pcs].sort((a, b) => new Date(a.vencimento).getTime() - new Date(b.vencimento).getTime())) {
        const b = parcelaBrl(pc); if (b > 0 && resto >= b - 0.005) { resto = cent(resto - b); n++ } else break
      }
      parcelasRecebidas = n
    }
  } else {
    parcelasRecebidas = input.recebidoLedger >= valorBase - 0.005 && valorBase > 0 ? 1 : 0
  }
  const parcelasAVencer = pcs.length > 0 ? nAV : (saldoBrl > 0.005 && !overdueUnico ? 1 : 0)
  const parcelasVencidas = pcs.length > 0 ? nVenc : (saldoBrl > 0.005 && overdueUnico ? 1 : 0)
  const proximoVencimento = open.length > 0
    ? new Date(Math.min(...open.map((pc) => new Date(pc.vencimento).getTime()))).toISOString()
    : (saldoBrl > 0.005 && venc ? venc.toISOString() : null)

  const statusLabel = saldoBrl <= 0.005 ? 'QUITADO' : vencidoBrl > 0.005 ? 'VENCIDO' : recebidoBrl > 0.005 ? 'PARCIAL' : 'A VENCER'

  return {
    moedaBase, valorBase: cent(valorBase), cotacaoAplicada: cot, tipoCambio: tipo, dataCotacao,
    valorContratadoBrl: contratadoBrl, valorNaoConvertido, recebidoBrl, saldoBrl, aVencerBrl, vencidoBrl,
    parcelas, parcelasRecebidas, parcelasAVencer, parcelasVencidas, proximoVencimento, statusLabel,
  }
}

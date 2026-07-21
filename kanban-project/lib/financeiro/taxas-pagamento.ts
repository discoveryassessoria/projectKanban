// lib/financeiro/taxas-pagamento.ts
// ============================================================================
// MOTOR DE TAXAS — fonte única do cálculo de taxas de pagamento.
//
// A Condição de Pagamento vincula taxas (CondicaoPagamentoTaxa); este módulo
// calcula quanto cada taxa incide sobre um lançamento e produz VALOR BRUTO,
// VALOR DE TAXAS, VALOR LÍQUIDO e a MEMÓRIA DE CÁLCULO — que é persistida no
// lançamento, congelada. Alterar uma taxa depois NUNCA recalcula lançamentos
// antigos: eles guardam o resultado e a referência da taxa usada.
//
// INVARIANTE: o valor CONTRATADO (o que o cliente deve) não muda por causa de
// taxa. Taxa de adquirente/banco reduz o LÍQUIDO que o escritório recebe.
// Quando `quemAbsorve = CLIENTE`, a taxa é registrada como repasse e o líquido
// permanece igual ao bruto.
//
// Módulo PURO: sem Prisma, sem fetch, sem React.
// ============================================================================

export type TipoTaxa = 'PERCENTUAL' | 'FIXA' | 'PERCENTUAL_MAIS_FIXA' | 'TARIFA_BANCARIA' | 'ANTECIPACAO'
export type BaseIncidencia = 'TOTAL' | 'PARCELA'
export type QuemAbsorve = 'EMPRESA' | 'CLIENTE'

/** Espelha TaxaPagamento na forma que o motor consome. */
export interface TaxaView {
  id?: number
  nome?: string | null
  codigo?: string | null
  tipo?: TipoTaxa | null
  percentual?: number | string | null
  valorFixo?: number | string | null
  /** Cobrada uma vez por PARCELA em vez de uma vez no total. */
  baseIncidencia?: BaseIncidencia | null
  quemAbsorve?: QuemAbsorve | null
  adquirente?: string | null
  /** Faixa de parcelamento em que a taxa vale (inclusive). */
  parcelasDe?: number | null
  parcelasAte?: number | null
  /** Antecipação: percentual ao mês sobre o valor antecipado. */
  antecipacaoAtiva?: boolean | null
  antecipacaoPercent?: number | string | null
  ativo?: boolean | null
  vigenciaInicio?: string | Date | null
  vigenciaFim?: string | Date | null
}

export interface LinhaTaxa {
  taxaId: number | null
  nome: string
  tipo: TipoTaxa
  adquirente: string | null
  quemAbsorve: QuemAbsorve
  base: number
  percentual: number
  valorFixo: number
  /** Valor total desta taxa no lançamento. */
  valor: number
  formula: string
}

export interface ResultadoTaxas {
  valorBruto: number
  /** Soma das taxas absorvidas pela EMPRESA (as que reduzem o líquido). */
  valorTaxas: number
  /** Taxas repassadas ao CLIENTE — informativas, não reduzem o líquido. */
  valorTaxasRepassadas: number
  valorLiquido: number
  linhas: LinhaTaxa[]
  /** Congelado no lançamento; nunca recalculado retroativamente. */
  memoria: string[]
}

export interface ContextoTaxas {
  valorBruto: number
  nParcelas: number
  moeda?: string
  emDatas?: Date
  /** Dias de antecipação, quando houver taxa de antecipação. */
  diasAntecipacao?: number
}

function num(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'number') return isFinite(v) ? v : 0
  const n = parseFloat(String(v))
  return isFinite(n) ? n : 0
}

function cent(v: number): number {
  return Math.round(v * 100) / 100
}

function comoData(v: string | Date | null | undefined): Date | null {
  if (!v) return null
  const d = v instanceof Date ? new Date(v) : new Date(String(v).includes('T') ? String(v) : `${String(v)}T12:00:00Z`)
  return isNaN(d.getTime()) ? null : d
}

/** A taxa vale para este lançamento? Restrição não declarada é permissiva. */
export function taxaAplicavel(t: TaxaView, ctx: ContextoTaxas): boolean {
  if (t.ativo === false) return false
  const agora = ctx.emDatas ?? new Date()
  const ini = comoData(t.vigenciaInicio)
  const fim = comoData(t.vigenciaFim)
  if (ini && agora.getTime() < ini.getTime()) return false
  if (fim && agora.getTime() > fim.getTime()) return false
  if (t.parcelasDe != null && ctx.nParcelas < t.parcelasDe) return false
  if (t.parcelasAte != null && ctx.nParcelas > t.parcelasAte) return false
  return true
}

/**
 * Calcula todas as taxas de um lançamento.
 * Determinístico: mesmos insumos → mesmo resultado, sempre.
 */
export function calcularTaxas(taxas: TaxaView[], ctx: ContextoTaxas): ResultadoTaxas {
  const valorBruto = cent(num(ctx.valorBruto))
  const nParcelas = Math.max(1, Math.trunc(ctx.nParcelas || 1))
  const linhas: LinhaTaxa[] = []
  const memoria: string[] = [`Valor bruto: ${valorBruto.toFixed(2)} em ${nParcelas}x`]

  for (const t of (taxas ?? []).filter((x) => taxaAplicavel(x, ctx))) {
    const tipo = (t.tipo ?? 'PERCENTUAL') as TipoTaxa
    const quemAbsorve = (t.quemAbsorve ?? 'EMPRESA') as QuemAbsorve
    const porParcela = (t.baseIncidencia ?? 'TOTAL') === 'PARCELA'
    const percentual = num(t.percentual)
    const valorFixo = num(t.valorFixo)
    const nome = t.nome ?? t.codigo ?? `Taxa #${t.id ?? '?'}`

    // Base: total do lançamento, ou o valor de UMA parcela quando a taxa é por parcela.
    const base = porParcela ? cent(valorBruto / nParcelas) : valorBruto
    let valor = 0
    let formula = ''

    if (tipo === 'ANTECIPACAO') {
      const dias = Math.max(0, ctx.diasAntecipacao ?? 0)
      const aoMes = num(t.antecipacaoPercent)
      if (!t.antecipacaoAtiva || dias === 0 || aoMes === 0) continue
      valor = cent((base * aoMes * (dias / 30)) / 100)
      formula = `${base.toFixed(2)} × ${aoMes}%/mês × ${dias}/30 dias`
    } else if (tipo === 'FIXA' || tipo === 'TARIFA_BANCARIA') {
      valor = cent(porParcela ? valorFixo * nParcelas : valorFixo)
      formula = porParcela ? `${valorFixo.toFixed(2)} × ${nParcelas} parcelas` : `${valorFixo.toFixed(2)} fixo`
    } else if (tipo === 'PERCENTUAL_MAIS_FIXA') {
      const p = cent((base * percentual) / 100) * (porParcela ? nParcelas : 1)
      const f = porParcela ? valorFixo * nParcelas : valorFixo
      valor = cent(p + f)
      formula = `${base.toFixed(2)} × ${percentual}%${porParcela ? ` × ${nParcelas}` : ''} + ${f.toFixed(2)} fixo`
    } else {
      const p = cent((base * percentual) / 100)
      valor = cent(porParcela ? p * nParcelas : p)
      formula = `${base.toFixed(2)} × ${percentual}%${porParcela ? ` × ${nParcelas} parcelas` : ''}`
    }

    if (valor <= 0) continue

    linhas.push({
      taxaId: t.id ?? null,
      nome,
      tipo,
      adquirente: t.adquirente ?? null,
      quemAbsorve,
      base,
      percentual,
      valorFixo,
      valor,
      formula,
    })
    memoria.push(
      `${nome} (${tipo}${t.adquirente ? `, ${t.adquirente}` : ''}): ${formula} = ${valor.toFixed(2)} · absorvida por ${quemAbsorve === 'EMPRESA' ? 'nós' : 'cliente'}`,
    )
  }

  const valorTaxas = cent(linhas.filter((l) => l.quemAbsorve === 'EMPRESA').reduce((s, l) => s + l.valor, 0))
  const valorTaxasRepassadas = cent(linhas.filter((l) => l.quemAbsorve === 'CLIENTE').reduce((s, l) => s + l.valor, 0))
  const valorLiquido = cent(valorBruto - valorTaxas)

  memoria.push(`Taxas absorvidas: ${valorTaxas.toFixed(2)}`)
  if (valorTaxasRepassadas > 0) memoria.push(`Taxas repassadas ao cliente: ${valorTaxasRepassadas.toFixed(2)}`)
  memoria.push(`Valor líquido esperado: ${valorLiquido.toFixed(2)}`)

  return { valorBruto, valorTaxas, valorTaxasRepassadas, valorLiquido, linhas, memoria }
}

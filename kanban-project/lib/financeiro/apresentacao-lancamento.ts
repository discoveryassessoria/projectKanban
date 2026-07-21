// lib/financeiro/apresentacao-lancamento.ts
// ============================================================================
// FONTE ÚNICA de APRESENTAÇÃO do lançamento financeiro do Processo.
//
// Regras que este módulo é o único a decidir (UI e testes consomem daqui):
//
//   1. MOEDA ORIGINAL é a moeda principal. O valor em BRL é SEMPRE conversão
//      auxiliar/estimada — nunca substitui nem redefine o valor contratual.
//   2. Totais NUNCA somam moedas diferentes num único número. O agregado é
//      por moeda; o BRL aparece como linha auxiliar "estimado".
//   3. STATUS é derivado das parcelas + datas. "Inadimplente" é condição
//      calculada (parcela vencida com saldo), não status base.
//   4. AGRUPAMENTO é por FASE → SUBGRUPO. "Pasta Documental" só agrupa
//      lançamento vinculado a DOCUMENTO concreto; honorários contratuais
//      pertencem ao grupo comercial da fase.
//
// Módulo PURO: sem Prisma, sem fetch, sem React. Roda no server, no client e
// nos testes com os mesmos resultados.
// ============================================================================

export type Moeda = 'BRL' | 'EUR' | 'USD'
export type FxRule = 'FIXO' | 'VARIAVEL'
export type StatusParcela = 'PENDENTE' | 'RECEBIDA' | 'PAGA' | 'CANCELADA'
export type CategoriaReceita = 'HONORARIOS' | 'REEMBOLSO' | 'PASTA_DOCUMENTAL' | 'OUTROS'

/** §"STATUS FINANCEIROS" — estados canônicos visíveis do lançamento. */
export type StatusLancamento =
  | 'PREVISTO'
  | 'SEM_VENCIMENTO'
  | 'A_VENCER'
  | 'PARCIALMENTE_RECEBIDO'
  | 'RECEBIDO'
  | 'VENCIDO'
  | 'CANCELADO'
  | 'ESTORNADO'

export const STATUS_LABEL: Record<StatusLancamento, string> = {
  PREVISTO: 'Previsto',
  SEM_VENCIMENTO: 'Vencimento não definido',
  A_VENCER: 'A vencer',
  PARCIALMENTE_RECEBIDO: 'Parcialmente recebido',
  RECEBIDO: 'Recebido',
  VENCIDO: 'Vencido',
  CANCELADO: 'Cancelado',
  ESTORNADO: 'Estornado',
}

export interface ParcelaView {
  id: number
  numero: number
  vencimento: string | null
  valor: number | string
  status: StatusParcela
  dataPagamento?: string | null
  cambioAplicado?: number | string | null
  valorBrl?: number | string | null
  formaPagamento?: string | null
  banco?: string | null
  comprovanteUrl?: string | null
  comprovanteNome?: string | null
  observacoes?: string | null
}

export interface LancamentoView {
  id: number
  codigo: string
  categoria: CategoriaReceita
  descricao: string
  moeda: Moeda
  valor: number | string
  fxEstimado?: number | string | null
  fxRule?: FxRule | null
  fxFixo?: number | string | null
  fxData?: string | null
  nParcelas?: number
  data1?: string | null
  status?: 'ATIVA' | 'RASCUNHO' | 'CANCELADA' | null
  cancelada?: boolean
  canceladoEm?: string | null
  estornadoEm?: string | null
  estornoDeId?: number | null
  parcelas?: ParcelaView[]
  origem?: string | null
  phaseKey?: string | null
  documentoId?: number | null
  personId?: number | null
  tipoServicoId?: number | null
  pessoa?: { id: number; nome: string; sobrenome?: string | null } | null
  tipoServico?: { id: number; nome: string } | null
  documento?: { id: number; tipo: string | null } | null
  chaveIdempotencia?: string | null
}

// ── numéricos / datas ────────────────────────────────────────────────────────

export function num(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'number') return isFinite(v) ? v : 0
  const n = parseFloat(String(v))
  return isFinite(n) ? n : 0
}

/** Meia-noite local da data ISO (aceita 'YYYY-MM-DD' e ISO completo). */
export function aoDia(iso?: string | null): Date | null {
  if (!iso) return null
  const d = new Date(iso.includes('T') ? iso : `${iso}T00:00:00`)
  if (isNaN(d.getTime())) return null
  d.setHours(0, 0, 0, 0)
  return d
}

function hojeAoDia(agora: Date): Date {
  const d = new Date(agora)
  d.setHours(0, 0, 0, 0)
  return d
}

// ── câmbio ───────────────────────────────────────────────────────────────────

/**
 * Câmbio efetivo moeda→BRL. FIXO usa o câmbio congelado; VARIÁVEL usa o
 * estimado. Nunca altera o valor ORIGINAL — só a conversão auxiliar.
 */
export function cambioEfetivo(l: Pick<LancamentoView, 'moeda' | 'fxRule' | 'fxFixo' | 'fxEstimado'>): number {
  if (l.moeda === 'BRL') return 1
  if (l.fxRule === 'FIXO' && num(l.fxFixo) > 0) return num(l.fxFixo)
  const est = num(l.fxEstimado)
  return est > 0 ? est : 1
}

/** A conversão em BRL é ESTIMADA sempre que o câmbio não estiver congelado. */
export function conversaoEhEstimada(l: Pick<LancamentoView, 'moeda' | 'fxRule' | 'fxFixo'>): boolean {
  if (l.moeda === 'BRL') return false
  return !(l.fxRule === 'FIXO' && num(l.fxFixo) > 0)
}

// ── parcelas ─────────────────────────────────────────────────────────────────

export function parcelaQuitada(p: ParcelaView): boolean {
  return p.status === 'RECEBIDA' || p.status === 'PAGA'
}

export function parcelaEmAberto(p: ParcelaView): boolean {
  return p.status === 'PENDENTE'
}

/** Parcela vencida = em aberto, COM vencimento definido, e vencimento < hoje. */
export function parcelaVencida(p: ParcelaView, agora: Date = new Date()): boolean {
  if (!parcelaEmAberto(p)) return false
  const v = aoDia(p.vencimento)
  if (!v) return false // sem vencimento NUNCA é vencida
  return v.getTime() < hojeAoDia(agora).getTime()
}

// ── totais do lançamento (na MOEDA ORIGINAL) ─────────────────────────────────

export interface TotaisLancamento {
  moeda: Moeda
  /** Valor contratual — o valor do lançamento, na moeda original. */
  contratado: number
  recebido: number
  saldo: number
  /** % efetivamente recebido em VALOR (não em contagem de parcelas). */
  percentualRecebido: number
  parcelasTotal: number
  parcelasRecebidas: number
  parcelasVencidas: number
  /** Conversão auxiliar — nunca é o valor principal. */
  cambio: number
  contratadoBrl: number
  recebidoBrl: number
  saldoBrl: number
  conversaoEstimada: boolean
  /** Vencimento em aberto mais próximo; null quando não há data definida. */
  proximoVencimento: string | null
  semVencimento: boolean
}

export function totaisDoLancamento(l: LancamentoView, agora: Date = new Date()): TotaisLancamento {
  const parcelas = l.parcelas ?? []
  const vivas = parcelas.filter((p) => p.status !== 'CANCELADA')
  const cambio = cambioEfetivo(l)

  // O contratado é o VALOR do lançamento (motor), não a soma das parcelas —
  // assim reparcelar nunca cria nem destrói receita.
  const contratado = num(l.valor)

  let recebido = 0
  let recebidoBrl = 0
  let parcelasRecebidas = 0
  let parcelasVencidas = 0
  let proximo: Date | null = null
  let proximoIso: string | null = null
  let abertas = 0

  for (const p of vivas) {
    const v = num(p.valor)
    if (parcelaQuitada(p)) {
      recebido += v
      // Recebido em BRL usa o câmbio APLICADO no recebimento (histórico), não o de hoje.
      recebidoBrl += num(p.valorBrl) || v * (num(p.cambioAplicado) || cambio)
      parcelasRecebidas++
      continue
    }
    if (parcelaEmAberto(p)) {
      abertas++
      const d = aoDia(p.vencimento)
      if (d) {
        if (parcelaVencida(p, agora)) parcelasVencidas++
        if (proximo == null || d.getTime() < proximo.getTime()) {
          proximo = d
          proximoIso = p.vencimento ?? null
        }
      }
    }
  }

  const saldo = Number((contratado - recebido).toFixed(2))
  const percentualRecebido = contratado > 0 ? Math.min(100, (recebido / contratado) * 100) : 0
  const contratadoBrl = Number((contratado * cambio).toFixed(2))

  return {
    moeda: l.moeda,
    contratado,
    recebido: Number(recebido.toFixed(2)),
    saldo,
    percentualRecebido,
    parcelasTotal: vivas.length,
    parcelasRecebidas,
    parcelasVencidas,
    cambio,
    contratadoBrl,
    recebidoBrl: Number(recebidoBrl.toFixed(2)),
    saldoBrl: Number((contratadoBrl - recebidoBrl).toFixed(2)),
    conversaoEstimada: conversaoEhEstimada(l),
    proximoVencimento: proximoIso,
    // Só é "sem vencimento" quando HÁ parcela em aberto e NENHUMA tem data.
    semVencimento: abertas > 0 && proximo == null,
  }
}

// ── status ───────────────────────────────────────────────────────────────────

/**
 * §"REGRAS DE DATA" — status canônico do lançamento.
 * Ordem de precedência: estornado → cancelado → recebido → vencido →
 * parcialmente recebido → sem vencimento → a vencer → previsto.
 */
export function statusDoLancamento(l: LancamentoView, agora: Date = new Date()): StatusLancamento {
  if (l.estornadoEm) return 'ESTORNADO'
  if (l.cancelada || l.canceladoEm || l.status === 'CANCELADA') return 'CANCELADO'
  if (l.status === 'RASCUNHO') return 'PREVISTO'

  const t = totaisDoLancamento(l, agora)
  if (t.parcelasTotal === 0) return 'PREVISTO'
  if (t.saldo <= 0.004) return 'RECEBIDO'
  if (t.parcelasVencidas > 0) return 'VENCIDO'
  if (t.recebido > 0) return 'PARCIALMENTE_RECEBIDO'
  if (t.proximoVencimento == null) return 'SEM_VENCIMENTO'
  return 'A_VENCER'
}

/**
 * Inadimplência é CONDIÇÃO calculada, nunca inferida de "ainda não pagou".
 * Exige: parcela vencida + saldo pendente + não cancelado + não estornado.
 */
export function estaInadimplente(l: LancamentoView, agora: Date = new Date()): boolean {
  const s = statusDoLancamento(l, agora)
  if (s === 'CANCELADO' || s === 'ESTORNADO' || s === 'RECEBIDO') return false
  const t = totaisDoLancamento(l, agora)
  return t.parcelasVencidas > 0 && t.saldo > 0.004
}

// ── agrupamento ──────────────────────────────────────────────────────────────

export type SubgrupoKey = 'PASTA_DOCUMENTAL' | 'HONORARIOS' | 'REEMBOLSOS' | 'OUTROS'

export const SUBGRUPO_LABEL: Record<SubgrupoKey, string> = {
  PASTA_DOCUMENTAL: 'Pasta Documental',
  HONORARIOS: 'Honorários Contratuais',
  REEMBOLSOS: 'Reembolsos',
  OUTROS: 'Outros Lançamentos',
}

/**
 * §"AGRUPAMENTO CORRETO" — a Pasta Documental agrupa EXCLUSIVAMENTE lançamento
 * vinculado a um DOCUMENTO concreto (emissão, tradução, apostilamento,
 * retificação, serviço incidente em documento).
 *
 * Ter sido gerado pelo motor NÃO torna um lançamento documental — era essa a
 * causa dos honorários contratuais caírem em "Pasta Documental".
 */
export function subgrupoDoLancamento(l: LancamentoView): SubgrupoKey {
  if (l.documentoId != null) return 'PASTA_DOCUMENTAL'
  if (l.categoria === 'PASTA_DOCUMENTAL') return 'PASTA_DOCUMENTAL'
  if (l.categoria === 'HONORARIOS') return 'HONORARIOS'
  if (l.categoria === 'REEMBOLSO') return 'REEMBOLSOS'
  return 'OUTROS'
}

export interface GrupoFase {
  phaseKey: string | null
  faseLabel: string
  subgrupos: Array<{
    key: SubgrupoKey
    label: string
    itens: LancamentoView[]
    totaisPorMoeda: TotalPorMoeda[]
  }>
}

const SEM_FASE = 'Sem fase definida'
const ORDEM_SUBGRUPO: SubgrupoKey[] = ['HONORARIOS', 'PASTA_DOCUMENTAL', 'REEMBOLSOS', 'OUTROS']

/** Agrupa FASE → SUBGRUPO → itens, com totais por moeda em cada subgrupo. */
export function agruparPorFase(
  lancamentos: LancamentoView[],
  faseLabels: Record<string, string> = {},
): GrupoFase[] {
  const porFase = new Map<string, LancamentoView[]>()
  for (const l of lancamentos) {
    const k = l.phaseKey ?? ''
    const arr = porFase.get(k)
    if (arr) arr.push(l)
    else porFase.set(k, [l])
  }

  const grupos: GrupoFase[] = []
  for (const [k, itens] of porFase) {
    const porSub = new Map<SubgrupoKey, LancamentoView[]>()
    for (const l of itens) {
      const s = subgrupoDoLancamento(l)
      const arr = porSub.get(s)
      if (arr) arr.push(l)
      else porSub.set(s, [l])
    }
    grupos.push({
      phaseKey: k || null,
      faseLabel: k ? (faseLabels[k] ?? rotularPhaseKey(k)) : SEM_FASE,
      subgrupos: ORDEM_SUBGRUPO.filter((s) => porSub.has(s)).map((s) => ({
        key: s,
        label: SUBGRUPO_LABEL[s],
        itens: porSub.get(s)!,
        totaisPorMoeda: totaisPorMoeda(porSub.get(s)!),
      })),
    })
  }

  // Fases nomeadas primeiro, "Sem fase" por último.
  grupos.sort((a, b) => {
    if (!a.phaseKey) return 1
    if (!b.phaseKey) return -1
    return a.faseLabel.localeCompare(b.faseLabel, 'pt-BR')
  })
  return grupos
}

/** Fallback de rótulo quando a fase não está no catálogo: 'genealogia' → 'Genealogia'. */
export function rotularPhaseKey(k: string): string {
  return k
    .split(/[_\-.\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ')
}

// ── totais por moeda (nunca soma moedas diferentes) ──────────────────────────

export interface TotalPorMoeda {
  moeda: Moeda
  contratado: number
  recebido: number
  saldo: number
  quantidade: number
  /** Conversão auxiliar agregada — apenas informativa. */
  contratadoBrl: number
  recebidoBrl: number
  saldoBrl: number
}

/**
 * §"PROCESSOS COM MÚLTIPLAS MOEDAS" — agrega por moeda ORIGINAL. Um processo
 * com EUR + USD devolve duas entradas; jamais um único número somado.
 */
export function totaisPorMoeda(lancamentos: LancamentoView[], agora: Date = new Date()): TotalPorMoeda[] {
  const mapa = new Map<Moeda, TotalPorMoeda>()
  for (const l of lancamentos) {
    const t = totaisDoLancamento(l, agora)
    const atual = mapa.get(l.moeda) ?? {
      moeda: l.moeda,
      contratado: 0, recebido: 0, saldo: 0, quantidade: 0,
      contratadoBrl: 0, recebidoBrl: 0, saldoBrl: 0,
    }
    atual.contratado += t.contratado
    atual.recebido += t.recebido
    atual.saldo += t.saldo
    atual.contratadoBrl += t.contratadoBrl
    atual.recebidoBrl += t.recebidoBrl
    atual.saldoBrl += t.saldoBrl
    atual.quantidade += 1
    mapa.set(l.moeda, atual)
  }
  const arr = [...mapa.values()].map((t) => ({
    ...t,
    contratado: Number(t.contratado.toFixed(2)),
    recebido: Number(t.recebido.toFixed(2)),
    saldo: Number(t.saldo.toFixed(2)),
    contratadoBrl: Number(t.contratadoBrl.toFixed(2)),
    recebidoBrl: Number(t.recebidoBrl.toFixed(2)),
    saldoBrl: Number(t.saldoBrl.toFixed(2)),
  }))
  // Maior contratado (em BRL, só para ordenar) primeiro — a moeda dominante lidera.
  arr.sort((a, b) => b.contratadoBrl - a.contratadoBrl)
  return arr
}

export interface ResumoReceitas {
  porMoeda: TotalPorMoeda[]
  /** true quando há mais de uma moeda original — a UI não pode exibir número único. */
  multiMoeda: boolean
  /** Soma auxiliar em BRL. SEMPRE rotulada como estimativa; nunca é o principal. */
  totalEstimadoBrl: number
  recebidoEstimadoBrl: number
  saldoEstimadoBrl: number
  quantidade: number
  parcelasPendentes: number
  parcelasVencidas: number
  inadimplente: boolean
  /** Situação consolidada exibida no card 4. */
  situacao: StatusLancamento
  semVencimento: boolean
}

/** Resumo dos 4 cards do topo. */
export function resumoReceitas(lancamentos: LancamentoView[], agora: Date = new Date()): ResumoReceitas {
  const ativos = lancamentos.filter((l) => {
    const s = statusDoLancamento(l, agora)
    return s !== 'CANCELADO' && s !== 'ESTORNADO'
  })
  const porMoeda = totaisPorMoeda(ativos, agora)

  let parcelasPendentes = 0
  let parcelasVencidas = 0
  let algumRecebido = false
  let tudoRecebido = ativos.length > 0
  let semVencimento = false

  for (const l of ativos) {
    const t = totaisDoLancamento(l, agora)
    parcelasPendentes += t.parcelasTotal - t.parcelasRecebidas
    parcelasVencidas += t.parcelasVencidas
    if (t.recebido > 0) algumRecebido = true
    if (t.saldo > 0.004) tudoRecebido = false
    if (t.saldo > 0.004 && t.proximoVencimento == null) semVencimento = true
  }

  const inadimplente = parcelasVencidas > 0
  let situacao: StatusLancamento
  if (ativos.length === 0) situacao = 'PREVISTO'
  else if (tudoRecebido) situacao = 'RECEBIDO'
  else if (inadimplente) situacao = 'VENCIDO'
  else if (algumRecebido) situacao = 'PARCIALMENTE_RECEBIDO'
  else if (semVencimento) situacao = 'SEM_VENCIMENTO'
  else situacao = 'A_VENCER'

  return {
    porMoeda,
    multiMoeda: porMoeda.length > 1,
    totalEstimadoBrl: Number(porMoeda.reduce((s, t) => s + t.contratadoBrl, 0).toFixed(2)),
    recebidoEstimadoBrl: Number(porMoeda.reduce((s, t) => s + t.recebidoBrl, 0).toFixed(2)),
    saldoEstimadoBrl: Number(porMoeda.reduce((s, t) => s + t.saldoBrl, 0).toFixed(2)),
    quantidade: ativos.length,
    parcelasPendentes,
    parcelasVencidas,
    inadimplente,
    situacao,
    semVencimento,
  }
}

// ── redistribuição de parcelas (o total contratual é invariante) ─────────────

export interface ParcelaPlano {
  numero: number
  vencimento: Date
  valor: number
}

function addMeses(d: Date, n: number): Date {
  const ano = d.getUTCFullYear()
  const mes = d.getUTCMonth()
  const dia = d.getUTCDate()
  const alvo = new Date(Date.UTC(ano, mes + n, 1))
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate()
  alvo.setUTCDate(Math.min(dia, ultimo))
  return alvo
}

/**
 * Redistribui o MESMO total em N parcelas. A última absorve o resto de centavos,
 * então a soma fecha exatamente o total contratual — reparcelar nunca cria nem
 * reduz receita.
 */
export function redistribuirParcelas(total: number, nParcelas: number, data1: Date): ParcelaPlano[] {
  if (!Number.isInteger(nParcelas) || nParcelas < 1) throw new Error('nParcelas deve ser inteiro >= 1')
  if (!(total > 0)) throw new Error('total deve ser > 0')
  const centavos = Math.round(total * 100)
  const base = Math.floor(centavos / nParcelas)
  const resto = centavos - base * nParcelas
  return Array.from({ length: nParcelas }, (_, i) => ({
    numero: i + 1,
    vencimento: addMeses(data1, i),
    valor: (i === nParcelas - 1 ? base + resto : base) / 100,
  }))
}

// ── formatação ───────────────────────────────────────────────────────────────

export function fmtMoeda(v: number, m: Moeda): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: m })
}
export function fmtBRL(v: number): string {
  return fmtMoeda(v, 'BRL')
}
export function fmtCambio(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}
export function fmtData(iso?: string | null): string {
  const d = aoDia(iso)
  return d ? d.toLocaleDateString('pt-BR') : 'A configurar'
}

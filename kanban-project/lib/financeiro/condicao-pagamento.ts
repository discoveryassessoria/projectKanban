// lib/financeiro/condicao-pagamento.ts
// ============================================================================
// MOTOR DE CRONOGRAMA — fonte ÚNICA de parcelamento do sistema financeiro.
//
// A partir daqui, NENHUMA tela, rota ou motor monta cronograma na mão: quem
// decide entrada, quantidade de parcelas, periodicidade, vencimentos e
// distribuição é a CONDIÇÃO DE PAGAMENTO.
//
// Invariante inegociável (mesma regra já valida em redistribuirParcelas):
//   a soma das parcelas fecha EXATAMENTE o total contratado — gerar cronograma
//   nunca cria nem destrói receita/custo.
//
// Módulo PURO: sem Prisma, sem fetch, sem React. Roda no motor, nas rotas e
// nos testes com os mesmos resultados.
// ============================================================================

export type TipoPagamento = 'AVISTA' | 'PARCELADO'

export type Periodicidade =
  | 'SEMANAL'
  | 'QUINZENAL'
  | 'MENSAL'
  | 'BIMESTRAL'
  | 'TRIMESTRAL'
  | 'SEMESTRAL'
  | 'ANUAL'
  | 'PERSONALIZADA'

export type InicioCronograma = 'IMEDIATA' | 'DIAS' | 'DATA_ESPECIFICA'

export type AjusteDiaUtil = 'NENHUM' | 'ULTIMO_DIA_UTIL' | 'PROXIMO_DIA_UTIL'

export type Distribuicao =
  | 'IGUAIS'
  | 'ULTIMA_AJUSTA'
  | 'PRIMEIRA_DIFERENCIADA'
  | 'ENTRADA_SALDO'
  | 'PERSONALIZADO'

export type PoliticaCambio = 'FIXO' | 'VARIAVEL' | 'CONTRATACAO' | 'RECEBIMENTO'

export type AplicaA = 'RECEITA' | 'CUSTO' | 'AMBOS'

/**
 * Condição de pagamento na forma que o motor consome. Espelha o modelo
 * CondicaoPagamento; campos ausentes assumem o padrão conservador (1 parcela
 * mensal imediata), que é exatamente o comportamento histórico do sistema.
 */
export interface CondicaoPagamentoView {
  id?: number
  codigo?: string | null
  nome?: string | null
  versao?: number | null
  ativo?: boolean | null
  vigenciaInicio?: string | Date | null
  vigenciaFim?: string | Date | null

  tipoPagamento?: TipoPagamento | null

  // entrada
  temEntrada?: boolean | null
  entradaObrigatoria?: boolean | null
  percentEntrada?: number | string | null
  valorEntradaFixo?: number | string | null

  // quantidade
  parcelasMin?: number | null
  parcelasMax?: number | null
  parcelasPadrao?: number | null

  // cronograma
  inicioCronograma?: InicioCronograma | null
  primeiraParcelaDias?: number | null
  primeiraParcelaData?: string | Date | null
  periodicidade?: Periodicidade | null
  periodicidadeDias?: number | null
  diaFixo?: number | null
  ajusteDiaUtil?: AjusteDiaUtil | null
  ajustarFimDeSemana?: boolean | null
  ajustarFeriados?: boolean | null

  // distribuição
  distribuicao?: Distribuicao | null
  primeiraParcelaPercent?: number | string | null

  // encargos e descontos (consumidos por lib/financeiro/encargos-financeiros.ts)
  multaPercent?: number | string | null
  jurosMesPercent?: number | string | null
  descontoPercent?: number | string | null
  descontoAntecipacaoPercent?: number | string | null
  descontoAVistaPercent?: number | string | null

  // câmbio
  politicaCambio?: PoliticaCambio | null
  travaCambial?: boolean | null

  // restrições
  aplicaA?: AplicaA | null
  moedasPermitidas?: string[] | null
  valorMinimo?: number | string | null
  valorMaximo?: number | string | null
  paises?: string[] | null
  modalidades?: string[] | null
  tiposProcesso?: string[] | null
}

export interface ContextoCronograma {
  /** Total contratado, na moeda do lançamento. Invariante do cronograma. */
  total: number
  /** Data de referência da contratação (base do cronograma). */
  dataBase: Date
  /** Quantidade pedida; validada contra min/max da condição. */
  nParcelas?: number | null
}

export interface ParcelaPlanejada {
  numero: number
  vencimento: Date
  valor: number
  /** true na parcela de entrada (quando a condição prevê entrada). */
  entrada: boolean
}

export interface Cronograma {
  parcelas: ParcelaPlanejada[]
  /** Quantidade efetiva (inclui a entrada quando existir). */
  nParcelas: number
  /** Valor da entrada; 0 quando não há. */
  valorEntrada: number
  /** Vencimento da primeira parcela — grava em Receita.data1 / Custo.vencimento. */
  data1: Date
  periodicidade: Periodicidade
  /** Ajustes que a condição aplicou, para auditoria/exibição. */
  observacoes: string[]
}

export interface Aplicabilidade {
  aplicavel: boolean
  motivo: string | null
}

export interface ContextoAplicabilidade {
  natureza: 'RECEITA' | 'CUSTO'
  moeda: string
  total: number
  pais?: string | null
  modalidade?: string | null
  tipoProcesso?: string | null
  emDatas?: Date
}

// ── utilidades numéricas e de data ──────────────────────────────────────────

function num(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'number') return isFinite(v) ? v : 0
  const n = parseFloat(String(v))
  return isFinite(n) ? n : 0
}

function comoData(v: string | Date | null | undefined): Date | null {
  if (!v) return null
  const d = v instanceof Date ? new Date(v) : new Date(String(v).includes('T') ? String(v) : `${String(v)}T12:00:00Z`)
  return isNaN(d.getTime()) ? null : d
}

/** Meio-dia UTC: imune a fuso e a horário de verão ao somar meses/dias. */
function aoMeioDia(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0))
}

function addDias(d: Date, n: number): Date {
  const x = new Date(d)
  x.setUTCDate(x.getUTCDate() + n)
  return x
}

/** Soma meses preservando o dia; estoura para o último dia do mês destino. */
export function addMeses(d: Date, n: number): Date {
  const dia = d.getUTCDate()
  const alvo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, 12, 0, 0))
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate()
  alvo.setUTCDate(Math.min(dia, ultimo))
  return alvo
}

function ehFimDeSemana(d: Date): boolean {
  const w = d.getUTCDay()
  return w === 0 || w === 6
}

const MESES_POR_PERIODO: Record<Periodicidade, number | null> = {
  SEMANAL: null,
  QUINZENAL: null,
  MENSAL: 1,
  BIMESTRAL: 2,
  TRIMESTRAL: 3,
  SEMESTRAL: 6,
  ANUAL: 12,
  PERSONALIZADA: null,
}

const DIAS_POR_PERIODO: Partial<Record<Periodicidade, number>> = {
  SEMANAL: 7,
  QUINZENAL: 15,
}

/** Avança `i` períodos a partir da data base, conforme a periodicidade. */
export function avancarPeriodo(base: Date, i: number, periodicidade: Periodicidade, diasPersonalizados?: number | null): Date {
  if (i === 0) return new Date(base)
  const meses = MESES_POR_PERIODO[periodicidade]
  if (meses != null) return addMeses(base, meses * i)
  if (periodicidade === 'PERSONALIZADA') {
    const dias = Math.max(1, Number(diasPersonalizados) || 30)
    return addDias(base, dias * i)
  }
  return addDias(base, (DIAS_POR_PERIODO[periodicidade] ?? 30) * i)
}

/**
 * Aplica dia fixo, ajuste de fim de semana e política de dia útil.
 * Feriados: a condição pode declarar `ajustarFeriados`, mas o sistema ainda não
 * possui calendário de feriados — o ajuste registra a intenção e não altera a
 * data. Quando o calendário existir, é o único ponto a mudar.
 */
export function ajustarVencimento(
  d: Date,
  cfg: Pick<CondicaoPagamentoView, 'diaFixo' | 'ajusteDiaUtil' | 'ajustarFimDeSemana'>,
): Date {
  let data = aoMeioDia(d)

  if (cfg.diaFixo != null && cfg.diaFixo >= 1 && cfg.diaFixo <= 31) {
    const ultimo = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth() + 1, 0)).getUTCDate()
    data = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), Math.min(cfg.diaFixo, ultimo), 12, 0, 0))
  }

  const ajuste = cfg.ajusteDiaUtil ?? 'NENHUM'
  const querAjustarFds = cfg.ajustarFimDeSemana ?? false

  if (ajuste === 'PROXIMO_DIA_UTIL' || (querAjustarFds && ajuste === 'NENHUM')) {
    while (ehFimDeSemana(data)) data = addDias(data, 1)
    return data
  }
  if (ajuste === 'ULTIMO_DIA_UTIL') {
    while (ehFimDeSemana(data)) data = addDias(data, -1)
    return data
  }
  return data
}

// ── distribuição de valores (soma exata é invariante) ───────────────────────

/**
 * Reparte `total` em `n` valores conforme a distribuição. Trabalha em centavos;
 * a diferença de arredondamento vai para a parcela que a política determina —
 * a soma SEMPRE fecha o total.
 */
export function distribuirValores(
  total: number,
  n: number,
  distribuicao: Distribuicao,
  primeiraParcelaPercent?: number | null,
): number[] {
  if (!Number.isInteger(n) || n < 1) throw new Error('n deve ser inteiro >= 1')
  if (!(total > 0)) throw new Error('total deve ser > 0')

  const centavos = Math.round(total * 100)

  if (distribuicao === 'PRIMEIRA_DIFERENCIADA' && n > 1) {
    const pct = Math.min(99, Math.max(1, Number(primeiraParcelaPercent) || 0))
    if (pct > 0) {
      const primeira = Math.round((centavos * pct) / 100)
      const resto = centavos - primeira
      const base = Math.floor(resto / (n - 1))
      const sobra = resto - base * (n - 1)
      const out = [primeira, ...Array.from({ length: n - 1 }, () => base)]
      out[out.length - 1] += sobra
      return out.map((c) => c / 100)
    }
  }

  const base = Math.floor(centavos / n)
  const sobra = centavos - base * n
  const out = Array.from({ length: n }, () => base)
  // IGUAIS e ULTIMA_AJUSTA fecham na última; ENTRADA_SALDO/PERSONALIZADO idem
  // (a entrada já foi separada antes de chamar esta função).
  out[out.length - 1] += sobra
  return out.map((c) => c / 100)
}

// ── quantidade de parcelas ──────────────────────────────────────────────────

/** Resolve quantas parcelas usar, respeitando min/max/padrão da condição. */
export function resolverQuantidade(c: CondicaoPagamentoView, pedido?: number | null): { n: number; observacao: string | null } {
  if ((c.tipoPagamento ?? 'PARCELADO') === 'AVISTA') {
    return { n: 1, observacao: pedido && pedido > 1 ? 'Condição é à vista: 1 parcela.' : null }
  }
  const min = Math.max(1, c.parcelasMin ?? 1)
  const max = Math.max(min, c.parcelasMax ?? Math.max(min, c.parcelasPadrao ?? 1))
  const padrao = Math.min(max, Math.max(min, c.parcelasPadrao ?? min))

  if (pedido == null) return { n: padrao, observacao: null }
  const n = Math.min(max, Math.max(min, Math.trunc(pedido)))
  if (n !== pedido) {
    return { n, observacao: `Quantidade ajustada para ${n} (limites da condição: ${min}–${max}).` }
  }
  return { n, observacao: null }
}

// ── data da primeira parcela ────────────────────────────────────────────────

export function dataPrimeiraParcela(c: CondicaoPagamentoView, dataBase: Date): Date {
  const base = aoMeioDia(dataBase)
  const inicio = c.inicioCronograma ?? 'IMEDIATA'
  if (inicio === 'DATA_ESPECIFICA') {
    const d = comoData(c.primeiraParcelaData)
    if (d) return aoMeioDia(d)
    return base
  }
  if (inicio === 'DIAS') return addDias(base, Math.max(0, c.primeiraParcelaDias ?? 0))
  return base
}

// ── geração do cronograma ───────────────────────────────────────────────────

/**
 * Gera o cronograma completo do lançamento a partir da condição de pagamento.
 * Quando a condição é nula, devolve o comportamento histórico do sistema
 * (1 parcela mensal com vencimento na data base) — adoção incremental sem
 * regressão para configurações ainda não migradas.
 */
export function gerarCronograma(
  condicao: CondicaoPagamentoView | null | undefined,
  ctx: ContextoCronograma,
): Cronograma {
  const total = Number(ctx.total)
  if (!(total > 0)) throw new Error('total deve ser > 0')

  const c: CondicaoPagamentoView = condicao ?? {}
  const observacoes: string[] = []

  const periodicidade = (c.periodicidade ?? 'MENSAL') as Periodicidade
  const { n: nSolicitado, observacao } = resolverQuantidade(c, ctx.nParcelas)
  if (observacao) observacoes.push(observacao)

  const primeira = ajustarVencimento(dataPrimeiraParcela(c, ctx.dataBase), c)

  // ── entrada ──
  let valorEntrada = 0
  const temEntrada = !!c.temEntrada
  if (temEntrada) {
    const fixo = num(c.valorEntradaFixo)
    const pct = num(c.percentEntrada)
    valorEntrada = fixo > 0 ? fixo : pct > 0 ? Number(((total * pct) / 100).toFixed(2)) : 0
    if (valorEntrada >= total) {
      valorEntrada = 0
      observacoes.push('Entrada ignorada: seria igual ou maior que o total contratado.')
    } else if (valorEntrada > 0) {
      observacoes.push(
        fixo > 0
          ? `Entrada fixa de ${fixo.toFixed(2)}.`
          : `Entrada de ${pct}% do total.`,
      )
    }
  }

  const parcelas: ParcelaPlanejada[] = []

  if (valorEntrada > 0) {
    // A entrada é a parcela 1; o saldo é distribuído nas seguintes.
    const saldo = Number((total - valorEntrada).toFixed(2))
    const nSaldo = Math.max(1, nSolicitado - 1)
    const valores = distribuirValores(saldo, nSaldo, c.distribuicao ?? 'ULTIMA_AJUSTA', num(c.primeiraParcelaPercent))

    parcelas.push({ numero: 1, vencimento: primeira, valor: valorEntrada, entrada: true })
    for (let i = 0; i < nSaldo; i++) {
      const bruta = avancarPeriodo(primeira, i + 1, periodicidade, c.periodicidadeDias)
      parcelas.push({
        numero: i + 2,
        vencimento: ajustarVencimento(bruta, c),
        valor: valores[i],
        entrada: false,
      })
    }
  } else {
    const valores = distribuirValores(total, nSolicitado, c.distribuicao ?? 'ULTIMA_AJUSTA', num(c.primeiraParcelaPercent))
    for (let i = 0; i < nSolicitado; i++) {
      const bruta = avancarPeriodo(primeira, i, periodicidade, c.periodicidadeDias)
      parcelas.push({
        numero: i + 1,
        vencimento: ajustarVencimento(bruta, c),
        valor: valores[i],
        entrada: false,
      })
    }
  }

  // Guarda dura: o cronograma nunca pode alterar o total contratado.
  const soma = Number(parcelas.reduce((s, p) => s + p.valor, 0).toFixed(2))
  if (Math.abs(soma - Number(total.toFixed(2))) > 0.004) {
    throw new Error(`Falha de arredondamento no cronograma: soma ${soma} ≠ total ${total}`)
  }

  return {
    parcelas,
    nParcelas: parcelas.length,
    valorEntrada,
    data1: parcelas[0].vencimento,
    periodicidade,
    observacoes,
  }
}

// ── aplicabilidade / restrições ─────────────────────────────────────────────

function listaContem(lista: string[] | null | undefined, valor: string | null | undefined): boolean {
  if (!lista || lista.length === 0) return true // sem restrição declarada
  if (!valor) return false
  return lista.map((x) => x.toLowerCase()).includes(String(valor).toLowerCase())
}

/**
 * A condição vale para este lançamento? Restrição não declarada é permissiva;
 * declarada e não atendida bloqueia — e o motivo explica qual.
 */
export function condicaoAplicavel(c: CondicaoPagamentoView, ctx: ContextoAplicabilidade): Aplicabilidade {
  const nao = (motivo: string): Aplicabilidade => ({ aplicavel: false, motivo })

  if (c.ativo === false) return nao('Condição de pagamento inativa.')

  const agora = ctx.emDatas ?? new Date()
  const ini = comoData(c.vigenciaInicio)
  const fim = comoData(c.vigenciaFim)
  if (ini && agora.getTime() < ini.getTime()) return nao('Condição ainda não vigente.')
  if (fim && agora.getTime() > fim.getTime()) return nao('Condição fora de vigência.')

  const aplicaA = c.aplicaA ?? 'AMBOS'
  if (aplicaA !== 'AMBOS' && aplicaA !== ctx.natureza) {
    return nao(`Condição aplicável somente a ${aplicaA === 'RECEITA' ? 'receitas' : 'custos'}.`)
  }

  if (!listaContem(c.moedasPermitidas, ctx.moeda)) return nao(`Moeda ${ctx.moeda} não permitida nesta condição.`)

  const min = num(c.valorMinimo)
  const max = num(c.valorMaximo)
  if (min > 0 && ctx.total < min) return nao(`Valor abaixo do mínimo da condição (${min}).`)
  if (max > 0 && ctx.total > max) return nao(`Valor acima do máximo da condição (${max}).`)

  if (!listaContem(c.paises, ctx.pais)) return nao('País não permitido nesta condição.')
  if (!listaContem(c.modalidades, ctx.modalidade)) return nao('Modalidade não permitida nesta condição.')
  if (!listaContem(c.tiposProcesso, ctx.tipoProcesso)) return nao('Tipo de processo não permitido nesta condição.')

  return { aplicavel: true, motivo: null }
}

/**
 * Uma condição já USADA nunca é editada: cria-se a versão seguinte.
 * Devolve o payload da nova versão a partir da atual + alterações.
 */
export function proximaVersao<T extends CondicaoPagamentoView>(atual: T, alteracoes: Partial<T>): T {
  return {
    ...atual,
    ...alteracoes,
    id: undefined,
    codigo: atual.codigo ?? null,
    versao: (atual.versao ?? 1) + 1,
    vigenciaInicio: alteracoes.vigenciaInicio ?? new Date(),
    vigenciaFim: null,
    ativo: true,
  } as T
}

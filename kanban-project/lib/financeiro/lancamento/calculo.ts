// lib/financeiro/lancamento/calculo.ts
// ============================================================================
// NÚCLEO PURO do lançamento financeiro (Custo e Receita): total, parcelamento e
// validação. Sem React, sem fetch, sem Prisma — é o que os testes exercitam e o
// que a tela consome. A tela NÃO recalcula nada por conta própria.
//
// Regra de dinheiro deste projeto: nunca arredondar antes de multiplicar, e a
// soma das parcelas é uma PARTIÇÃO EXATA do total — a última parcela absorve o
// resíduo dos centavos. O motor recusa cronograma cuja soma ≠ valor da obrigação.
// ============================================================================

export const centavos = (v: number): number => Math.round((Number(v) || 0) * 100) / 100

export interface EntradaTotal {
  quantidade: number
  valorUnitario: number
  desconto?: number
  acrescimo?: number
}

export interface Total {
  subtotal: number
  desconto: number
  acrescimo: number
  total: number
}

/** total = quantidade × valor unitário − desconto + acréscimos. */
export function calcularTotal(e: EntradaTotal): Total {
  const qtd = Number(e.quantidade) || 0
  const unit = Number(e.valorUnitario) || 0
  const subtotal = centavos(qtd * unit)
  const desconto = centavos(Math.max(0, Number(e.desconto) || 0))
  const acrescimo = centavos(Math.max(0, Number(e.acrescimo) || 0))
  return { subtotal, desconto, acrescimo, total: centavos(subtotal - desconto + acrescimo) }
}

export interface Parcela {
  numero: number
  vencimento: string // ISO yyyy-mm-dd
  valor: number
}

export interface EntradaParcelas {
  total: number
  nParcelas: number
  primeiroVencimento: string // yyyy-mm-dd
  intervaloDias?: number // quando ausente, o passo é MENSAL (mesmo dia do mês)
}

const iso = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Data local a partir de `yyyy-mm-dd`, sem passar por UTC (que desloca o dia). */
export function dataLocal(yyyymmdd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(yyyymmdd ?? '').trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return isNaN(d.getTime()) ? null : d
}

/**
 * Avança `n` meses preservando o dia quando possível. 31/01 + 1 mês = 28/02 (ou
 * 29 em bissexto) — nunca "escorrega" para março, que é o bug clássico de somar
 * mês em JavaScript.
 */
function somarMeses(base: Date, n: number): Date {
  const dia = base.getDate()
  const d = new Date(base.getFullYear(), base.getMonth() + n, 1)
  const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(dia, ultimoDia))
  return d
}

/**
 * Gera o cronograma. A soma das parcelas é EXATAMENTE o total: divide-se por
 * baixo em centavos e o resíduo vai na ÚLTIMA parcela.
 */
export function gerarParcelas(e: EntradaParcelas): Parcela[] {
  const n = Math.max(1, Math.floor(Number(e.nParcelas) || 1))
  const base = dataLocal(e.primeiroVencimento)
  if (!base) return []
  const totalCent = Math.round(centavos(e.total) * 100)
  if (totalCent <= 0) return []

  const passo = Number(e.intervaloDias) > 0 ? Math.floor(Number(e.intervaloDias)) : null
  const porParcela = Math.floor(totalCent / n)
  const resto = totalCent - porParcela * n

  const parcelas: Parcela[] = []
  for (let i = 0; i < n; i++) {
    const venc = passo ? new Date(base.getFullYear(), base.getMonth(), base.getDate() + passo * i) : somarMeses(base, i)
    const cent = i === n - 1 ? porParcela + resto : porParcela
    parcelas.push({ numero: i + 1, vencimento: iso(venc), valor: centavos(cent / 100) })
  }
  return parcelas
}

/** A soma das parcelas bate com o total? Invariante que o motor também exige. */
export function parcelasSomamTotal(parcelas: Parcela[], total: number): boolean {
  const soma = centavos(parcelas.reduce((s, p) => s + (Number(p.valor) || 0), 0))
  return Math.abs(soma - centavos(total)) < 0.005
}

// ─────────────────────────────────────────────────────────────── validação ───

export type Severidade = 'erro' | 'aviso'

export interface Problema {
  campo: string
  severidade: Severidade
  mensagem: string
}

export const MOEDAS_ACEITAS = ['BRL', 'EUR', 'USD'] as const

export interface EntradaValidacao {
  natureza: 'CUSTO' | 'RECEITA'
  itemId: number | null
  itemAtivo?: boolean
  quantidade: number
  valorUnitario: number
  moeda: string
  desconto: number
  acrescimo: number
  nParcelas: number
  primeiroVencimento: string
  fornecedorId: number | null
  fornecedorObrigatorio?: boolean
  temConfig?: boolean
  pendenciasDaConfig?: string[]
  valorDaTabela?: number | null
  parcelas?: Parcela[]
  duplicidadeProvavel?: boolean
}

/**
 * Todos os problemas do formulário, por CAMPO. `erro` bloqueia o salvar; `aviso`
 * informa e deixa seguir. Nunca devolve mensagem genérica: cada item diz o campo
 * e a correção.
 */
export function validarLancamento(e: EntradaValidacao): Problema[] {
  const p: Problema[] = []
  const erro = (campo: string, mensagem: string) => p.push({ campo, severidade: 'erro', mensagem })
  const aviso = (campo: string, mensagem: string) => p.push({ campo, severidade: 'aviso', mensagem })

  if (!e.itemId) erro('item', 'Escolha o item do catálogo que originou este lançamento.')
  else if (e.itemAtivo === false) erro('item', 'Este item está inativo no catálogo e não pode ser lançado.')

  const qtd = Number(e.quantidade)
  if (!isFinite(qtd) || qtd <= 0) erro('quantidade', 'A quantidade precisa ser maior que zero.')
  else if (!Number.isInteger(qtd * 1000)) erro('quantidade', 'Quantidade com precisão excessiva — use até 3 casas decimais.')

  const unit = Number(e.valorUnitario)
  if (!isFinite(unit) || unit <= 0) erro('valorUnitario', 'Informe o valor unitário — precisa ser maior que zero.')

  if (!MOEDAS_ACEITAS.includes(e.moeda as (typeof MOEDAS_ACEITAS)[number])) {
    erro('moeda', `Moeda inválida. Use ${MOEDAS_ACEITAS.join(', ')}.`)
  }

  const desconto = Number(e.desconto) || 0
  const acrescimo = Number(e.acrescimo) || 0
  if (desconto < 0) erro('desconto', 'O desconto não pode ser negativo.')
  if (acrescimo < 0) erro('acrescimo', 'O acréscimo não pode ser negativo.')

  const { subtotal, total } = calcularTotal({ quantidade: qtd, valorUnitario: unit, desconto, acrescimo })
  if (desconto > subtotal) erro('desconto', 'O desconto não pode ser maior que o subtotal.')
  if (total <= 0 && !p.some((x) => x.campo === 'valorUnitario')) erro('desconto', 'O total ficou zerado ou negativo — revise desconto e acréscimos.')

  const n = Math.floor(Number(e.nParcelas) || 1)
  if (n < 1) erro('nParcelas', 'O número de parcelas precisa ser pelo menos 1.')
  else if (n > 120) erro('nParcelas', 'Máximo de 120 parcelas.')
  else if (n > 1 && total > 0 && total / n < 0.01) erro('nParcelas', 'Parcelas abaixo de um centavo — reduza o número de parcelas.')

  if (n > 1 || e.primeiroVencimento) {
    const d = dataLocal(e.primeiroVencimento)
    if (!d) erro('primeiroVencimento', n > 1 ? 'Informe o vencimento da primeira parcela.' : 'Data de vencimento inválida.')
  }

  if (e.fornecedorObrigatorio && !e.fornecedorId) {
    erro('fornecedor', 'Este custo exige fornecedor — selecione quem será pago.')
  }

  if (e.parcelas?.length && !parcelasSomamTotal(e.parcelas, total)) {
    erro('parcelas', 'A soma das parcelas não bate com o total do lançamento.')
  }

  // ── avisos (não bloqueiam) ──
  if (e.itemId && e.temConfig === false) {
    aviso('item', 'Item sem Configuração Financeira — valor, conta contábil e classificação não serão preenchidos.')
  }
  for (const pend of e.pendenciasDaConfig ?? []) aviso('item', pend)

  if (e.valorDaTabela != null && e.valorDaTabela > 0 && isFinite(unit) && unit > 0) {
    const dif = Math.abs(unit - e.valorDaTabela)
    if (dif >= 0.01) {
      aviso('valorUnitario', `Valor diferente da Tabela de Valores (${e.valorDaTabela.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}).`)
    }
  }

  const venc = dataLocal(e.primeiroVencimento)
  if (venc) {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
    if (venc < hoje) aviso('primeiroVencimento', 'O vencimento já passou — o lançamento nascerá vencido.')
  }

  if (e.duplicidadeProvavel) {
    aviso('item', 'Já existe lançamento parecido neste processo — confirme que não é duplicidade.')
  }

  return p
}

/** Há erro impeditivo? É o que trava o botão principal. */
export const temErro = (problemas: Problema[]): boolean => problemas.some((x) => x.severidade === 'erro')

/** Problemas de um campo específico, para exibir junto do input. */
export const problemasDoCampo = (problemas: Problema[], campo: string): Problema[] =>
  problemas.filter((x) => x.campo === campo)

// lib/financeiro/encargos-financeiros.ts
// ============================================================================
// MOTOR DE ENCARGOS E DESCONTOS — fonte única.
//
// A Condição de Pagamento declara multa, juros, descontos e acréscimos; este
// módulo diz QUANTO e QUANDO cada regra incide, com memória de cálculo.
//
// MOMENTO DE APLICAÇÃO — definido e testado:
//   GERACAO      → desconto à vista (1 parcela) e desconto comercial. Reduz o
//                  valor cobrado no ato da criação do lançamento.
//   VENCIMENTO   → nada é cobrado; é o marco a partir do qual conta atraso.
//   PAGAMENTO    → multa (uma vez) + juros pro-rata dos dias em atraso.
//   ANTECIPACAO  → desconto pro-rata dos dias antecipados.
//   RENEGOCIACAO → congela multa+juros do atraso corrente na nova base.
//
// INVARIANTE: encargos NUNCA alteram o valor contratado gravado no lançamento.
// Eles produzem um valor A COBRAR no momento do evento, com memória — o
// contratado segue sendo o do FinanceRuleEngine.
//
// Módulo PURO: sem Prisma, sem fetch, sem React.
// ============================================================================

export type MomentoAplicacao = 'GERACAO' | 'VENCIMENTO' | 'PAGAMENTO' | 'ANTECIPACAO' | 'RENEGOCIACAO'

/** Espelha os campos de encargo da CondicaoPagamento. */
export interface RegrasEncargos {
  multaPercent?: number | string | null
  jurosMesPercent?: number | string | null
  descontoPercent?: number | string | null
  descontoAntecipacaoPercent?: number | string | null
  descontoAVistaPercent?: number | string | null
}

export interface LinhaEncargo {
  tipo: 'MULTA' | 'JUROS' | 'DESCONTO_AVISTA' | 'DESCONTO_COMERCIAL' | 'DESCONTO_ANTECIPACAO'
  rotulo: string
  base: number
  percentual: number
  /** Positivo = acréscimo; negativo = desconto. */
  valor: number
  formula: string
}

export interface ResultadoEncargos {
  momento: MomentoAplicacao
  base: number
  acrescimos: number
  descontos: number
  /** base + acréscimos − descontos. Nunca negativo. */
  valorACobrar: number
  diasAtraso: number
  diasAntecipacao: number
  linhas: LinhaEncargo[]
  memoria: string[]
}

export interface ContextoEncargos {
  regras: RegrasEncargos
  /** Valor sobre o qual os encargos incidem (parcela ou total). */
  base: number
  /** Vencimento da parcela; ausente = sem atraso possível. */
  vencimento?: string | Date | null
  /** Data do evento (pagamento/antecipação). Padrão: agora. */
  dataEvento?: Date
  momento: MomentoAplicacao
  /** Usado só em GERACAO, para decidir o desconto à vista. */
  nParcelas?: number
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

function aoDia(v: string | Date | null | undefined): Date | null {
  if (!v) return null
  const d = v instanceof Date ? new Date(v) : new Date(String(v).includes('T') ? String(v) : `${String(v)}T00:00:00`)
  if (isNaN(d.getTime())) return null
  d.setHours(0, 0, 0, 0)
  return d
}

/** Dias inteiros entre duas datas (b − a). Negativo quando b < a. */
export function diferencaEmDias(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

/**
 * Calcula os encargos de um evento financeiro.
 * Determinístico e testável: mesmos insumos → mesmo resultado.
 */
export function calcularEncargos(ctx: ContextoEncargos): ResultadoEncargos {
  const base = cent(num(ctx.base))
  const r = ctx.regras ?? {}
  const linhas: LinhaEncargo[] = []
  const memoria: string[] = [`Base: ${base.toFixed(2)} · momento: ${ctx.momento}`]

  const venc = aoDia(ctx.vencimento)
  const evento = aoDia(ctx.dataEvento ?? new Date())!
  const delta = venc ? diferencaEmDias(venc, evento) : 0
  const diasAtraso = delta > 0 ? delta : 0
  const diasAntecipacao = delta < 0 ? -delta : 0

  const add = (l: LinhaEncargo) => {
    linhas.push(l)
    memoria.push(`${l.rotulo}: ${l.formula} = ${l.valor >= 0 ? '+' : ''}${l.valor.toFixed(2)}`)
  }

  if (ctx.momento === 'GERACAO') {
    // Desconto à vista: só quando o cronograma é de parcela única.
    const avista = num(r.descontoAVistaPercent)
    if (avista > 0 && (ctx.nParcelas ?? 1) === 1) {
      const v = -cent((base * avista) / 100)
      add({ tipo: 'DESCONTO_AVISTA', rotulo: 'Desconto à vista', base, percentual: avista, valor: v, formula: `${base.toFixed(2)} × ${avista}%` })
    }
    // Desconto comercial: incide sempre que declarado.
    const com = num(r.descontoPercent)
    if (com > 0) {
      const v = -cent((base * com) / 100)
      add({ tipo: 'DESCONTO_COMERCIAL', rotulo: 'Desconto comercial', base, percentual: com, valor: v, formula: `${base.toFixed(2)} × ${com}%` })
    }
  }

  if (ctx.momento === 'PAGAMENTO' || ctx.momento === 'RENEGOCIACAO') {
    if (diasAtraso > 0) {
      const multa = num(r.multaPercent)
      if (multa > 0) {
        const v = cent((base * multa) / 100)
        add({ tipo: 'MULTA', rotulo: 'Multa por atraso', base, percentual: multa, valor: v, formula: `${base.toFixed(2)} × ${multa}% (uma vez)` })
      }
      const juros = num(r.jurosMesPercent)
      if (juros > 0) {
        const v = cent((base * juros * (diasAtraso / 30)) / 100)
        add({ tipo: 'JUROS', rotulo: 'Juros de mora', base, percentual: juros, valor: v, formula: `${base.toFixed(2)} × ${juros}%/mês × ${diasAtraso}/30 dias` })
      }
    } else {
      memoria.push('Sem atraso: multa e juros não incidem.')
    }
  }

  if (ctx.momento === 'ANTECIPACAO' && diasAntecipacao > 0) {
    const ant = num(r.descontoAntecipacaoPercent)
    if (ant > 0) {
      const v = -cent((base * ant * (diasAntecipacao / 30)) / 100)
      add({ tipo: 'DESCONTO_ANTECIPACAO', rotulo: 'Desconto por antecipação', base, percentual: ant, valor: v, formula: `${base.toFixed(2)} × ${ant}%/mês × ${diasAntecipacao}/30 dias` })
    }
  }

  const acrescimos = cent(linhas.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0))
  const descontos = cent(Math.abs(linhas.filter((l) => l.valor < 0).reduce((s, l) => s + l.valor, 0)))
  const valorACobrar = Math.max(0, cent(base + acrescimos - descontos))

  memoria.push(`Acréscimos: ${acrescimos.toFixed(2)} · Descontos: ${descontos.toFixed(2)}`)
  memoria.push(`Valor a cobrar: ${valorACobrar.toFixed(2)}`)

  return { momento: ctx.momento, base, acrescimos, descontos, valorACobrar, diasAtraso, diasAntecipacao, linhas, memoria }
}

// lib/financeiro/dominio/obrigacao-economica.ts
// ============================================================================
// AGGREGATE ROOT: ObrigacaoEconomica (Motor Financeiro V3 · Fase 1). Regras PURAS
// do domínio: natureza → direção, máquina de estados, validação de distribuição
// econômica (independe do pagador). Ver spec §5.1, §5.7, §7. Sem Prisma.
// ============================================================================

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export type Natureza =
  | 'RECEITA' | 'CUSTO' | 'RECEITA_EXTRA' | 'LANCAMENTO_EXTRA' | 'DESCONTO' | 'CREDITO'
  | 'REEMBOLSO' | 'JUROS' | 'MULTA' | 'AJUSTE' | 'ESTORNO' | 'RENEGOCIACAO' | 'OUTRO'

export type Direcao = 'A_RECEBER' | 'A_PAGAR'
export type StatusObrigacao = 'RASCUNHO' | 'ATIVO' | 'SUSPENSO' | 'LIQUIDADO' | 'CANCELADO'

const A_PAGAR: Natureza[] = ['CUSTO', 'REEMBOLSO']

/** Direção derivada da natureza (a pagar só custo/reembolso; o resto a receber). */
export function direcaoDe(natureza: Natureza): Direcao {
  return A_PAGAR.includes(natureza) ? 'A_PAGAR' : 'A_RECEBER'
}

export function aReceber(natureza: Natureza): boolean {
  return direcaoDe(natureza) === 'A_RECEBER'
}

// ── Máquina de estados do contrato ──────────────────────────────────────────
const TRANSICOES: Record<StatusObrigacao, StatusObrigacao[]> = {
  RASCUNHO: ['ATIVO', 'CANCELADO'],
  ATIVO: ['SUSPENSO', 'LIQUIDADO', 'CANCELADO'],
  SUSPENSO: ['ATIVO', 'CANCELADO'],
  LIQUIDADO: [],
  CANCELADO: [],
}

export function podeTransicionar(de: StatusObrigacao, para: StatusObrigacao): boolean {
  return TRANSICOES[de]?.includes(para) ?? false
}

/** Aplica uma transição; retorna o novo status ou erro (não muta). */
export function transicionar(de: StatusObrigacao, para: StatusObrigacao): { ok: boolean; status: StatusObrigacao; erro?: string } {
  if (de === para) return { ok: true, status: de }
  if (!podeTransicionar(de, para)) return { ok: false, status: de, erro: `Transição inválida ${de} → ${para}.` }
  return { ok: true, status: para }
}

// ── Distribuição econômica (independe do pagador) ───────────────────────────
export type ModoDistribuicao = 'SEM_DIVISAO' | 'IGUAL' | 'PERCENTUAL' | 'VALOR' | 'GRUPO' | 'PERSONALIZADA'

export interface ParticipanteEntrada {
  pessoaId: number
  incluido?: boolean
  percentual?: number | null
  valor?: number | null
}
export interface CotaResolvida { pessoaId: number; valor: number; percentual: number }
export interface ResultadoDistribuicao { ok: boolean; erros: string[]; cotas: CotaResolvida[] }

/**
 * Resolve a distribuição em cotas que SOMAM EXATAMENTE o total (centavos na
 * última cota incluída). A exclusão de participantes é MANUAL (nunca por idade).
 */
export function resolverDistribuicao(
  total: number, modo: ModoDistribuicao, participantes: ParticipanteEntrada[],
): ResultadoDistribuicao {
  const erros: string[] = []
  const t = cent(total)
  const incluidos = participantes.filter((p) => p.incluido !== false)
  if (modo === 'SEM_DIVISAO') {
    return { ok: true, erros, cotas: [] }
  }
  if (incluidos.length === 0) return { ok: false, erros: ['Nenhum participante incluído.'], cotas: [] }
  const totalCent = Math.round(t * 100)

  let base: number[] = []
  if (modo === 'IGUAL' || modo === 'GRUPO') {
    const q = Math.floor(totalCent / incluidos.length)
    base = incluidos.map(() => q)
  } else if (modo === 'PERCENTUAL') {
    const somaPct = incluidos.reduce((s, p) => s + Number(p.percentual ?? 0), 0)
    if (Math.abs(somaPct - 100) > 0.01) erros.push(`Percentuais somam ${somaPct}%, deveria ser 100%.`)
    base = incluidos.map((p) => Math.round((totalCent * Number(p.percentual ?? 0)) / 100))
  } else if (modo === 'VALOR') {
    const somaVal = incluidos.reduce((s, p) => s + cent(Number(p.valor ?? 0)), 0)
    if (Math.abs(somaVal - t) > 0.01) erros.push(`Valores somam ${somaVal}, deveria ser ${t}.`)
    base = incluidos.map((p) => Math.round(cent(Number(p.valor ?? 0)) * 100))
  } else {
    // PERSONALIZADA: percentual ou valor, o que houver
    base = incluidos.map((p) => p.valor != null ? Math.round(cent(Number(p.valor)) * 100) : Math.round((totalCent * Number(p.percentual ?? 0)) / 100))
  }

  // centavos residuais absorvidos pela última cota incluída (invariante soma=total)
  const somaBase = base.reduce((s, v) => s + v, 0)
  const resto = totalCent - somaBase
  if (base.length) base[base.length - 1] += resto

  const cotas: CotaResolvida[] = incluidos.map((p, i) => ({
    pessoaId: p.pessoaId, valor: cent(base[i] / 100), percentual: cent((base[i] / totalCent) * 100),
  }))
  const somaFinal = cotas.reduce((s, c) => s + c.valor, 0)
  if (Math.abs(somaFinal - t) > 0.005) erros.push(`Soma das cotas (${cent(somaFinal)}) ≠ total (${t}).`)
  return { ok: erros.length === 0, erros, cotas }
}

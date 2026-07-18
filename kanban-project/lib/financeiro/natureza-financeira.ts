// src/lib/financeiro/natureza-financeira.ts
// ============================================================================
// PREÇO-FONTE-ÚNICA — regras PURAS da Natureza Financeira (§1) e compatibilidade
// de natureza de PREÇO/REGRA contra a Configuração Financeira (§2/§4).
//
// Sem Prisma, sem I/O — testável offline (scripts/preco-fonte-unica.test.ts).
//
// Vocabulário (§1 — DUAS naturezas DISTINTAS, mapeadas por UM serviço central):
//   • PREÇO (Tabela de Preços)      → PrecoNatureza:      PRECO_CUSTO | PRECO_VENDA
//   • LANÇAMENTO (FinanceRuleEngine)→ LancamentoNatureza: CUSTO      | RECEITA
//   Mapeamento explícito e único: PRECO_CUSTO→CUSTO, PRECO_VENDA→RECEITA.
//   O enum Prisma NaturezaPreco{CUSTO,RECEITA,VENDA} guarda a natureza de PREÇO
//   (RECEITA é apelido LEGADO de VENDA no lado do PREÇO — nunca do lançamento).
//   NÃO usar "VENDA=RECEITA" implícito: passar SEMPRE por este módulo.
//   • Configuração Financeira → NaturezaFinanceira (SOMENTE_CUSTO | SOMENTE_RECEITA
//     | CUSTO_E_RECEITA): o QUE o item pode gerar.
// ============================================================================

export type NaturezaFinanceira = 'SOMENTE_CUSTO' | 'SOMENTE_RECEITA' | 'CUSTO_E_RECEITA'

/** Natureza de PREÇO canônica na Tabela de Preços. RECEITA(enum legado) ≡ VENDA. */
export type NaturezaPrecoCanonica = 'CUSTO' | 'VENDA'

/** Valores possíveis do enum Prisma NaturezaPreco (inclui o legado RECEITA). */
export type NaturezaPrecoRaw = 'CUSTO' | 'RECEITA' | 'VENDA'

// ── §1 SERVIÇO DE DOMÍNIO ÚNICO: natureza de PREÇO ↔ natureza de LANÇAMENTO ──

/** Natureza cadastrada na TABELA DE PREÇOS (o QUANTO custa/vende). */
export type PrecoNatureza = 'PRECO_CUSTO' | 'PRECO_VENDA'
/** Natureza do LANÇAMENTO financeiro criado pelo FinanceRuleEngine. */
export type LancamentoNatureza = 'CUSTO' | 'RECEITA'

/** enum Prisma NaturezaPreco → natureza de PREÇO de domínio (CUSTO→PRECO_CUSTO; VENDA|RECEITA→PRECO_VENDA). */
export function precoNaturezaDeEnum(n: NaturezaPrecoRaw | null | undefined): PrecoNatureza | null {
  if (n === 'CUSTO') return 'PRECO_CUSTO'
  if (n === 'VENDA' || n === 'RECEITA') return 'PRECO_VENDA'
  return null
}

/** ÚNICO ponto de mapeamento preço→lançamento: PRECO_CUSTO→CUSTO, PRECO_VENDA→RECEITA. */
export function mapPrecoParaLancamento(p: PrecoNatureza): LancamentoNatureza {
  return p === 'PRECO_CUSTO' ? 'CUSTO' : 'RECEITA'
}

/** Conveniência: enum de preço (CUSTO/VENDA/RECEITA) → natureza de LANÇAMENTO (CUSTO/RECEITA). */
export function lancamentoDeEnumPreco(n: NaturezaPrecoRaw | null | undefined): LancamentoNatureza | null {
  const p = precoNaturezaDeEnum(n)
  return p ? mapPrecoParaLancamento(p) : null
}

/**
 * Forma canônica da natureza de PREÇO (não do lançamento): CUSTO | VENDA.
 * RECEITA(legado) → VENDA. Usada para COMPARAR preços entre si na Tabela de Preços.
 * NÃO representa o lançamento — para o lançamento use mapPrecoParaLancamento().
 */
export function canonicalNaturezaPreco(n: NaturezaPrecoRaw | null | undefined): NaturezaPrecoCanonica | null {
  if (n === 'CUSTO') return 'CUSTO'
  if (n === 'VENDA' || n === 'RECEITA') return 'VENDA'
  return null
}

/** Subset da Configuração Financeira necessário à derivação (desacoplado do Prisma). */
export interface ConfigNaturezaLike {
  naturezaFin?: NaturezaFinanceira | null
  possuiCusto?: boolean | null
  possuiReceita?: boolean | null
  valorCustoPadrao?: number | null
  valorReceitaPadrao?: number | null
}

/**
 * Deriva a NaturezaFinanceira canônica de uma Configuração Financeira.
 * Prioriza o campo explícito `naturezaFin`; caindo nas flags/valores legado
 * (possuiCusto/possuiReceita + valorCustoPadrao/valorReceitaPadrao) — §10.
 * Retorna null quando não há sinal algum (item sem custo nem receita).
 */
export function deriveNaturezaFinanceira(c: ConfigNaturezaLike): NaturezaFinanceira | null {
  if (c.naturezaFin) return c.naturezaFin
  const custo = !!c.possuiCusto || (c.valorCustoPadrao != null && c.valorCustoPadrao > 0)
  const receita = !!c.possuiReceita || (c.valorReceitaPadrao != null && c.valorReceitaPadrao > 0)
  if (custo && receita) return 'CUSTO_E_RECEITA'
  if (custo) return 'SOMENTE_CUSTO'
  if (receita) return 'SOMENTE_RECEITA'
  return null
}

/** A NaturezaFinanceira admite preços/lançamentos de CUSTO? */
export function admiteCusto(n: NaturezaFinanceira | null | undefined): boolean {
  return n === 'SOMENTE_CUSTO' || n === 'CUSTO_E_RECEITA'
}

/** A NaturezaFinanceira admite preços/lançamentos de VENDA (receita)? */
export function admiteVenda(n: NaturezaFinanceira | null | undefined): boolean {
  return n === 'SOMENTE_RECEITA' || n === 'CUSTO_E_RECEITA'
}

export interface CompatResultado {
  ok: boolean
  motivo?: string
}

/**
 * Valida uma natureza de PREÇO (Tabela de Preços) contra a Config (§2).
 * Item SOMENTE_CUSTO só aceita CUSTO; SOMENTE_RECEITA só aceita VENDA;
 * CUSTO_E_RECEITA aceita as duas. Config sem natureza definida (transição) é
 * permissiva por padrão, salvo `estrito`.
 */
export function validarNaturezaPreco(
  naturezaConfig: NaturezaFinanceira | null | undefined,
  naturezaPreco: NaturezaPrecoRaw,
  opts: { estrito?: boolean } = {},
): CompatResultado {
  const canon = canonicalNaturezaPreco(naturezaPreco)
  if (canon == null) return { ok: false, motivo: `Natureza de preço inválida: "${naturezaPreco}"` }
  if (naturezaConfig == null) {
    return opts.estrito
      ? { ok: false, motivo: 'Configuração Financeira sem natureza definida — defina SOMENTE_CUSTO / SOMENTE_RECEITA / CUSTO_E_RECEITA antes de cadastrar preços' }
      : { ok: true }
  }
  if (canon === 'CUSTO' && !admiteCusto(naturezaConfig)) {
    return { ok: false, motivo: `Item ${naturezaConfig} não aceita Preço de Custo` }
  }
  if (canon === 'VENDA' && !admiteVenda(naturezaConfig)) {
    return { ok: false, motivo: `Item ${naturezaConfig} não aceita Preço de Venda` }
  }
  return { ok: true }
}

/** entryType/naturezaRegra "cost|revenue|custo|venda|receita" → natureza canônica. */
export function naturezaRegraCanonica(v: string | null | undefined): NaturezaPrecoCanonica | null {
  if (!v) return null
  const s = v.toLowerCase()
  if (s === 'cost' || s === 'custo') return 'CUSTO'
  if (s === 'revenue' || s === 'venda' || s === 'receita') return 'VENDA'
  return null
}

/**
 * Valida a natureza que uma Regra Financeira quer GERAR contra a Config (§4).
 * Não permite gerar VENDA em SOMENTE_CUSTO nem CUSTO em SOMENTE_RECEITA.
 */
export function validarNaturezaRegra(
  naturezaConfig: NaturezaFinanceira | null | undefined,
  geraCusto: boolean,
  geraVenda: boolean,
): CompatResultado {
  if (!geraCusto && !geraVenda) return { ok: false, motivo: 'Regra não gera custo nem venda' }
  if (naturezaConfig == null) return { ok: true } // transição: permissivo
  if (geraCusto && !admiteCusto(naturezaConfig)) {
    return { ok: false, motivo: `Regra não pode gerar CUSTO em item ${naturezaConfig}` }
  }
  if (geraVenda && !admiteVenda(naturezaConfig)) {
    return { ok: false, motivo: `Regra não pode gerar VENDA em item ${naturezaConfig}` }
  }
  return { ok: true }
}

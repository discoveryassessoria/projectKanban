// src/lib/financeiro/conflito-preco.ts
// ============================================================================
// PREÇO-FONTE-ÚNICA — detecção PURA de conflito/duplicidade de preços (§3).
//
// Duas regras de preço ATIVAS conflitam quando coincidem TODAS as dimensões
// discriminantes E se sobrepõem em faixa de quantidade E em vigência:
//   • mesma Configuração Financeira;
//   • mesma natureza (canônica: CUSTO | VENDA — RECEITA≡VENDA);
//   • mesmo contexto (tipoProcesso, fase, região, modalidade, processo, itemCatalogo);
//   • mesmo fornecedor (quando aplicável);
//   • faixa de quantidade sobreposta;
//   • vigências sobrepostas;
//   • mesma prioridade.
// Diferir em QUALQUER dimensão discriminante = contextos distintos = SEM conflito.
//
// Sem Prisma, sem I/O. Espelha a barreira de banco (uniques R16 + EXCLUDE GiST R17),
// mas devolve mensagem clara ANTES do insert (a spec exige validação no backend).
// ============================================================================

import { canonicalNaturezaPreco, type NaturezaPrecoRaw } from './natureza-financeira'

/** Subset de TabelaValor relevante à detecção de conflito. */
export interface PrecoRegistro {
  id?: number | null
  configuracaoFinanceiraItemId?: number | null
  natureza?: NaturezaPrecoRaw | null
  // contexto discriminante
  processoTipoId?: string | null
  faseKey?: string | null
  regiao?: string | null
  modalidadeId?: number | null
  processoId?: number | null
  itemCatalogoId?: number | null
  fornecedorId?: number | null
  // faixa de quantidade (null = aberto)
  quantidadeMinima?: number | null
  quantidadeMaxima?: number | null
  // vigência 'YYYY-MM-DD' (null = aberto)
  vigenciaInicio?: string | null
  vigenciaFim?: string | null
  prioridade?: number | null
  // estado
  arquivado?: boolean | null
  legadoPendente?: boolean | null
}

function ativo(p: PrecoRegistro): boolean {
  return !p.arquivado && !p.legadoPendente
}

/** Intervalos [aMin,aMax] e [bMin,bMax] com nulls abertos se sobrepõem? */
function faixaSobrepoe(aMin: number | null | undefined, aMax: number | null | undefined, bMin: number | null | undefined, bMax: number | null | undefined): boolean {
  const lo = (v: number | null | undefined) => (v == null ? -Infinity : v)
  const hi = (v: number | null | undefined) => (v == null ? Infinity : v)
  return lo(aMin) <= hi(bMax) && lo(bMin) <= hi(aMax)
}

/** Vigências 'YYYY-MM-DD' (null aberto) se sobrepõem? Strings ISO comparam lexicograficamente. */
function vigenciaSobrepoe(a: PrecoRegistro, b: PrecoRegistro): boolean {
  const aStart = a.vigenciaInicio ?? '0000-00-00'
  const aEnd = a.vigenciaFim ?? '9999-12-31'
  const bStart = b.vigenciaInicio ?? '0000-00-00'
  const bEnd = b.vigenciaFim ?? '9999-12-31'
  return aStart <= bEnd && bStart <= aEnd
}

function mesmoContexto(a: PrecoRegistro, b: PrecoRegistro): boolean {
  return (
    (a.configuracaoFinanceiraItemId ?? null) === (b.configuracaoFinanceiraItemId ?? null) &&
    canonicalNaturezaPreco(a.natureza) === canonicalNaturezaPreco(b.natureza) &&
    (a.processoTipoId ?? null) === (b.processoTipoId ?? null) &&
    (a.faseKey ?? null) === (b.faseKey ?? null) &&
    (a.regiao ?? null) === (b.regiao ?? null) &&
    (a.modalidadeId ?? null) === (b.modalidadeId ?? null) &&
    (a.processoId ?? null) === (b.processoId ?? null) &&
    (a.itemCatalogoId ?? null) === (b.itemCatalogoId ?? null) &&
    (a.fornecedorId ?? null) === (b.fornecedorId ?? null) &&
    (a.prioridade ?? 0) === (b.prioridade ?? 0)
  )
}

/** Um preço conflita com o outro? (mesmo contexto + faixa + vigência sobrepostas, ambos ativos) */
export function conflitam(a: PrecoRegistro, b: PrecoRegistro): boolean {
  if (!ativo(a) || !ativo(b)) return false
  if (a.configuracaoFinanceiraItemId == null || b.configuracaoFinanceiraItemId == null) return false
  if (!mesmoContexto(a, b)) return false
  if (!faixaSobrepoe(a.quantidadeMinima, a.quantidadeMaxima, b.quantidadeMinima, b.quantidadeMaxima)) return false
  if (!vigenciaSobrepoe(a, b)) return false
  return true
}

export interface ConflitoResultado {
  ok: boolean
  conflitantes: number[] // ids das regras existentes que conflitam
  motivo?: string
}

/**
 * Verifica se `candidata` conflita com alguma das `existentes` (exclui a própria
 * por id em edições). Retorna ok:false com a lista de ids e mensagem clara.
 */
export function detectarConflitoPreco(candidata: PrecoRegistro, existentes: PrecoRegistro[]): ConflitoResultado {
  const conflitantes: number[] = []
  for (const e of existentes) {
    if (candidata.id != null && e.id != null && e.id === candidata.id) continue // mesma linha (edição)
    if (conflitam(candidata, e) && e.id != null) conflitantes.push(e.id)
  }
  if (conflitantes.length === 0) return { ok: true, conflitantes: [] }
  const canon = canonicalNaturezaPreco(candidata.natureza) ?? '?'
  return {
    ok: false,
    conflitantes,
    motivo:
      `Conflito de preço (${canon}): já existe(m) regra(s) ativa(s) [${conflitantes.join(', ')}] ` +
      `para a mesma Configuração Financeira, mesmo contexto/fornecedor, ` +
      `mesma prioridade, com faixa de quantidade e vigência sobrepostas. ` +
      `Ajuste contexto, fornecedor, faixa, vigência ou prioridade para diferenciá-las.`,
  }
}

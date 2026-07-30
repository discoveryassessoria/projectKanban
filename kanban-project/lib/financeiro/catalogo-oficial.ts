// lib/financeiro/catalogo-oficial.ts
// ============================================================================
// CADASTRO MESTRE OFICIAL — regra ÚNICA e PURA de quem pode virar lançamento.
//
// Existe porque o seletor de "Novo Custo"/"Nova Receita" estava exposto a itens
// de estruturas ELIMINADAS da arquitetura (ex.: "Honorário", "Produto"), que
// sobreviviam no banco por espelhamento das ilhas legadas.
//
// PRINCÍPIO: legado não se esconde por nome, código ou texto — ele é identificado
// ESTRUTURALMENTE (classificação do item + existência/estado da Configuração
// Financeira + vigência do preço). O dado histórico é PRESERVADO: continua legível
// nos lançamentos antigos; só deixa de ser ELEGÍVEL a lançamento novo.
//
// Sem Prisma, sem I/O — testável offline (scripts/catalogo-oficial.test.ts).
// ============================================================================

import {
  deriveNaturezaFinanceira, admiteCusto, admiteVenda,
  canonicalNaturezaPreco,
  type ConfigNaturezaLike, type LancamentoNatureza, type NaturezaPrecoRaw,
} from './natureza-financeira'

/** Valores possíveis do enum Prisma NaturezaItem. */
export type NaturezaItemRaw =
  | 'DOCUMENTO' | 'PRODUTO' | 'SERVICO' | 'HONORARIO'
  | 'TAXA' | 'DESPESA' | 'LOGISTICA' | 'OUTRO'

/**
 * NATUREZAS ELIMINADAS da arquitetura atual.
 *
 *  • HONORARIO — honorário deixou de ser entidade própria: é um SERVIÇO do
 *    Catálogo Mestre + Configuração Financeira + preço na Tabela de Valores
 *    (ver `scripts/seed-honorarios-italia.ts`, que é o cadastro oficial).
 *  • PRODUTO   — a empresa cadastra SERVIÇOS; "Produto" era o espelho automático
 *    das configurações nascidas de mestres legados.
 *
 * Os valores continuam no enum do banco APENAS para leitura de dados históricos.
 * Nenhum item classificado assim pode ser cadastrado, listado para lançamento ou
 * aceito em um lançamento novo.
 */
export const NATUREZAS_ITEM_ELIMINADAS: readonly NaturezaItemRaw[] = ['PRODUTO', 'HONORARIO'] as const

/** Classificações válidas para um item do Cadastro Mestre oficial. */
export const NATUREZAS_ITEM_OFICIAIS: readonly NaturezaItemRaw[] =
  ['DOCUMENTO', 'SERVICO', 'TAXA', 'DESPESA', 'LOGISTICA', 'OUTRO'] as const

/** O item pertence a uma estrutura eliminada da arquitetura? */
export function naturezaItemEliminada(n: string | null | undefined): boolean {
  return !!n && (NATUREZAS_ITEM_ELIMINADAS as readonly string[]).includes(n)
}

/** O item pertence ao Cadastro Mestre oficial e atual? */
export function naturezaItemOficial(n: string | null | undefined): boolean {
  return !!n && (NATUREZAS_ITEM_OFICIAIS as readonly string[]).includes(n)
}

// ── Vigência do preço (Tabela de Valores) ───────────────────────────────────

/** Subset de TabelaValor necessário ao julgamento (desacoplado do Prisma). */
export interface PrecoLike {
  natureza?: NaturezaPrecoRaw | null
  arquivado?: boolean | null
  /** sem vínculo canônico seguro — fora do resolver e da tela */
  legadoPendente?: boolean | null
  vigenciaInicio?: string | null // 'YYYY-MM-DD'
  vigenciaFim?: string | null    // 'YYYY-MM-DD'
}

/** Data de referência no formato da Tabela de Valores ('YYYY-MM-DD'). */
export function hojeISO(agora: Date): string {
  return agora.toISOString().slice(0, 10)
}

/**
 * O preço vale HOJE para a natureza de lançamento pedida?
 * Arquivado ou legadoPendente NUNCA vale. Sem vigência = vale desde sempre.
 */
export function precoVigente(p: PrecoLike, natureza: LancamentoNatureza, hoje: string): boolean {
  if (p.arquivado || p.legadoPendente) return false
  const canon = canonicalNaturezaPreco(p.natureza ?? null)
  if (canon == null) return false // natureza nula = linha legada/ambígua
  if (natureza === 'CUSTO' ? canon !== 'CUSTO' : canon !== 'VENDA') return false
  if (p.vigenciaInicio && p.vigenciaInicio > hoje) return false
  if (p.vigenciaFim && p.vigenciaFim < hoje) return false
  return true
}

/**
 * A natureza do lançamento exige preço VIGENTE na Tabela de Valores?
 *
 * RECEITA sim: o que se cobra do cliente é definido pelo Cadastro Mestre — é a
 * regra que a própria tela declara ("Valor definido pelo Cadastro Mestre").
 * CUSTO não: o valor é o praticado pelo fornecedor no lançamento; quando existe
 * preço cadastrado ele é sugerido, mas não é condição de elegibilidade.
 */
export function exigePrecoVigente(natureza: LancamentoNatureza): boolean {
  return natureza === 'RECEITA'
}

// ── Elegibilidade a lançamento ───────────────────────────────────────────────

/** Subset de ItemCatalogo necessário ao julgamento. */
export interface ItemMestreLike {
  ativo?: boolean | null
  natureza?: string | null
}

/** Subset de ProdutoFinanceiro (Configuração Financeira) necessário ao julgamento. */
export interface ConfigFinanceiraLike extends ConfigNaturezaLike {
  ativo?: boolean | null
}

export type MotivoInelegivel =
  | 'ITEM_INEXISTENTE'
  | 'ITEM_INATIVO'
  | 'NATUREZA_ELIMINADA'
  | 'SEM_CONFIGURACAO_FINANCEIRA'
  | 'CONFIGURACAO_INATIVA'
  | 'NATUREZA_FINANCEIRA_INDEFINIDA'
  | 'NAO_ELEGIVEL_A_NATUREZA'
  | 'SEM_PRECO_VIGENTE'

export interface Elegibilidade {
  ok: boolean
  motivo?: MotivoInelegivel
  detalhe?: string
}

const DETALHE: Record<MotivoInelegivel, string> = {
  ITEM_INEXISTENTE: 'Item do Cadastro Mestre inexistente.',
  ITEM_INATIVO: 'Item do Cadastro Mestre inativo.',
  NATUREZA_ELIMINADA: 'Item de cadastro legado — preservado apenas para histórico, não pode originar novos lançamentos.',
  SEM_CONFIGURACAO_FINANCEIRA: 'Item sem Configuração Financeira.',
  CONFIGURACAO_INATIVA: 'Configuração Financeira inativa.',
  NATUREZA_FINANCEIRA_INDEFINIDA: 'Configuração Financeira sem Natureza Financeira definida.',
  NAO_ELEGIVEL_A_NATUREZA: 'A Configuração Financeira do item não admite esta natureza de lançamento.',
  SEM_PRECO_VIGENTE: 'Item sem valor vigente na Tabela de Valores.',
}

const nao = (motivo: MotivoInelegivel): Elegibilidade => ({ ok: false, motivo, detalhe: DETALHE[motivo] })

/**
 * REGRA ÚNICA: o item pode originar um lançamento novo desta natureza?
 *
 * Vale para a listagem (seletor) E para a criação (API) — a mesma função nos dois
 * lados garante que o frontend não faça correção cosmética e que um POST direto
 * com item legado seja recusado.
 */
export function elegibilidadeParaLancamento(entrada: {
  item: ItemMestreLike | null | undefined
  config: ConfigFinanceiraLike | null | undefined
  precos?: PrecoLike[] | null
  natureza: LancamentoNatureza
  hoje: string
}): Elegibilidade {
  const { item, config, natureza, hoje } = entrada
  if (!item) return nao('ITEM_INEXISTENTE')
  if (item.ativo === false) return nao('ITEM_INATIVO')
  if (!naturezaItemOficial(item.natureza)) {
    // Eliminada explicitamente ou classificação desconhecida: fora do oficial.
    return nao('NATUREZA_ELIMINADA')
  }
  if (!config) return nao('SEM_CONFIGURACAO_FINANCEIRA')
  if (config.ativo === false) return nao('CONFIGURACAO_INATIVA')

  const natFin = deriveNaturezaFinanceira(config)
  if (natFin == null) return nao('NATUREZA_FINANCEIRA_INDEFINIDA')
  const admite = natureza === 'CUSTO' ? admiteCusto(natFin) : admiteVenda(natFin)
  if (!admite) return nao('NAO_ELEGIVEL_A_NATUREZA')

  if (exigePrecoVigente(natureza)) {
    const temPreco = (entrada.precos ?? []).some((p) => precoVigente(p, natureza, hoje))
    if (!temPreco) return nao('SEM_PRECO_VIGENTE')
  }
  return { ok: true }
}

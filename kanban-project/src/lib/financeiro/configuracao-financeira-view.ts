// src/lib/financeiro/configuracao-financeira-view.ts
// ============================================================================
// ADAPTADOR (view) — apresenta o ProdutoFinanceiro EXISTENTE no vocabulário
// "Configuração Financeira" da Fase 3, SEM alterar schema e SEM criar conceito
// novo. É uma projeção de leitura, reaproveitando os dados de hoje.
//
// IMPORTANTE (transição): o papel financeiro do brief tem 6 valores
// (CUSTO/RECEITA/REPASSE/REEMBOLSO/DESPESA_INTERNA/HONORARIO). O dado de HOJE só
// distingue cost/revenue (naturezaFinanceira) + flags (repasse/reembolsavel/
// custoInterno). Para NÃO especular, o papel derivado aqui é só CUSTO|RECEITA
// (fiel ao dado real) e os demais são expostos como FACETAS booleanas. O papel
// completo vira coluna explícita no Lote M1 (PapelFinanceiro) — ver
// docs/auditoria-refatoracao-financeiro.md §8c.
// ============================================================================

/** Papéis do brief (Fase 3). Vira enum Prisma no M1; aqui é só o vocabulário. */
export type PapelFinanceiro =
  | 'CUSTO'
  | 'RECEITA'
  | 'REPASSE'
  | 'REEMBOLSO'
  | 'DESPESA_INTERNA'
  | 'HONORARIO'

/** Subset de ProdutoFinanceiro necessário à projeção (desacoplado do Prisma). */
export interface ProdutoFinanceiroLike {
  id: number
  codigo: string
  nome: string
  naturezaFinanceira: string | null // "cost" | "revenue"
  itemCatalogoId: number | null
  categoriaId: number | null
  planoContaId: number | null
  moedaPadrao: string
  valorPadrao: number | null
  cobravelDoCliente: boolean
  custoInterno: boolean
  repasse: boolean
  reembolsavel: boolean
  ativo: boolean
}

export interface FacetasFinanceiras {
  cobravelDoCliente: boolean
  custoInterno: boolean
  repasse: boolean
  reembolsavel: boolean
}

export interface ConfiguracaoFinanceiraView {
  id: number
  codigo: string
  nome: string
  /** papel PRINCIPAL fiel ao dado atual (CUSTO|RECEITA). */
  papel: Extract<PapelFinanceiro, 'CUSTO' | 'RECEITA'>
  itemCatalogoId: number | null
  /** true se a config ainda não referencia um mestre (órfã — corrigir no M1). */
  semMestre: boolean
  categoriaId: number | null
  planoContaId: number | null
  moedaPadrao: string
  valorPadrao: number | null
  facetas: FacetasFinanceiras
  ativo: boolean
}

/** cost → CUSTO; qualquer outro (revenue/null) → RECEITA (default do schema). */
export function derivarPapel(naturezaFinanceira: string | null): 'CUSTO' | 'RECEITA' {
  return (naturezaFinanceira ?? 'revenue').toLowerCase() === 'cost' ? 'CUSTO' : 'RECEITA'
}

/** Projeta um ProdutoFinanceiro como Configuração Financeira (leitura). */
export function paraConfiguracaoView(p: ProdutoFinanceiroLike): ConfiguracaoFinanceiraView {
  return {
    id: p.id,
    codigo: p.codigo,
    nome: p.nome,
    papel: derivarPapel(p.naturezaFinanceira),
    itemCatalogoId: p.itemCatalogoId,
    semMestre: p.itemCatalogoId == null,
    categoriaId: p.categoriaId,
    planoContaId: p.planoContaId,
    moedaPadrao: p.moedaPadrao,
    valorPadrao: p.valorPadrao,
    facetas: {
      cobravelDoCliente: p.cobravelDoCliente,
      custoInterno: p.custoInterno,
      repasse: p.repasse,
      reembolsavel: p.reembolsavel,
    },
    ativo: p.ativo,
  }
}

/**
 * Agrupa configurações por item mestre — a visão que a tela "Configurações
 * Financeiras" usa: UMA entidade (itemCatalogoId) com N papéis (CUSTO/RECEITA/…),
 * SEM duplicar o documento/serviço. Configs órfãs (semMestre) vão em `orfaos`.
 */
export function agruparPorItemMestre(
  configs: ConfiguracaoFinanceiraView[],
): { porItem: Map<number, ConfiguracaoFinanceiraView[]>; orfaos: ConfiguracaoFinanceiraView[] } {
  const porItem = new Map<number, ConfiguracaoFinanceiraView[]>()
  const orfaos: ConfiguracaoFinanceiraView[] = []
  for (const c of configs) {
    if (c.itemCatalogoId == null) {
      orfaos.push(c)
      continue
    }
    const arr = porItem.get(c.itemCatalogoId) ?? []
    arr.push(c)
    porItem.set(c.itemCatalogoId, arr)
  }
  return { porItem, orfaos }
}

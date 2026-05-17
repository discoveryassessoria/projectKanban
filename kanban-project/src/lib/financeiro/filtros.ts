// src/lib/financeiro/filtros.ts
export type EstadoFinanceiro = 'ATIVA' | 'RASCUNHO' | 'CANCELADA'

export interface ItemComEstado {
  cancelada?: boolean   // receitas
  cancelado?: boolean   // custos
  status?: EstadoFinanceiro
}

/**
 * Retorna apenas itens ATIVOS para fins de agregação financeira:
 * - Não cancelados (soft delete)
 * - Não rascunhos
 * 
 * Use em qualquer tela que SOMA valores (Visão Geral, Extrato, Inadimplência).
 * As abas Receitas/Custos têm filtro próprio porque mostram rascunhos numa aba dedicada.
 */
export function apenasAtivos<T extends ItemComEstado>(itens: T[]): T[] {
  return itens.filter((x) => {
    if (x.cancelada || x.cancelado) return false
    if (x.status && x.status !== 'ATIVA') return false
    return true
  })
}
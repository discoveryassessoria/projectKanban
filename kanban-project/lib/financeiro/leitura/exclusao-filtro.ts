// lib/financeiro/leitura/exclusao-filtro.ts
// ============================================================================
// FONTE ÚNICA do filtro de EXCLUSÃO LÓGICA nas consultas padrão do Financeiro.
// A exclusão de Receita (lib/financeiro/acoes/excluir-receita) marca a Receita de
// origem com `contextoAplicado.exclusao` (+ arquivadaEm) e PRESERVA o Ledger. As
// listagens são baseadas em ObrigacaoEconomica; como a marca vive na Receita de
// origem, toda consulta padrão de receitas/obrigações deve honrá-la para a receita
// excluída sair das telas. Arquivamento (sem a marca `exclusao`) NÃO é afetado aqui.
// ============================================================================
import { prisma } from '@/lib/prisma'

/** IDs das Receitas com exclusão lógica ativa (contextoAplicado.exclusao). */
export async function receitasExcluidasIds(receitaIds: (number | null | undefined)[]): Promise<Set<number>> {
  const uniq = [...new Set(receitaIds.filter((v): v is number => v != null))]
  if (!uniq.length) return new Set<number>()
  const recs = await prisma.receita.findMany({ where: { id: { in: uniq } }, select: { id: true, contextoAplicado: true } })
  return new Set(recs.filter((r) => temMarcaExclusao(r.contextoAplicado)).map((r) => r.id))
}

/** A obrigação (origem Receita) está logicamente excluída? */
export function obrigacaoExcluida(o: { origemTipo?: string | null; origemId?: number | null }, excluidas: Set<number>): boolean {
  return o.origemTipo === 'Receita' && o.origemId != null && excluidas.has(o.origemId)
}

/** Reconhece a marca de exclusão em um contextoAplicado (Json) já carregado. */
export function temMarcaExclusao(contextoAplicado: unknown): boolean {
  return !!(contextoAplicado && typeof contextoAplicado === 'object' && !Array.isArray(contextoAplicado)
    && (contextoAplicado as Record<string, unknown>).exclusao)
}

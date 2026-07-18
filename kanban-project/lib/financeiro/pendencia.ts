// lib/financeiro/pendencia.ts
// ============================================================================
// §13 — resolução idempotente de PendenciaFinanceira. Quando a causa é corrigida
// e reprocessada com sucesso, a pendência é marcada como RESOLVIDA (preservando o
// histórico), sem apagar. Não abre nova pendência para a mesma chave (a criação já
// é idempotente por chaveIdempotencia @unique).
// ============================================================================
import { prisma } from '@/lib/prisma'

/**
 * Marca como resolvida a pendência da chave dada (a mesma `pend::<chave>` usada na
 * criação pelo motor). Idempotente: se não houver pendência aberta, é no-op.
 * Retorna quantas foram resolvidas.
 */
export async function resolverPendenciaPorChave(chaveIdempotencia: string, resolucao = 'Reprocessado com sucesso'): Promise<number> {
  const r = await prisma.pendenciaFinanceira.updateMany({
    where: { chaveIdempotencia, resolvida: false },
    data: { resolvida: true, resolvidaEm: new Date(), resolucao: resolucao.slice(0, 300) },
  })
  return r.count
}

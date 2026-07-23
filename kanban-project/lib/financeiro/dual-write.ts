// lib/financeiro/dual-write.ts
// ============================================================================
// ESCRITA DUPLA (Motor Financeiro V3 · Fase 1). Espelha fatos do legado no novo
// motor SEM alterar o comportamento atual. Controlada por flag e SEMPRE
// best-effort (nunca quebra o fluxo vivo). Padrão: DESLIGADA. Ver spec §20 Fase 1.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from './ledger/ledger-service'

/** A escrita dupla está ligada? (flag; default OFF). */
export function dualWriteAtivo(): boolean {
  return process.env.FINANCEIRO_DUAL_WRITE === '1'
}

/**
 * Espelha uma Receita como ObrigacaoEconomica (idempotente pela origem) e, se
 * houver, vincula a Cobrança. NUNCA lança — falha é logada e ignorada (o fluxo
 * legado é a autoridade nesta fase). No-op quando a flag está desligada.
 */
export async function espelharReceitaComoObrigacao(receita: {
  id: number; codigo?: string | null; valor: number | string; moeda?: string | null; processoId?: number | null
}, opts?: { cobrancaId?: number | null; criadoPorId?: number | null }): Promise<void> {
  if (!dualWriteAtivo()) return
  try {
    const { obrigacaoId } = await criarObrigacaoEconomicaComLedger({
      natureza: 'RECEITA',
      valorContratado: Number(receita.valor),
      moedaContratual: String(receita.moeda ?? 'BRL'),
      codigoOperacional: receita.codigo ?? null,
      processoId: receita.processoId ?? null,
      origemTipo: 'Receita', origemId: receita.id,
      criadoPorId: opts?.criadoPorId ?? null,
    })
    if (opts?.cobrancaId) {
      await prisma.cobranca.update({ where: { id: opts.cobrancaId }, data: { obrigacaoId } }).catch(() => {})
    }
  } catch (e) {
    console.error('[dual-write] espelho falhou (ignorado, legado é autoridade):', String((e as any)?.message ?? e).slice(0, 300))
  }
}

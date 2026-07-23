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
    // 1) Obrigação econômica + Ledger (OBRIGACAO_CRIADA balanceado) + evento Outbox.
    //    Idempotente por (origemTipo, origemId): nunca duplica.
    const { obrigacaoId } = await criarObrigacaoEconomicaComLedger({
      natureza: 'RECEITA',
      valorContratado: Number(receita.valor),
      moedaContratual: String(receita.moeda ?? 'BRL'),
      codigoOperacional: receita.codigo ?? null,
      processoId: receita.processoId ?? null,
      origemTipo: 'Receita', origemId: receita.id,
      criadoPorId: opts?.criadoPorId ?? null,
    })

    // 2) Vínculo da cobrança (parcelas pertencem à cobrança → ao agregado).
    if (opts?.cobrancaId) {
      await prisma.cobranca.update({ where: { id: opts.cobrancaId }, data: { obrigacaoId } }).catch(() => {})
    }

    // 3) Distribuição econômica + requerentes vinculados (transação independente,
    //    idempotente: só cria se ainda não houver distribuição para a obrigação).
    const jaDist = await prisma.distribuicaoEconomica.count({ where: { obrigacaoId } })
    if (jaDist === 0) {
      const reqs = await prisma.receitaRequerente.findMany({ where: { receitaId: receita.id }, select: { requerenteId: true, percentual: true, idx: true } })
      if (reqs.length > 0) {
        await prisma.distribuicaoEconomica.create({ data: {
          obrigacaoId, modo: 'PERCENTUAL',
          participacoes: { create: reqs.map((r, i) => ({ pessoaId: r.requerenteId ?? 0, percentual: Number(r.percentual ?? 0), ordem: r.idx ?? i })) },
        } }).catch(() => {})
      }
    }

    // 4) Política cambial aplicável (só quando há conversão; idempotente).
    if (String(receita.moeda ?? 'BRL') !== 'BRL') {
      const obr = await prisma.obrigacaoEconomica.findUnique({ where: { id: obrigacaoId }, select: { politicaCambialId: true } })
      if (obr && obr.politicaCambialId == null) {
        const pc = await prisma.politicaCambial.create({ data: { escopo: 'CONTRATO', tipo: 'VARIAVEL', tratamentoDiferenca: 'CONTABIL', fonteDefault: 'receita' } })
        await prisma.obrigacaoEconomica.update({ where: { id: obrigacaoId }, data: { politicaCambialId: pc.id } }).catch(() => {})
      }
    }
  } catch (e) {
    // best-effort: o legado é a autoridade — falha do espelho NUNCA interrompe.
    console.error('[dual-write] espelho falhou (ignorado, legado é autoridade):', String((e as any)?.message ?? e).slice(0, 300))
  }
}

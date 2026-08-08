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
    // PROVENIÊNCIA DO ESPELHO. A obrigação nascia sem `personId` e sem
    // `chaveIdempotencia`: o seu único vínculo com a causa era `origemId`, uma
    // coluna SOLTA (sem FK) apontando para a Receita. Apagada a Receita, o espelho
    // ficava ATIVO, sem dono e sem nome de participante — medido em produção
    // (processo 513: obrigações 16 e 18, R$ 4.800 fantasmas).
    //
    // Copiar a proveniência da Receita não conserta o passado (a reconciliação
    // faz isso), mas faz o espelho novo saber DE QUEM ele é sem depender de
    // arqueologia. Leitura extra e barata; nada aqui muda valor ou Ledger.
    const origem = await prisma.receita.findUnique({
      where: { id: receita.id },
      select: { personId: true, chaveIdempotencia: true, phaseKey: true, phaseCycle: true, configFinanceiraId: true, regraFinanceiraId: true, documentoId: true, tipoServicoId: true },
    }).catch(() => null)

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
      regraFinanceiraId: origem?.regraFinanceiraId ?? null,
      vinculo: origem
        ? {
            personId: origem.personId, documentoId: origem.documentoId, tipoServicoId: origem.tipoServicoId,
            phaseKey: origem.phaseKey, phaseCycle: origem.phaseCycle,
            configFinanceiraId: origem.configFinanceiraId, chaveIdempotencia: origem.chaveIdempotencia,
          }
        : null,
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
        // ATENÇÃO À SEMÂNTICA: `ParticipacaoEconomica.pessoaId` recebe `Requerente.id`,
        // não `Pessoa.id` — o participante de uma distribuição é a ENTIDADE DE COBRANÇA,
        // que existe mesmo quando não há nó na árvore. A coluna tem nome enganoso e não
        // tem FK; quem LÊ resolve por lib/financeiro/leitura/participante-identidade.
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

// ============================================================================
// F3 — Consolidação de CUSTO no motor V3. Simétrico ao espelho de Receita, mas
// SEMPRE ATIVO (não flag-gated): o objetivo de F3 é que nenhum fluxo vivo dependa
// do legado — todo Custo do motor passa a existir também como ObrigacaoEconomica
// (natureza=CUSTO/A_PAGAR), que é a fonte lida pelas telas V3. Idempotente por
// (origemTipo,origemId); best-effort — falha do espelho NUNCA quebra a geração.
// Custo e Receita seguem conceitos de domínio distintos; o V3 é só a infra comum.
// ============================================================================
export async function espelharCustoComoObrigacao(custo: {
  id: number; codigo?: string | null; valor: number | string; moeda?: string | null; processoId?: number | null
  fornecedorId?: number | null; faseId?: number | null; vencimento?: Date | null; criadoPorId?: number | null
}): Promise<number | null> {
  try {
    const { obrigacaoId } = await criarObrigacaoEconomicaComLedger({
      natureza: 'CUSTO',
      valorContratado: Number(custo.valor),
      moedaContratual: String(custo.moeda ?? 'BRL'),
      codigoOperacional: custo.codigo ?? null,
      processoId: custo.processoId ?? null,
      faseId: custo.faseId ?? null,
      fornecedorId: custo.fornecedorId ?? null,
      vencimento: custo.vencimento ?? null,
      origemTipo: 'Custo', origemId: custo.id,
      criadoPorId: custo.criadoPorId ?? null,
    })
    return obrigacaoId
  } catch (e) {
    console.error('[dual-write] espelho de custo falhou (ignorado, legado é autoridade):', String((e as any)?.message ?? e).slice(0, 300))
    return null
  }
}

/**
 * Espelha no V3 todos os Custos vivos de um processo que ainda não têm obrigação
 * correspondente. Chamado após a reconciliação financeira da fase (post-commit,
 * best-effort). Idempotente: só cria o que falta. Cancelados ficam de fora.
 */
export async function espelharCustosDoProcesso(processoId: number, criadoPorId?: number | null): Promise<number> {
  try {
    const custos = await prisma.custo.findMany({
      where: { processoId, status: { not: 'CANCELADA' } },
      select: { id: true, codigo: true, valor: true, moeda: true, processoId: true, vencimento: true },
    })
    if (!custos.length) return 0
    const jaEspelhados = await prisma.obrigacaoEconomica.findMany({
      where: { origemTipo: 'Custo', origemId: { in: custos.map((c) => c.id) } },
      select: { origemId: true },
    })
    const espelhado = new Set(jaEspelhados.map((o) => o.origemId))
    let n = 0
    for (const c of custos) {
      if (espelhado.has(c.id)) continue
      const id = await espelharCustoComoObrigacao({ ...c, moeda: String(c.moeda), valor: Number(c.valor), criadoPorId })
      if (id != null) n++
    }
    return n
  } catch (e) {
    console.error('[dual-write] espelho de custos do processo falhou (ignorado):', String((e as any)?.message ?? e).slice(0, 300))
    return 0
  }
}

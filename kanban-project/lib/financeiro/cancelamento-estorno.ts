// lib/financeiro/cancelamento-estorno.ts
// ============================================================================
// §10–§12 — CANCELAMENTO e ESTORNO idempotentes do lançamento canônico do processo
// (Receita/Custo). NUNCA apaga histórico.
//
//   • Cancelamento: só p/ lançamento ABERTO (sem parcela recebida/paga). Marca
//     status=CANCELADA + canceladoEm/motivo/ator/evento; cancela parcelas abertas;
//     a chave de idempotência ORIGINAL permanece ocupada (não regenera).
//   • Estorno: p/ lançamento LIQUIDADO. Cria um MOVIMENTO INVERSO (valor negativo)
//     vinculado por estornoDeId; preserva o original (só marca estornadoEm).
//   • Idempotência por CHAVE ÚNICA no banco (chaveCancelamento / chaveEstorno /
//     estornoDeId @unique) — reprocessar devolve o resultado já existente.
//
// Serviço ÚNICO: endpoints e reprocessamentos usam estas funções, não SQL solto.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { gerarCodigoReceita, gerarCodigoCusto } from '@/lib/financeiro/codigos'
import { Prisma } from '@prisma/client'

export type TipoLancamento = 'receita' | 'custo'

export interface OpcoesOperacao {
  motivo?: string
  atorId?: number | null
  eventoRef?: string | null // evento/solicitação de origem (compõe a chave)
  ocorrencia?: string | number | null // ocorrência/versão (compõe a chave)
}

export interface ResultadoOperacao {
  ok: boolean
  status: 'cancelado' | 'estornado' | 'ja_processado' | 'bloqueado' | 'nao_encontrado'
  lancamentoId?: number
  estornoId?: number
  motivo?: string
}

function chaveCancel(tipo: TipoLancamento, id: number, o: OpcoesOperacao): string {
  return `cancel::${tipo}::${id}::${o.eventoRef ?? 'manual'}::${o.ocorrencia ?? '1'}`.slice(0, 220)
}
function chaveEstornoDe(tipo: TipoLancamento, id: number, o: OpcoesOperacao): string {
  return `estorno::${tipo}::${id}::${o.eventoRef ?? 'manual'}::${o.ocorrencia ?? '1'}`.slice(0, 220)
}

/** Um lançamento está LIQUIDADO se possui parcela recebida/paga. */
async function estaLiquidado(tipo: TipoLancamento, id: number): Promise<boolean> {
  const parcelas = await prisma.parcelaFinanceira.findMany({
    where: tipo === 'receita' ? { receitaId: id } : { custoId: id },
    select: { status: true },
  })
  return parcelas.some((p) => p.status === 'RECEBIDA' || p.status === 'PAGA')
}

// ── §10 CANCELAMENTO ─────────────────────────────────────────────────────────
export async function cancelarLancamento(tipo: TipoLancamento, id: number, opts: OpcoesOperacao = {}): Promise<ResultadoOperacao> {
  const chave = chaveCancel(tipo, id, opts)
  const model = tipo === 'receita' ? prisma.receita : prisma.custo
  const atual = tipo === 'receita'
    ? await prisma.receita.findUnique({ where: { id }, select: { id: true, cancelada: true, canceladoEm: true } })
    : await prisma.custo.findUnique({ where: { id }, select: { id: true, cancelado: true, canceladoEm: true } })
  if (!atual) return { ok: false, status: 'nao_encontrado', motivo: `${tipo} ${id} não existe` }

  // Idempotência: já cancelado → devolve o resultado existente (não cancela de novo).
  if (atual.canceladoEm != null) return { ok: true, status: 'ja_processado', lancamentoId: id }

  // §10 — liquidado NÃO pode ser cancelado destrutivamente; exige estorno.
  if (await estaLiquidado(tipo, id)) {
    return { ok: false, status: 'bloqueado', lancamentoId: id, motivo: 'Lançamento liquidado (parcela recebida/paga) — use ESTORNO, não cancelamento.' }
  }

  try {
    await prisma.$transaction(async (tx) => {
      const dadosComuns = {
        canceladoEm: new Date(), canceladoMotivo: (opts.motivo ?? 'Cancelado').slice(0, 500),
        canceladoPorId: opts.atorId ?? null, canceladoEventoRef: opts.eventoRef ?? null, chaveCancelamento: chave,
      }
      if (tipo === 'receita') await tx.receita.update({ where: { id }, data: { ...dadosComuns, cancelada: true, status: 'CANCELADA' } })
      else await tx.custo.update({ where: { id }, data: { ...dadosComuns, cancelado: true, status: 'CANCELADA' } })
      // cancela parcelas ainda ABERTAS (preserva as liquidadas — mas aqui não há liquidadas)
      await tx.parcelaFinanceira.updateMany({
        where: { ...(tipo === 'receita' ? { receitaId: id } : { custoId: id }), status: 'PENDENTE' },
        data: { status: 'CANCELADA' },
      })
    })
    void model
    return { ok: true, status: 'cancelado', lancamentoId: id }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      // corrida: alguém já cancelou com a mesma chave → idempotente
      return { ok: true, status: 'ja_processado', lancamentoId: id }
    }
    throw e
  }
}

// ── §11 ESTORNO ──────────────────────────────────────────────────────────────
export async function estornarLancamento(tipo: TipoLancamento, id: number, opts: OpcoesOperacao = {}): Promise<ResultadoOperacao> {
  const chave = chaveEstornoDe(tipo, id, opts)

  // Idempotência: já existe o movimento inverso deste original? devolve-o.
  const inversoExistente = tipo === 'receita'
    ? await prisma.receita.findFirst({ where: { estornoDeId: id }, select: { id: true } })
    : await prisma.custo.findFirst({ where: { estornoDeId: id }, select: { id: true } })
  if (inversoExistente) return { ok: true, status: 'ja_processado', lancamentoId: id, estornoId: inversoExistente.id }

  if (tipo === 'receita') {
    const orig = await prisma.receita.findUnique({ where: { id } })
    if (!orig) return { ok: false, status: 'nao_encontrado', motivo: `receita ${id} não existe` }
    try {
      const est = await prisma.$transaction(async (tx) => {
        const codigo = await gerarCodigoReceita()
        const inv = await tx.receita.create({
          data: {
            codigo, processoId: orig.processoId, categoria: orig.categoria,
            descricao: `Estorno de ${orig.codigo}: ${orig.descricao}`.slice(0, 300),
            moeda: orig.moeda, valor: orig.valor.neg(), fxEstimado: orig.fxEstimado, fxRule: orig.fxRule,
            nParcelas: 1, data1: new Date(), periodicidade: orig.periodicidade, status: 'ATIVA',
            personId: orig.personId, documentoId: orig.documentoId, tipoServicoId: orig.tipoServicoId,
            phaseKey: orig.phaseKey, origem: 'estorno', origemLancamento: orig.origemLancamento, naturezaLancamento: orig.naturezaLancamento,
            estornoDeId: id, chaveEstorno: chave, dataCompetencia: orig.dataCompetencia ?? new Date(),
            // parcela INVERSA (negativa) p/ refletir em reads baseados em parcela (receber/fluxo/DRE)
            parcelas: { create: [{ numero: 1, vencimento: new Date(), valor: orig.valor.neg(), status: 'PENDENTE' as const }] },
          },
        })
        await tx.receita.update({ where: { id }, data: { estornadoEm: new Date(), estornoMotivo: (opts.motivo ?? 'Estornado').slice(0, 500) } })
        return inv
      })
      return { ok: true, status: 'estornado', lancamentoId: id, estornoId: est.id }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const inv = await prisma.receita.findFirst({ where: { estornoDeId: id }, select: { id: true } })
        return { ok: true, status: 'ja_processado', lancamentoId: id, estornoId: inv?.id }
      }
      throw e
    }
  } else {
    const orig = await prisma.custo.findUnique({ where: { id } })
    if (!orig) return { ok: false, status: 'nao_encontrado', motivo: `custo ${id} não existe` }
    try {
      const est = await prisma.$transaction(async (tx) => {
        const codigo = await gerarCodigoCusto()
        const inv = await tx.custo.create({
          data: {
            codigo, processoId: orig.processoId, tipo: orig.tipo, categoria: orig.categoria,
            descricao: `Estorno de ${orig.codigo}: ${orig.descricao}`.slice(0, 300),
            moeda: orig.moeda, valor: orig.valor.neg(), fxEstimado: orig.fxEstimado, fxRule: orig.fxRule,
            nParcelas: 1, vencimento: new Date(), custoOperacional: orig.custoOperacional, status: 'ATIVA',
            personId: orig.personId, documentoId: orig.documentoId, tipoServicoId: orig.tipoServicoId,
            phaseKey: orig.phaseKey, origem: 'estorno', origemLancamento: orig.origemLancamento, naturezaLancamento: orig.naturezaLancamento,
            estornoDeId: id, chaveEstorno: chave, dataCompetencia: orig.dataCompetencia ?? new Date(),
            parcelas: { create: [{ numero: 1, vencimento: new Date(), valor: orig.valor.neg(), status: 'PENDENTE' as const }] },
          },
        })
        await tx.custo.update({ where: { id }, data: { estornadoEm: new Date(), estornoMotivo: (opts.motivo ?? 'Estornado').slice(0, 500) } })
        return inv
      })
      return { ok: true, status: 'estornado', lancamentoId: id, estornoId: est.id }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const inv = await prisma.custo.findFirst({ where: { estornoDeId: id }, select: { id: true } })
        return { ok: true, status: 'ja_processado', lancamentoId: id, estornoId: inv?.id }
      }
      throw e
    }
  }
}

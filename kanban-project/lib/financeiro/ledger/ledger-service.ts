// lib/financeiro/ledger/ledger-service.ts
// ============================================================================
// Serviço SERVER do Ledger (Motor Financeiro V3 · Fase 1). Único ponto que
// PERSISTE lançamentos double-entry. Transacional + idempotente. Nunca altera
// saldo direto — grava entries balanceados e RECALCULA a projeção (replay).
// Emite domain events no Outbox (DomainOutbox). Ver spec §4, §0.
// ============================================================================
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { lancObrigacaoCriada, type Lancamento, type Direcao as PernaDirecao } from './lancamentos'
import { projetar, type EntryProjecao } from './projecao'
import { direcaoDe, aReceber, type Natureza } from '../dominio/obrigacao-economica'
import { chaveEvento } from '../dominio/eventos'

type Tx = Prisma.TransactionClient

/**
 * Persiste um lançamento (N pernas balanceadas) no Ledger de uma obrigação,
 * dentro de uma transação. Idempotente por `transacaoId` (chave única por perna).
 * Após gravar, recalcula a projeção materializada (cache) por replay.
 */
export async function registrarLancamento(tx: Tx, args: {
  obrigacaoId: number
  ledgerId: number
  transacaoId: string
  lancamento: Lancamento
  ocorrenciaId?: number | null
  moeda?: string
  data?: Date
  criadoPorId?: number | null
}): Promise<{ entriesCriados: number }> {
  const { obrigacaoId, ledgerId, transacaoId, lancamento } = args
  const data = args.data ?? new Date()
  const moeda = (args.moeda ?? 'BRL') as any

  // idempotência: se já existe qualquer entry desta transação, não repete.
  const jaTem = await tx.ledgerEntry.count({ where: { transacaoId } })
  if (jaTem > 0) { await recomputarProjecao(tx, obrigacaoId); return { entriesCriados: 0 } }

  const ultima = await tx.ledgerEntry.aggregate({ where: { ledgerId }, _max: { sequencia: true } })
  let seq = (ultima._max.sequencia ?? 0)

  for (const p of lancamento.pernas) {
    seq += 1
    await tx.ledgerEntry.create({ data: {
      ledgerId, obrigacaoId, ocorrenciaId: args.ocorrenciaId ?? null, transacaoId,
      tipo: lancamento.tipo, contaContabil: p.conta, direcao: p.direcao,
      valor: p.valor, moeda, valorContabil: p.valor, data, sequencia: seq,
      idempotencyKey: `${transacaoId}#${p.conta}#${p.direcao}#${seq}`,
      criadoPorId: args.criadoPorId ?? null,
    } })
  }
  await recomputarProjecao(tx, obrigacaoId)
  return { entriesCriados: lancamento.pernas.length }
}

/** Recalcula a projeção (cache) por REPLAY de todos os entries. Fonte = Ledger. */
export async function recomputarProjecao(tx: Tx, obrigacaoId: number): Promise<void> {
  const entries = await tx.ledgerEntry.findMany({ where: { obrigacaoId }, select: { contaContabil: true, direcao: true, valorContabil: true, sequencia: true } })
  const proj = projetar(entries.map((e): EntryProjecao => ({ conta: e.contaContabil, direcao: e.direcao as PernaDirecao, valor: Number(e.valorContabil), sequencia: e.sequencia })))
  await tx.saldoProjecao.upsert({
    where: { obrigacaoId },
    create: { obrigacaoId, recebidoBruto: proj.recebidoBruto, recebidoLiquido: proj.recebidoLiquido, saldo: proj.saldo, ultimaSequenciaAplicada: proj.ultimaSequenciaAplicada },
    update: { recebidoBruto: proj.recebidoBruto, recebidoLiquido: proj.recebidoLiquido, saldo: proj.saldo, ultimaSequenciaAplicada: proj.ultimaSequenciaAplicada },
  })
}

/**
 * Cria (ou reaproveita) a ObrigacaoEconomica de origem, seu Ledger e o
 * lançamento OBRIGACAO_CRIADA balanceado; emite evento no Outbox. Idempotente
 * por (origemTipo, origemId): reprocessar NÃO duplica.
 */
export async function criarObrigacaoEconomicaComLedger(input: {
  natureza: Natureza
  valorContratado: number
  moedaContratual?: string
  codigoOperacional?: string | null
  processoId?: number | null
  clienteId?: number | null
  regraFinanceiraId?: number | null
  origemTipo?: string | null // 'Receita' | 'Custo' | 'nativo'
  origemId?: number | null
  criadoPorId?: number | null
  db?: PrismaClient
}): Promise<{ obrigacaoId: number; reaproveitada: boolean }> {
  const client = input.db ?? prisma
  const moeda = (input.moedaContratual ?? 'BRL') as any
  const dir = direcaoDe(input.natureza)

  return client.$transaction(async (tx) => {
    // idempotência pela origem
    if (input.origemTipo && input.origemId != null) {
      const existente = await tx.obrigacaoEconomica.findUnique({ where: { origemTipo_origemId: { origemTipo: input.origemTipo, origemId: input.origemId } } })
      if (existente) return { obrigacaoId: existente.id, reaproveitada: true }
    }

    const obr = await tx.obrigacaoEconomica.create({ data: {
      codigoOperacional: input.codigoOperacional ?? null,
      natureza: input.natureza, direcao: dir,
      processoId: input.processoId ?? null, clienteId: input.clienteId ?? null,
      regraFinanceiraId: input.regraFinanceiraId ?? null,
      moedaContratual: moeda, moedaContabil: moeda,
      valorContratado: input.valorContratado,
      status: 'ATIVO', origemTipo: input.origemTipo ?? 'nativo', origemId: input.origemId ?? null,
      criadoPorId: input.criadoPorId ?? null,
    } })

    const ledger = await tx.ledgerFinanceiro.create({ data: { obrigacaoId: obr.id, moedaContabil: moeda } })

    // ocorrência OBRIGACAO_CRIADA + lançamento balanceado
    const oc = await tx.ocorrenciaFinanceira.create({ data: {
      obrigacaoId: obr.id, tipo: 'OBRIGACAO_CRIADA', valor: input.valorContratado, moeda, data: new Date(),
      status: 'PROCESSADA', idempotencyKey: `obr-criada:${obr.id}`, criadoPorId: input.criadoPorId ?? null,
    } })
    const lanc = lancObrigacaoCriada(input.valorContratado, aReceber(input.natureza))
    await registrarLancamento(tx, { obrigacaoId: obr.id, ledgerId: ledger.id, transacaoId: `obr-criada:${obr.id}`, lancamento: lanc, ocorrenciaId: oc.id, moeda, criadoPorId: input.criadoPorId ?? null })

    // domain event (Outbox) — dedup por chave
    await tx.domainOutbox.create({ data: {
      tipo: 'financeiro.obrigacao.criada', aggregateType: 'ObrigacaoEconomica', aggregateId: obr.id,
      payload: { obrigacaoId: obr.id, codigoOperacional: obr.codigoOperacional, natureza: obr.natureza, valorContratado: Number(obr.valorContratado) } as Prisma.InputJsonValue,
      chaveIdempotencia: chaveEvento('financeiro.obrigacao.criada', obr.id),
    } }).catch(() => { /* já emitido (chave única) — idempotente */ })

    return { obrigacaoId: obr.id, reaproveitada: false }
  })
}

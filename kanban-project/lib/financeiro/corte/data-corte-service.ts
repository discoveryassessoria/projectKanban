// lib/financeiro/corte/data-corte-service.ts
// ============================================================================
// ATIVAÇÃO POR DATA DE CORTE — CORTE LIMPO (Motor Financeiro V3 · Fase 3, opção C).
// Para cada obrigação VIVA, fixa no Ledger o saldo remanescente na data de corte
// e grava o LedgerOpeningBalance. A partir do corte, o Ledger é a fonte oficial.
// - obrigação SEM ledger → ABERTURA no remanescente (D 1.1 / C 9.9);
// - obrigação ESPELHADA (OBRIGACAO_CRIADA no valor cheio) → reconcilia o recebido
//   no legado (D 9.9 / C 1.1) até o remanescente — sem dupla contagem.
// Transacional por obrigação, idempotente (LedgerOpeningBalance único; marcadores
// revertidos podem ser re-cortados). Dry-run por padrão. Rollback operacional por
// flag: estorno APPEND-ONLY no Ledger + marca revertidoEm (não apaga histórico).
// NÃO roda no build; acionado por rota admin protegida.
// ============================================================================
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { registrarLancamento } from '../ledger/ledger-service'
import { lancAbertura, lancReconciliacaoCorte, lancEstorno, type Perna, type Direcao } from '../ledger/lancamentos'
import { resolverCorte, type ObrigacaoCorte } from '../dominio/data-corte'

export interface ItemCorte {
  obrigacaoId: number
  codigoOperacional: string | null
  acao: 'ABERTURA_NOVA' | 'RECONCILIA_ESPELHO' | 'NENHUMA'
  saldoAlvo: number
  valorReconcilia: number
  recebidoLegado: number
  aplicado: boolean
  divergencia?: string | null
  motivo?: string
}

export interface ResumoCorte {
  dataCorte: string
  dryRun: boolean
  totalObrigacoes: number
  aplicaveis: number
  aplicadas: number
  ignoradas: number
  saldoTotalAbertura: number
  divergencias: { obrigacaoId: number; detalhe: string }[]
  itens: ItemCorte[]
}

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

/** Recebido no LEGADO até a data de corte = soma das parcelas pagas da receita. */
async function recebidoLegado(origemId: number | null, dataCorte: Date): Promise<number> {
  if (!origemId) return 0
  const parcelas = await prisma.parcelaFinanceira.findMany({
    where: { receitaId: origemId, dataPagamento: { not: null, lte: dataCorte } },
    select: { valor: true },
  })
  return cent(parcelas.reduce((s, p) => s + Number(p.valor), 0))
}

/**
 * Aplica a data de corte. `dryRun` (default true) só simula/relata; `dryRun:false`
 * grava. Idempotente: obrigação com abertura NÃO revertida é ignorada.
 */
export async function aplicarDataDeCorte(input: {
  dataCorte: Date
  dryRun?: boolean
  criadoPorId?: number | null
}): Promise<ResumoCorte> {
  const dryRun = input.dryRun !== false
  const dataCorte = input.dataCorte

  const obrigacoes = await prisma.obrigacaoEconomica.findMany({
    where: { status: 'ATIVO', direcao: 'A_RECEBER' },
    include: { ledger: { select: { id: true } } },
    orderBy: { id: 'asc' },
  })
  const aberturas = await prisma.ledgerOpeningBalance.findMany({ select: { obrigacaoId: true, revertidoEm: true } })
  // abertura ATIVA (não revertida) → idempotência; revertida → pode re-cortar
  const abertasAtivas = new Set(aberturas.filter((a) => !a.revertidoEm).map((a) => a.obrigacaoId))

  const itens: ItemCorte[] = []
  const divergencias: { obrigacaoId: number; detalhe: string }[] = []
  let aplicadas = 0, aplicaveis = 0

  for (const obr of obrigacoes) {
    const contratado = Number(obr.valorContratado)
    const recebido = await recebidoLegado(obr.origemId, dataCorte)
    // divergência: recebido no legado excede o contratado (dado inconsistente no legado)
    let divergencia: string | null = null
    if (recebido > contratado + 0.005) { divergencia = `recebido no legado (${recebido}) > contratado (${contratado})`; divergencias.push({ obrigacaoId: obr.id, detalhe: divergencia }) }

    const entrada: ObrigacaoCorte = {
      obrigacaoId: obr.id, valorContratado: contratado, recebidoLegado: recebido,
      temLedger: !!obr.ledger, jaTemAbertura: abertasAtivas.has(obr.id),
    }
    const r = resolverCorte(entrada)
    if (r.acao !== 'NENHUMA') aplicaveis++
    const item: ItemCorte = {
      obrigacaoId: obr.id, codigoOperacional: obr.codigoOperacional, acao: r.acao,
      saldoAlvo: r.saldoAlvo, valorReconcilia: r.valorReconcilia, recebidoLegado: recebido,
      aplicado: false, divergencia, motivo: r.motivo,
    }

    if (r.acao !== 'NENHUMA' && !dryRun) {
      await prisma.$transaction(async (tx) => {
        let ledgerId = obr.ledger?.id
        if (!ledgerId) {
          const l = await tx.ledgerFinanceiro.create({ data: { obrigacaoId: obr.id, moedaContabil: obr.moedaContabil } })
          ledgerId = l.id
        }
        const transacaoId = `corte:${obr.id}`
        const lanc = r.acao === 'ABERTURA_NOVA' ? lancAbertura(r.saldoAlvo, true) : lancReconciliacaoCorte(r.valorReconcilia)
        await registrarLancamento(tx, { obrigacaoId: obr.id, ledgerId, transacaoId, lancamento: lanc, moeda: String(obr.moedaContabil), data: dataCorte, criadoPorId: input.criadoPorId ?? null })
        // upsert do marcador (re-corte de abertura revertida)
        await tx.ledgerOpeningBalance.upsert({
          where: { obrigacaoId: obr.id },
          create: { obrigacaoId: obr.id, dataCorte, valorAbertura: r.saldoAlvo, moeda: obr.moedaContabil, transacaoId, origem: 'backfill-corte' },
          update: { dataCorte, valorAbertura: r.saldoAlvo, transacaoId, revertidoEm: null, origem: 'backfill-corte-recorte' },
        })
      })
      item.aplicado = true
      aplicadas++
    }
    itens.push(item)
  }

  return {
    dataCorte: dataCorte.toISOString(), dryRun,
    totalObrigacoes: obrigacoes.length, aplicaveis, aplicadas,
    ignoradas: obrigacoes.length - aplicaveis,
    saldoTotalAbertura: cent(itens.filter((i) => i.acao !== 'NENHUMA').reduce((s, i) => s + i.saldoAlvo, 0)),
    divergencias, itens,
  }
}

export interface ResumoRollback {
  dryRun: boolean
  totalAberturas: number
  revertidas: number
  itens: { obrigacaoId: number; revertido: boolean; valorEstornado: number; motivo?: string }[]
}

/**
 * Rollback OPERACIONAL do corte: para cada abertura ATIVA, posta um ESTORNO
 * (append-only) que anula o lançamento de corte e marca revertidoEm. NÃO apaga
 * entries nem o marcador — o histórico do Ledger é preservado. Idempotente.
 */
export async function reverterDataDeCorte(input: {
  dryRun?: boolean
  obrigacaoIds?: number[]
  criadoPorId?: number | null
}): Promise<ResumoRollback> {
  const dryRun = input.dryRun !== false
  const aberturas = await prisma.ledgerOpeningBalance.findMany({
    where: { revertidoEm: null, ...(input.obrigacaoIds?.length ? { obrigacaoId: { in: input.obrigacaoIds } } : {}) },
    orderBy: { obrigacaoId: 'asc' },
  })

  const itens: ResumoRollback['itens'] = []
  let revertidas = 0

  for (const ab of aberturas) {
    const entries = await prisma.ledgerEntry.findMany({
      where: { obrigacaoId: ab.obrigacaoId, transacaoId: ab.transacaoId },
      select: { contaContabil: true, direcao: true, valorContabil: true, ledgerId: true },
    })
    if (!entries.length) { itens.push({ obrigacaoId: ab.obrigacaoId, revertido: false, valorEstornado: 0, motivo: 'sem lançamento de corte para estornar' }); continue }
    const valorEstornado = cent(entries.filter((e) => e.direcao === 'DEBITO').reduce((s, e) => s + Number(e.valorContabil), 0))

    if (!dryRun) {
      await prisma.$transaction(async (tx) => {
        const pernas: Perna[] = entries.map((e) => ({ conta: e.contaContabil, direcao: e.direcao as Direcao, valor: Number(e.valorContabil) }))
        const estorno = lancEstorno(pernas)
        await registrarLancamento(tx, { obrigacaoId: ab.obrigacaoId, ledgerId: entries[0].ledgerId, transacaoId: `corte-rollback:${ab.obrigacaoId}`, lancamento: estorno, moeda: String(ab.moeda), criadoPorId: input.criadoPorId ?? null })
        await tx.ledgerOpeningBalance.update({ where: { obrigacaoId: ab.obrigacaoId }, data: { revertidoEm: new Date() } })
      })
      revertidas++
    }
    itens.push({ obrigacaoId: ab.obrigacaoId, revertido: !dryRun, valorEstornado })
  }

  return { dryRun, totalAberturas: aberturas.length, revertidas, itens }
}

/** Auditoria completa (append-only) de cada acionamento do corte. */
export async function auditarCorte(usuarioId: number | null, acao: string, resumo: Record<string, unknown>): Promise<void> {
  await prisma.logAuditoria.create({ data: {
    acao, entidade: 'LedgerOpeningBalance', descricao: `Data de corte — ${acao}`,
    detalhes: resumo as Prisma.InputJsonValue, usuarioId: usuarioId ?? undefined,
  } }).catch(() => {})
}

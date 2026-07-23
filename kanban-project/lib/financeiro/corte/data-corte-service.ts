// lib/financeiro/corte/data-corte-service.ts
// ============================================================================
// ATIVAÇÃO POR DATA DE CORTE — CORTE LIMPO (Motor Financeiro V3 · Fase 3, opção C).
// Para cada obrigação VIVA, fixa no Ledger o saldo remanescente na data de corte
// e grava o LedgerOpeningBalance. A partir do corte, o Ledger é a fonte oficial.
// - obrigação SEM ledger → lançamento de ABERTURA no remanescente (D 1.1 / C 9.9);
// - obrigação ESPELHADA (OBRIGACAO_CRIADA no valor cheio) → reconcilia o recebido
//   no legado (D 9.9 / C 1.1), levando o saldo ao remanescente — sem dupla contagem.
// Transacional por obrigação, idempotente (LedgerOpeningBalance único), flag-gated.
// NÃO roda no build; é acionado explicitamente (CLI/rota administrativa).
// ============================================================================
import { prisma } from '@/lib/prisma'
import { registrarLancamento } from '../ledger/ledger-service'
import { lancAbertura, lancReconciliacaoCorte } from '../ledger/lancamentos'
import { resolverCorte, type ObrigacaoCorte } from '../dominio/data-corte'

export interface ResultadoCorteItem {
  obrigacaoId: number
  codigoOperacional: string | null
  acao: 'ABERTURA_NOVA' | 'RECONCILIA_ESPELHO' | 'NENHUMA'
  saldoAlvo: number
  valorReconcilia: number
  aplicado: boolean
  motivo?: string
}

export interface ResultadoCorte {
  dataCorte: string
  dryRun: boolean
  total: number
  aplicadas: number
  itens: ResultadoCorteItem[]
}

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

/** Recebido no LEGADO até a data de corte = soma das parcelas pagas da receita. */
async function recebidoLegadoDaObrigacao(origemId: number | null, dataCorte: Date): Promise<number> {
  if (!origemId) return 0
  const parcelas = await prisma.parcelaFinanceira.findMany({
    where: { receitaId: origemId, dataPagamento: { not: null, lte: dataCorte } },
    select: { valor: true },
  })
  return cent(parcelas.reduce((s, p) => s + Number(p.valor), 0))
}

/**
 * Aplica a data de corte. `dryRun` (default true) só simula e relata; com
 * `dryRun:false` grava. Idempotente: obrigação com LedgerOpeningBalance é pulada.
 */
export async function aplicarDataDeCorte(input: {
  dataCorte: Date
  dryRun?: boolean
  criadoPorId?: number | null
}): Promise<ResultadoCorte> {
  const dryRun = input.dryRun !== false
  const dataCorte = input.dataCorte

  // obrigações VIVAS a receber (as espelhadas + nativas)
  const obrigacoes = await prisma.obrigacaoEconomica.findMany({
    where: { status: 'ATIVO', direcao: 'A_RECEBER' },
    include: { ledger: { select: { id: true } } },
    orderBy: { id: 'asc' },
  })
  const aberturas = await prisma.ledgerOpeningBalance.findMany({ select: { obrigacaoId: true } })
  const jaAbertas = new Set(aberturas.map((a) => a.obrigacaoId))

  const itens: ResultadoCorteItem[] = []
  let aplicadas = 0

  for (const obr of obrigacoes) {
    const recebido = await recebidoLegadoDaObrigacao(obr.origemId, dataCorte)
    const entrada: ObrigacaoCorte = {
      obrigacaoId: obr.id,
      valorContratado: Number(obr.valorContratado),
      recebidoLegado: recebido,
      temLedger: !!obr.ledger,
      jaTemAbertura: jaAbertas.has(obr.id),
    }
    const r = resolverCorte(entrada)
    const item: ResultadoCorteItem = {
      obrigacaoId: obr.id, codigoOperacional: obr.codigoOperacional, acao: r.acao,
      saldoAlvo: r.saldoAlvo, valorReconcilia: r.valorReconcilia, aplicado: false, motivo: r.motivo,
    }

    if (r.acao !== 'NENHUMA' && !dryRun) {
      await prisma.$transaction(async (tx) => {
        // garante ledger (obrigações nativas sempre têm; defensivo p/ casos sem)
        let ledgerId = obr.ledger?.id
        if (!ledgerId) {
          const l = await tx.ledgerFinanceiro.create({ data: { obrigacaoId: obr.id, moedaContabil: obr.moedaContabil } })
          ledgerId = l.id
        }
        const transacaoId = `corte:${obr.id}`
        const lanc = r.acao === 'ABERTURA_NOVA' ? lancAbertura(r.saldoAlvo, true) : lancReconciliacaoCorte(r.valorReconcilia)
        await registrarLancamento(tx, { obrigacaoId: obr.id, ledgerId, transacaoId, lancamento: lanc, moeda: String(obr.moedaContabil), data: dataCorte, criadoPorId: input.criadoPorId ?? null })
        await tx.ledgerOpeningBalance.create({ data: {
          obrigacaoId: obr.id, dataCorte, valorAbertura: r.saldoAlvo, moeda: obr.moedaContabil,
          transacaoId, origem: 'backfill-corte',
        } })
      })
      item.aplicado = true
      aplicadas++
    }
    itens.push(item)
  }

  return { dataCorte: dataCorte.toISOString(), dryRun, total: obrigacoes.length, aplicadas, itens }
}

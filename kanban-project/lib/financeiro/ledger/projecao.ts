// lib/financeiro/ledger/projecao.ts
// ============================================================================
// PROJEÇÃO / REPLAY do Ledger (Motor Financeiro V3). O saldo é SEMPRE derivado
// dos entries — o Ledger é a única fonte da verdade; a materialização é cache.
// PURO. Reconstrói integralmente a partir dos entries (+ opening balance). §4.5/4.6
// ============================================================================
import { CONTA } from './plano-contas'
import type { Direcao } from './lancamentos'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export interface EntryProjecao {
  conta: string
  direcao: Direcao
  valor: number
  sequencia?: number
}

export interface Projecao {
  saldo: number // a receber remanescente (Clientes a Receber: débitos − créditos)
  recebidoBruto: number // caixa líquido + tarifas
  recebidoLiquido: number // caixa
  ultimaSequenciaAplicada: number
}

/** Saldo de uma conta = Σdébitos − Σcréditos (natureza devedora, ex.: a receber). */
function saldoConta(entries: EntryProjecao[], conta: string): number {
  let s = 0
  for (const e of entries) {
    if (e.conta !== conta) continue
    s = cent(s + (e.direcao === 'DEBITO' ? e.valor : -e.valor))
  }
  return cent(s)
}

/** Total lançado a débito numa conta. */
function debitos(entries: EntryProjecao[], conta: string): number {
  return cent(entries.filter((e) => e.conta === conta && e.direcao === 'DEBITO').reduce((s, e) => s + e.valor, 0))
}

/**
 * Reconstrói a projeção a partir de TODOS os entries da obrigação (incluindo o
 * lançamento de abertura, quando houver). Determinístico e idempotente.
 */
export function projetar(entries: EntryProjecao[]): Projecao {
  const saldo = saldoConta(entries, CONTA.CLIENTES_A_RECEBER)
  const recebidoLiquido = saldoConta(entries, CONTA.CAIXA_BANCO)
  const recebidoBruto = cent(recebidoLiquido + debitos(entries, CONTA.TAXAS))
  const ultimaSequenciaAplicada = entries.reduce((m, e) => Math.max(m, e.sequencia ?? 0), 0)
  return { saldo, recebidoBruto, recebidoLiquido, ultimaSequenciaAplicada }
}

/** Status derivado da projeção de saldo (a receber). */
export function statusPorSaldo(saldo: number, houvePagamento: boolean): 'ABERTA' | 'PARCIAL' | 'QUITADA' {
  if (saldo <= 0.004) return 'QUITADA'
  return houvePagamento ? 'PARCIAL' : 'ABERTA'
}

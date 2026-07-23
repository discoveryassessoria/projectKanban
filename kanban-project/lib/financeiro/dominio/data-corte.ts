// lib/financeiro/dominio/data-corte.ts
// ============================================================================
// DATA DE CORTE / SALDO DE ABERTURA (Motor Financeiro V3 · Fase 3). PURO.
// Na data de ativação, para cada obrigação VIVA calcula-se o saldo inicial a
// partir do estado legado (contratado − recebido no legado). Esse saldo entra no
// Ledger como um lançamento de ABERTURA balanceado (D 1.1 / C 9.9) — o histórico
// anterior NÃO é reconstruído (legado fica só-leitura). Ver spec §4.8 / ADR-17.
// ============================================================================

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export interface EntradaObrigacaoCorte {
  obrigacaoId: number
  valorContratado: number
  recebidoLegado: number // total já recebido no modelo LEGADO até a data de corte
  jaTemAbertura?: boolean // se já existe LedgerOpeningBalance (idempotência)
}

export interface AberturaResolvida {
  obrigacaoId: number
  valorAbertura: number // saldo remanescente na data de corte (o que ainda há a receber)
  precisaAbertura: boolean // false se já tem abertura ou saldo ≤ 0
  motivo?: string
}

/**
 * Calcula o saldo de abertura de UMA obrigação na data de corte.
 * Regra: abertura = max(0, contratado − recebido no legado). Não reconstrói
 * pagamentos antigos; apenas fixa o ponto de partida do Ledger.
 */
export function resolverAbertura(o: EntradaObrigacaoCorte): AberturaResolvida {
  if (o.jaTemAbertura) return { obrigacaoId: o.obrigacaoId, valorAbertura: 0, precisaAbertura: false, motivo: 'já possui abertura' }
  const saldo = cent(Math.max(0, cent(o.valorContratado) - cent(o.recebidoLegado)))
  if (saldo <= 0) return { obrigacaoId: o.obrigacaoId, valorAbertura: 0, precisaAbertura: false, motivo: 'saldo legado ≤ 0 (nada a abrir)' }
  return { obrigacaoId: o.obrigacaoId, valorAbertura: saldo, precisaAbertura: true }
}

/** Resolve o plano de abertura para um lote de obrigações (idempotente, puro). */
export function planoDeCorte(obrigacoes: EntradaObrigacaoCorte[]): {
  aberturas: AberturaResolvida[]
  totalAbertura: number
  quantasAbrem: number
} {
  const aberturas = obrigacoes.map(resolverAbertura)
  const abrem = aberturas.filter((a) => a.precisaAbertura)
  return {
    aberturas,
    totalAbertura: cent(abrem.reduce((s, a) => s + a.valorAbertura, 0)),
    quantasAbrem: abrem.length,
  }
}

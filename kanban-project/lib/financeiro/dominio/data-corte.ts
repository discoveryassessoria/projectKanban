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

// ── CORTE LIMPO (opção C): o Ledger passa a ser a fonte na data de corte. ──
// Obrigações já ESPELHADAS pela escrita dupla nasceram com OBRIGACAO_CRIADA no
// valor CHEIO. Para não haver dupla contagem, reconcilia-se o que já foi recebido
// no legado (reduz o "a receber" ao remanescente). Obrigações SEM ledger recebem
// uma abertura nova direta no remanescente.
export type AcaoCorte = 'ABERTURA_NOVA' | 'RECONCILIA_ESPELHO' | 'NENHUMA'

export interface ObrigacaoCorte extends EntradaObrigacaoCorte {
  temLedger: boolean // já existe LedgerFinanceiro/OBRIGACAO_CRIADA (espelho da escrita dupla)
}

export interface CorteResolvido {
  obrigacaoId: number
  acao: AcaoCorte
  saldoAlvo: number // saldo remanescente que o Ledger deve refletir após o corte
  valorReconcilia: number // quanto reduzir do "a receber" (= recebido no legado), quando já há espelho
  motivo?: string
}

/** Decide a ação de corte de UMA obrigação (puro, idempotente). */
export function resolverCorte(o: ObrigacaoCorte): CorteResolvido {
  const base = { obrigacaoId: o.obrigacaoId, saldoAlvo: 0, valorReconcilia: 0 }
  if (o.jaTemAbertura) return { ...base, acao: 'NENHUMA', motivo: 'já possui abertura de corte' }
  const remanescente = cent(Math.max(0, cent(o.valorContratado) - cent(o.recebidoLegado)))
  if (!o.temLedger) {
    if (remanescente <= 0) return { ...base, acao: 'NENHUMA', motivo: 'sem ledger e saldo ≤ 0' }
    return { ...base, acao: 'ABERTURA_NOVA', saldoAlvo: remanescente }
  }
  // já espelhada: o Ledger reflete o CONTRATADO; só reconcilia se houve recebimento no legado
  const recebido = cent(o.recebidoLegado)
  if (recebido <= 0) return { ...base, acao: 'NENHUMA', motivo: 'espelho já reflete o contratado; nada recebido no legado' }
  return { obrigacaoId: o.obrigacaoId, acao: 'RECONCILIA_ESPELHO', saldoAlvo: remanescente, valorReconcilia: recebido }
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

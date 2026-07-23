// lib/financeiro/ledger/lancamentos.ts
// ============================================================================
// Builder PURO de lançamentos contábeis DOUBLE-ENTRY (Motor Financeiro V3).
// Invariante inegociável: Σdébitos = Σcréditos (em centavos). Cada ocorrência
// vira UM lançamento (transacaoId) com 2..N pernas balanceadas.
// Sem Prisma, sem I/O — testável isoladamente. Ver spec §4.3.
// ============================================================================
import { CONTA, type CodigoConta } from './plano-contas'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export type Direcao = 'DEBITO' | 'CREDITO'

export interface Perna {
  conta: string
  direcao: Direcao
  valor: number
}

export interface Lancamento {
  tipo: string
  pernas: Perna[]
}

/** Soma de débitos e créditos (centavos). */
export function somas(pernas: Perna[]): { debitos: number; creditos: number } {
  let d = 0, c = 0
  for (const p of pernas) {
    if (p.direcao === 'DEBITO') d = cent(d + p.valor)
    else c = cent(c + p.valor)
  }
  return { debitos: cent(d), creditos: cent(c) }
}

/** true quando Σdébitos = Σcréditos. */
export function balanceado(pernas: Perna[]): boolean {
  const { debitos, creditos } = somas(pernas)
  return Math.abs(debitos - creditos) < 0.005
}

/** Monta o lançamento validando o balanceamento (lança se desbalanceado). */
export function montarLancamento(tipo: string, pernas: Perna[]): Lancamento {
  const limpas = pernas.filter((p) => cent(p.valor) !== 0).map((p) => ({ ...p, valor: cent(p.valor) }))
  if (limpas.length < 2) throw new Error(`Lançamento ${tipo} exige ao menos 2 pernas.`)
  if (!balanceado(limpas)) {
    const s = somas(limpas)
    throw new Error(`Lançamento ${tipo} desbalanceado: débitos ${s.debitos} ≠ créditos ${s.creditos}.`)
  }
  return { tipo, pernas: limpas }
}

const D = (conta: CodigoConta, valor: number): Perna => ({ conta, direcao: 'DEBITO', valor })
const C = (conta: CodigoConta, valor: number): Perna => ({ conta, direcao: 'CREDITO', valor })

/** Conta "a realizar" e "a liquidar" conforme a direção do contrato. */
function contas(aReceber: boolean) {
  return aReceber
    ? { liquidar: CONTA.CLIENTES_A_RECEBER, resultado: CONTA.RECEITA_A_REALIZAR }
    : { liquidar: CONTA.FORNECEDORES_A_PAGAR, resultado: CONTA.RECEITA_A_REALIZAR }
}

// ── Builders por ocorrência ─────────────────────────────────────────────────

/** Obrigação criada: reconhece o a receber/pagar contra a receita a realizar. */
export function lancObrigacaoCriada(valor: number, aReceber: boolean): Lancamento {
  const k = contas(aReceber)
  return aReceber
    ? montarLancamento('OBRIGACAO_CRIADA', [D(k.liquidar as CodigoConta, valor), C(CONTA.RECEITA_A_REALIZAR, valor)])
    : montarLancamento('OBRIGACAO_CRIADA', [D(CONTA.RECEITA_A_REALIZAR, valor), C(k.liquidar as CodigoConta, valor)])
}

/** Saldo de abertura (data de corte): entra o a receber contra saldo de abertura. */
export function lancAbertura(valor: number, aReceber: boolean): Lancamento {
  return aReceber
    ? montarLancamento('ABERTURA', [D(CONTA.CLIENTES_A_RECEBER, valor), C(CONTA.SALDO_ABERTURA, valor)])
    : montarLancamento('ABERTURA', [D(CONTA.SALDO_ABERTURA, valor), C(CONTA.FORNECEDORES_A_PAGAR, valor)])
}

/**
 * Pagamento (recebimento): quita `valorQuitado` do a receber; a tarifa bancária
 * reduz o líquido em caixa; a diferença cambial é uma perna própria.
 *   D Caixa (líquido) + D Taxas (tarifa) [+ D/C Diferença] / C Clientes a Receber (quitado)
 */
export function lancPagamento(input: {
  valorQuitado: number
  tarifa?: number
  diferencaCambial?: number // >0 recebeu a mais; <0 a menos
}): Lancamento {
  const quitado = cent(input.valorQuitado)
  const tarifa = cent(input.tarifa ?? 0)
  const dif = cent(input.diferencaCambial ?? 0)
  const liquidoCaixa = cent(quitado - tarifa + dif)
  const pernas: Perna[] = [D(CONTA.CAIXA_BANCO, liquidoCaixa), C(CONTA.CLIENTES_A_RECEBER, quitado)]
  if (tarifa > 0) pernas.push(D(CONTA.TAXAS, tarifa))
  if (dif > 0) pernas.push(C(CONTA.DIFERENCA_CAMBIAL, dif))
  else if (dif < 0) pernas.push(D(CONTA.DIFERENCA_CAMBIAL, -dif))
  return montarLancamento('PAGAMENTO', pernas)
}

/** Desconto concedido: reduz o a receber contra a conta de descontos. */
export function lancDesconto(valor: number): Lancamento {
  return montarLancamento('DESCONTO', [D(CONTA.DESCONTOS, valor), C(CONTA.CLIENTES_A_RECEBER, valor)])
}

/** Juros/multa: aumenta o a receber contra encargos. */
export function lancEncargo(valor: number, tipo: 'JUROS' | 'MULTA' = 'JUROS'): Lancamento {
  return montarLancamento(tipo, [D(CONTA.CLIENTES_A_RECEBER, valor), C(CONTA.ENCARGOS, valor)])
}

/** Estorno: inverte as pernas de um lançamento original (novo lançamento). */
export function lancEstorno(pernasOriginais: Perna[]): Lancamento {
  const invertidas = pernasOriginais.map((p) => ({ ...p, direcao: (p.direcao === 'DEBITO' ? 'CREDITO' : 'DEBITO') as Direcao }))
  return montarLancamento('ESTORNO', invertidas)
}

/** Baixa (write-off): encerra o a receber sem recurso (contra resultado). */
export function lancBaixa(valor: number): Lancamento {
  return montarLancamento('BAIXA', [D(CONTA.DESCONTOS, valor), C(CONTA.CLIENTES_A_RECEBER, valor)])
}

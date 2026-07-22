// lib/financeiro/classificacao-requerente.ts
// ============================================================================
// CLASSIFICAÇÃO DETERMINÍSTICA de requerentes (primeiro × adicional) e cálculo
// individual (itemização), SEMPRE via FinanceRuleEngine (calcularPreco). PURO.
//
// Ordem determinística e persistente (nunca ordem visual/SELECT/alfabética):
//   1) ordem persistida (se existir) — hoje inexistente em ProcessoRequerente;
//   2) timestamp do vínculo — hoje inexistente;
//   3) createdAt da Pessoa;
//   4) id estável (desempate).
// Como (1) e (2) não existem no schema atual, a ordem efetiva é (createdAt, id),
// ambos persistentes e reproduzíveis.
//
// Valor individual: usa o MOTOR (calcularPreco) de forma MARGINAL —
//   valor(posição) = total(posição) − total(posição−1).
// Assim o 1º requerente recebe exatamente o valorBase e cada adicional o
// valorAdicional, SEM repetir a fórmula fora do motor.
// ============================================================================
import { calcularPreco } from './calculo-preco'

export type Classificacao = 'primeiro' | 'adicional'

export interface RequerenteOrdenavel {
  pessoaId: number
  /** createdAt persistente (Date, ISO string ou epoch ms). */
  createdAt: Date | string | number | null | undefined
}

const ms = (v: RequerenteOrdenavel['createdAt']): number => {
  if (v == null) return Number.POSITIVE_INFINITY // sem data → vai para o fim (desempate por id)
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY
}

/** Ordena determinística por (createdAt asc, pessoaId asc). Retorna os pessoaId em ordem. */
export function ordenarRequerentes(lista: RequerenteOrdenavel[]): number[] {
  return [...lista]
    .sort((a, b) => (ms(a.createdAt) - ms(b.createdAt)) || (a.pessoaId - b.pessoaId))
    .map((r) => r.pessoaId)
}

/** Posição (1-based) e classificação de um requerente na ordem determinística. */
export function classificarRequerente(pessoaId: number, ordenados: number[]): { posicao: number; classificacao: Classificacao } | null {
  const idx = ordenados.indexOf(pessoaId)
  if (idx < 0) return null
  const posicao = idx + 1
  return { posicao, classificacao: posicao === 1 ? 'primeiro' : 'adicional' }
}

export interface ParametrosLinha {
  modoCalculo: string | null | undefined
  valor: number
  valorBase: number | null
  valorAdicional: number | null
}

/**
 * Valor INDIVIDUAL do requerente na `posicao`, via motor (marginal). Fonte única
 * de cálculo — nenhuma fórmula base/adicional é repetida aqui.
 */
export function valorDoRequerente(posicao: number, linha: ParametrosLinha): { total: number; memoria: string } {
  const total = (n: number) => (n <= 0 ? 0 : calcularPreco({ modoCalculo: linha.modoCalculo, valor: linha.valor, valorBase: linha.valorBase, valorAdicional: linha.valorAdicional, quantidade: n }).total)
  const marginal = Math.round((total(posicao) - total(posicao - 1)) * 100) / 100
  const rotulo = posicao === 1 ? 'primeiro (valorBase)' : `adicional #${posicao - 1} (valorAdicional)`
  return { total: marginal, memoria: `Requerente ${rotulo}: total(${posicao}) − total(${posicao - 1}) = ${marginal.toFixed(2)}` }
}

/**
 * Chave de idempotência POR REQUERENTE (processo + serviço/config + automação +
 * requerente). Vai em MotorArtefato.automaticKey (@unique). Nunca gera dois
 * honorários para o mesmo requerente.
 */
export function chaveIdempotenciaRequerente(p: { processoId: number; configId: number; ruleId: number; pessoaId: number }): string {
  return `${p.processoId}::cfg:${p.configId}::rule:${p.ruleId}::req:${p.pessoaId}::VENDA`
}

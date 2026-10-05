// lib/financeiro/leitura/totais-a-receber.ts
// ============================================================================
// OS TOTAIS DE "A RECEBER" — UMA função para a aba A Receber e para a Central do Financeiro.
//
// Módulo PURO (sem Prisma): serve à API e ao cliente. Cada valor já vem em REAIS de `listarObrigacoes()` (`saldoBrl`,
// `recebidoBrl`), convertido pela regra de câmbio da própria obrigação (taxa estimada gravada na receita; ver `computeCambioAging`).
// Aqui NÃO há conta de câmbio: só soma e classifica. Assim as duas telas não têm como divergir.
//
// Definições (as da aba A Receber):
//   • em aberto  = direção A_RECEBER e saldo > 0
//   • vencida    = em aberto, com vencimento, e dias até o vencimento < 0   (dias = arredondado para cima)
//   • a vencer N = em aberto, com vencimento, e 0 ≤ dias ≤ N
//   • sem vencimento nunca é vencida nem "a vencer": só entra no total em aberto.
// ============================================================================
const EPS = 0.005
const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export interface ObrigacaoParaTotais {
  direcao: string
  saldo: number
  saldoBrl: number
  recebidoBrl: number
  vencimento: string | null
}

/** Dias até o vencimento (arredondado para cima). Sem vencimento = null. */
export function diasAteVencimento(venc: string | null, agora: Date): number | null {
  if (!venc) return null
  const t = new Date(venc).getTime()
  return Number.isNaN(t) ? null : Math.ceil((t - agora.getTime()) / 86_400_000)
}

export const estaEmAbertoAReceber = (o: Pick<ObrigacaoParaTotais, 'direcao' | 'saldo'>) => o.direcao === 'A_RECEBER' && o.saldo > EPS
export function estaVencida(o: ObrigacaoParaTotais, agora: Date): boolean {
  const d = diasAteVencimento(o.vencimento, agora)
  return estaEmAbertoAReceber(o) && d != null && d < 0
}
export function venceEm(o: ObrigacaoParaTotais, agora: Date, dias: number): boolean {
  const d = diasAteVencimento(o.vencimento, agora)
  return estaEmAbertoAReceber(o) && d != null && d >= 0 && d <= dias
}

export interface TotaisAReceber {
  /** Total a receber: soma do saldo em aberto, em R$. */
  totalReceberBRL: number
  qtdEmAberto: number
  totalVencidoBRL: number
  qtdVencidas: number
  /** A vencer no horizonte pedido. */
  totalAVencerBRL: number
  qtdAVencer: number
  /** Já recebido (Ledger), em R$ — de todas as obrigações A_RECEBER. */
  totalRecebidoBRL: number
}

export function totaisAReceber(obrigacoes: ObrigacaoParaTotais[], agora: Date, horizonteDias = 30): TotaisAReceber {
  const aReceber = obrigacoes.filter((o) => o.direcao === 'A_RECEBER')
  const abertas = aReceber.filter(estaEmAbertoAReceber)
  const vencidas = aReceber.filter((o) => estaVencida(o, agora))
  const aVencer = aReceber.filter((o) => venceEm(o, agora, horizonteDias))
  const soma = (arr: ObrigacaoParaTotais[], f: (o: ObrigacaoParaTotais) => number) => cent(arr.reduce((a, o) => a + f(o), 0))
  return {
    totalReceberBRL: soma(abertas, (o) => o.saldoBrl),
    qtdEmAberto: abertas.length,
    totalVencidoBRL: soma(vencidas, (o) => o.saldoBrl),
    qtdVencidas: vencidas.length,
    totalAVencerBRL: soma(aVencer, (o) => o.saldoBrl),
    qtdAVencer: aVencer.length,
    totalRecebidoBRL: soma(aReceber, (o) => o.recebidoBrl),
  }
}

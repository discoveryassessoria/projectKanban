// lib/financeiro/dominio/posicao-requerente.ts
// ============================================================================
// POSIÇÃO ECONÔMICA POR REQUERENTE (Motor Financeiro V3 · Fase 2). PURO.
// Informativo — NUNCA cria dívida interna entre requerentes. Distribuição
// (quem participa) é independente do pagador (quem paga). Ver spec §5.
// ============================================================================

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export interface PosicaoRequerente {
  pessoaId: number
  participacao: number // cota econômica
  pago: number // total que esta pessoa pagou (como pagador)
  pagoEmNomeDeTerceiros: number // informativo: pagou além da própria participação
  saldoEconomico: number // participacao − pago (o que ainda deve da própria cota; pode ser negativo)
}

/**
 * Cruza as COTAS (distribuição econômica) com os PAGAMENTOS por pagador. Não há
 * obrigação interna: só se informa participação, pago, pago-por-terceiros e saldo.
 */
export function posicaoPorRequerente(
  cotas: { pessoaId: number; valor: number }[],
  pagamentosPorPessoa: { pessoaId: number; valor: number }[],
): PosicaoRequerente[] {
  const pagoDe = new Map<number, number>()
  for (const p of pagamentosPorPessoa) pagoDe.set(p.pessoaId, cent((pagoDe.get(p.pessoaId) ?? 0) + p.valor))

  // pessoas que participam OU que pagaram (um pagador pode não participar)
  const ids = new Set<number>([...cotas.map((c) => c.pessoaId), ...pagamentosPorPessoa.map((p) => p.pessoaId)])
  const participacaoDe = new Map<number, number>()
  for (const c of cotas) participacaoDe.set(c.pessoaId, cent((participacaoDe.get(c.pessoaId) ?? 0) + c.valor))

  const out: PosicaoRequerente[] = []
  for (const id of ids) {
    const participacao = cent(participacaoDe.get(id) ?? 0)
    const pago = cent(pagoDe.get(id) ?? 0)
    const pagoEmNomeDeTerceiros = cent(Math.max(0, pago - participacao))
    const saldoEconomico = cent(participacao - pago)
    out.push({ pessoaId: id, participacao, pago, pagoEmNomeDeTerceiros, saldoEconomico })
  }
  return out.sort((a, b) => a.pessoaId - b.pessoaId)
}

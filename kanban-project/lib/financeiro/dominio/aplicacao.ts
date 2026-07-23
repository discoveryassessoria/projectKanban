// lib/financeiro/dominio/aplicacao.ts
// ============================================================================
// APLICAÇÃO DE PAGAMENTO (Motor Financeiro V3 · Fase 2). PURO. Decide a quais
// parcelas um valor é imputado — NUNCA implícito. Excedente é sempre devolvido
// (o destino é escolhido explicitamente pelo chamador). Ver spec §10/§11.
// ============================================================================

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export type PoliticaAplicacao = 'FIFO' | 'PARCELA_ESPECIFICA' | 'PROPORCIONAL' | 'MANUAL'

export interface ParcelaAberta {
  parcelaId: number
  saldoAberto: number
  vencimento?: Date | string | null
  numero?: number
}
export interface AplicacaoResolvida { parcelaId: number; valor: number }
export interface ResultadoAplicacao {
  aplicacoes: AplicacaoResolvida[]
  totalAplicado: number
  excedente: number // valor que sobrou (destino é decisão explícita do chamador)
  erros: string[]
}

const ordFifo = (a: ParcelaAberta, b: ParcelaAberta) => {
  const va = a.vencimento ? new Date(a.vencimento).getTime() : 0
  const vb = b.vencimento ? new Date(b.vencimento).getTime() : 0
  return va - vb || (a.numero ?? 0) - (b.numero ?? 0) || a.parcelaId - b.parcelaId
}

/**
 * Resolve a aplicação de `valor` sobre `parcelas` conforme a política. O
 * excedente (valor > saldo total, ou sobra após aplicar) volta em `excedente`.
 */
export function aplicar(
  valor: number,
  parcelas: ParcelaAberta[],
  politica: PoliticaAplicacao,
  opts?: { parcelaId?: number; manual?: { parcelaId: number; valor: number }[] },
): ResultadoAplicacao {
  const erros: string[] = []
  let restante = cent(valor)
  if (!(restante > 0)) return { aplicacoes: [], totalAplicado: 0, excedente: 0, erros: ['Valor deve ser > 0.'] }
  const abertas = parcelas.map((p) => ({ ...p, saldoAberto: cent(p.saldoAberto) })).filter((p) => p.saldoAberto > 0)
  const aplicacoes: AplicacaoResolvida[] = []

  if (politica === 'MANUAL') {
    for (const m of opts?.manual ?? []) {
      const p = abertas.find((x) => x.parcelaId === m.parcelaId)
      const v = cent(m.valor)
      if (!p) { erros.push(`Parcela ${m.parcelaId} não está aberta.`); continue }
      if (v > p.saldoAberto + 0.005) erros.push(`Aplicação ${v} > saldo ${p.saldoAberto} da parcela ${m.parcelaId}.`)
      const aplic = Math.min(v, p.saldoAberto)
      if (aplic > 0) { aplicacoes.push({ parcelaId: p.parcelaId, valor: aplic }); restante = cent(restante - aplic) }
    }
    return { aplicacoes, totalAplicado: cent(aplicacoes.reduce((s, a) => s + a.valor, 0)), excedente: cent(Math.max(0, restante)), erros }
  }

  if (politica === 'PARCELA_ESPECIFICA') {
    const p = abertas.find((x) => x.parcelaId === opts?.parcelaId)
    if (!p) return { aplicacoes: [], totalAplicado: 0, excedente: cent(restante), erros: ['Parcela específica não encontrada/aberta.'] }
    const aplic = Math.min(restante, p.saldoAberto)
    aplicacoes.push({ parcelaId: p.parcelaId, valor: aplic })
    return { aplicacoes, totalAplicado: aplic, excedente: cent(restante - aplic), erros }
  }

  if (politica === 'PROPORCIONAL') {
    const totalSaldo = cent(abertas.reduce((s, p) => s + p.saldoAberto, 0))
    if (totalSaldo <= 0) return { aplicacoes: [], totalAplicado: 0, excedente: cent(restante), erros }
    const aplicavel = Math.min(restante, totalSaldo)
    let acum = 0
    abertas.forEach((p, i) => {
      const ultima = i === abertas.length - 1
      const v = ultima ? cent(aplicavel - acum) : cent((aplicavel * p.saldoAberto) / totalSaldo)
      acum = cent(acum + v)
      if (v > 0) aplicacoes.push({ parcelaId: p.parcelaId, valor: Math.min(v, p.saldoAberto) })
    })
    return { aplicacoes, totalAplicado: cent(aplicacoes.reduce((s, a) => s + a.valor, 0)), excedente: cent(restante - aplicavel), erros }
  }

  // FIFO (default): quita da mais antiga para a mais nova.
  for (const p of [...abertas].sort(ordFifo)) {
    if (restante <= 0) break
    const aplic = Math.min(restante, p.saldoAberto)
    aplicacoes.push({ parcelaId: p.parcelaId, valor: aplic })
    restante = cent(restante - aplic)
  }
  return { aplicacoes, totalAplicado: cent(aplicacoes.reduce((s, a) => s + a.valor, 0)), excedente: cent(Math.max(0, restante)), erros }
}

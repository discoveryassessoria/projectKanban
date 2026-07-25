// lib/financeiro/dominio/calculo-recebimento.ts
// ============================================================================
// FONTE ÚNICA de cálculo de um recebimento (Registrar Pagamento). Puro, sem I/O,
// testável isoladamente. Reutilizado pelo FRONTEND (reatividade) e REVALIDADO no
// BACKEND (rejeita payload cujos totais não batam). Centavos inteiros — nunca
// floating-point inseguro. Ver spec Financeiro do Processo (recebimento).
// ============================================================================

export type SituacaoRecebimento = 'INICIAL' | 'PARCIAL' | 'QUITADO' | 'EXCEDENTE'

export interface LinhaValor { valor: number }
export interface EntradaCalculoRecebimento {
  saldoSelecionado: number
  linhas: LinhaValor[]
  desconto?: number
  juros?: number
  multa?: number
  acrescimo?: number
  creditoUtilizado?: number
}
export interface ResultadoCalculoRecebimento {
  totalInformado: number
  valorLiquidoDevido: number
  saldoRestante: number
  excedente: number
  situacao: SituacaoRecebimento
}

/** Centavos inteiros a partir de reais (evita erro de ponto flutuante). */
export const emCentavos = (v: number): number => Math.round((Number(v) || 0) * 100)
/** Reais (2 casas) a partir de centavos inteiros. */
export const emReais = (c: number): number => Math.round(c) / 100
const max0 = (c: number): number => (c > 0 ? c : 0)

/**
 * Calcula o recebimento em centavos inteiros e converte de volta a reais.
 *   valorLiquidoDevido = saldo − desconto − créditoUtilizado + juros + multa + acréscimo
 *   totalInformado     = Σ linhas com valor > 0
 *   saldoRestante      = max(0, líquido − total)
 *   excedente          = max(0, total − líquido)
 * Situação: total=0 → INICIAL · 0<total<líquido → PARCIAL · =→QUITADO · >→EXCEDENTE.
 */
export function calcularRecebimento(e: EntradaCalculoRecebimento): ResultadoCalculoRecebimento {
  const saldo = emCentavos(e.saldoSelecionado)
  const desconto = max0(emCentavos(e.desconto ?? 0))
  const juros = max0(emCentavos(e.juros ?? 0))
  const multa = max0(emCentavos(e.multa ?? 0))
  const acrescimo = max0(emCentavos(e.acrescimo ?? 0))
  const credito = max0(emCentavos(e.creditoUtilizado ?? 0))

  const totalInformadoC = (e.linhas ?? []).reduce((s, l) => { const v = emCentavos(l.valor); return v > 0 ? s + v : s }, 0)
  const liquidoC = max0(saldo - desconto - credito + juros + multa + acrescimo)
  const saldoRestanteC = max0(liquidoC - totalInformadoC)
  const excedenteC = max0(totalInformadoC - liquidoC)

  let situacao: SituacaoRecebimento
  if (totalInformadoC <= 0) situacao = 'INICIAL'
  else if (totalInformadoC < liquidoC) situacao = 'PARCIAL'
  else if (totalInformadoC === liquidoC) situacao = 'QUITADO'
  else situacao = 'EXCEDENTE'

  return {
    totalInformado: emReais(totalInformadoC),
    valorLiquidoDevido: emReais(liquidoC),
    saldoRestante: emReais(saldoRestanteC),
    excedente: emReais(excedenteC),
    situacao,
  }
}

/** true quando os totais enviados pelo cliente batem com o recálculo (tolerância de 1 centavo). */
export function totaisConsistentes(
  entrada: EntradaCalculoRecebimento,
  enviados: { totalInformado?: number; saldoRestante?: number; excedente?: number },
): boolean {
  const r = calcularRecebimento(entrada)
  const ok = (a?: number, b?: number) => a == null || Math.abs(emCentavos(a) - emCentavos(b ?? 0)) <= 1
  return ok(enviados.totalInformado, r.totalInformado) && ok(enviados.saldoRestante, r.saldoRestante) && ok(enviados.excedente, r.excedente)
}

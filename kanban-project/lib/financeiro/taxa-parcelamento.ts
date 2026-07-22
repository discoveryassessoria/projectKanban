// lib/financeiro/taxa-parcelamento.ts
// ============================================================================
// TABELA DE PARCELAMENTO DE UMA TAXA — a tabela comercial da adquirente inteira
// dentro de UM único cadastro de Taxa de Pagamento.
//
//   Parcelas   Percentual   Valor fixo   Antecipação
//   1x         2,99%        R$ 0,00      Não
//   2x         3,39%        R$ 0,00      Não
//   3–6x       4,19%        R$ 0,00      Não
//
// Regras:
//   • cada linha cobre uma quantidade de parcelas (de = até) ou uma FAIXA;
//   • faixas NÃO podem se sobrepor — uma quantidade de parcelas resolve para
//     no máximo uma linha (senão a cobrança seria ambígua);
//   • tabela VAZIA = comportamento anterior: vale o percentual/valor fixo do
//     próprio registro da Taxa (nada quebra em quem já estava cadastrado);
//   • tabela PREENCHIDA = a taxa só se aplica às quantidades que ela cobre.
//
// Ao gerar a cobrança: escolhe-se a forma e a quantidade de parcelas; o sistema
// acha a linha correspondente e aplica exatamente aquela taxa. Sem regra extra,
// sem um cadastro de taxa por quantidade de parcelas.
//
// Módulo PURO nas regras (testável sem banco); só `regravarLinhas` toca o Prisma.
// ============================================================================

import type { Prisma } from '@prisma/client'

export interface LinhaParcelamento {
  parcelasDe: number
  parcelasAte: number
  feePercent: number | null
  fixedFee: number | null
  antecipacao: boolean
}

export interface ErroParcelamento { campo: string; mensagem: string }

const inteiro = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}
const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Campo do body que carrega a tabela (aceita o nome curto e o explícito). */
const CAMPOS = ['parcelamento', 'tabelaParcelamento']

/** O body declarou a tabela? Ausente ≠ vazia (PUT parcial não apaga a tabela). */
export function tabelaPresente(b: Record<string, unknown>): boolean {
  return CAMPOS.some((c) => c in b)
}

/**
 * Normaliza as linhas recebidas. Linha sem quantidade de parcelas válida é
 * descartada; `parcelasAte` ausente vira uma linha de parcela única.
 */
export function linhasDoBody(b: Record<string, unknown>): LinhaParcelamento[] {
  let bruto: unknown = null
  for (const c of CAMPOS) if (c in b) { bruto = b[c]; break }
  if (!Array.isArray(bruto)) return []

  const linhas: LinhaParcelamento[] = []
  for (const item of bruto) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const de = inteiro(r.parcelasDe ?? r.de)
    if (de === null || de < 1) continue
    const ate = inteiro(r.parcelasAte ?? r.ate) ?? de
    linhas.push({
      parcelasDe: de,
      parcelasAte: Math.max(de, ate),
      feePercent: numero(r.feePercent ?? r.percentual),
      fixedFee: numero(r.fixedFee ?? r.valorFixo),
      antecipacao: !!(r.antecipacao ?? r.anticipation),
    })
  }
  return linhas.sort((a, b2) => a.parcelasDe - b2.parcelasDe || a.parcelasAte - b2.parcelasAte)
}

/** Valida a tabela: limites coerentes e nenhuma sobreposição entre linhas. */
export function validarTabela(linhas: LinhaParcelamento[]): ErroParcelamento[] {
  const erros: ErroParcelamento[] = []
  const ordenadas = [...linhas].sort((a, b) => a.parcelasDe - b.parcelasDe || a.parcelasAte - b.parcelasAte)

  for (const l of ordenadas) {
    if (l.parcelasDe < 1) erros.push({ campo: 'parcelamento', mensagem: 'A parcela inicial precisa ser no mínimo 1.' })
    if (l.parcelasAte < l.parcelasDe) erros.push({ campo: 'parcelamento', mensagem: `Faixa inválida: ${l.parcelasDe}–${l.parcelasAte}.` })
    if (l.feePercent != null && l.feePercent < 0) erros.push({ campo: 'parcelamento', mensagem: 'Percentual não pode ser negativo.' })
    if (l.fixedFee != null && l.fixedFee < 0) erros.push({ campo: 'parcelamento', mensagem: 'Valor fixo não pode ser negativo.' })
  }

  for (let i = 1; i < ordenadas.length; i++) {
    const a = ordenadas[i - 1], b = ordenadas[i]
    if (b.parcelasDe <= a.parcelasAte) {
      erros.push({
        campo: 'parcelamento',
        mensagem: `Faixas sobrepostas: ${a.parcelasDe}–${a.parcelasAte} e ${b.parcelasDe}–${b.parcelasAte}. Cada quantidade de parcelas só pode cair em uma linha.`,
      })
    }
  }
  return erros
}

/**
 * Linha que cobre `nParcelas`. Nenhuma linha = null (a taxa usa os valores do
 * próprio registro). Regra pura — é o que a cobrança usa.
 */
export function linhaParaParcelas(linhas: LinhaParcelamento[] | null | undefined, nParcelas: number): LinhaParcelamento | null {
  if (!linhas || linhas.length === 0) return null
  const n = Math.max(1, Math.trunc(nParcelas || 1))
  return linhas.find((l) => n >= l.parcelasDe && n <= l.parcelasAte) ?? null
}

/** Rótulo de exibição da linha: "1x" ou "3–6x". */
export function rotuloLinha(l: { parcelasDe: number; parcelasAte: number }): string {
  return l.parcelasDe === l.parcelasAte ? `${l.parcelasDe}x` : `${l.parcelasDe}–${l.parcelasAte}x`
}

/** Linhas para gravação aninhada (create). Vazio = sem tabela. */
export function linhasParaCriar(linhas: LinhaParcelamento[]) {
  if (!linhas.length) return undefined
  return { create: linhas.map((l, i) => ({ ...l, ordem: i })) }
}

/** Regrava a tabela de uma taxa existente (dentro de transação). */
export async function regravarLinhas(tx: Prisma.TransactionClient, taxaId: number, linhas: LinhaParcelamento[]) {
  await tx.taxaParcelamento.deleteMany({ where: { taxaId } })
  if (linhas.length) {
    await tx.taxaParcelamento.createMany({ data: linhas.map((l, i) => ({ ...l, taxaId, ordem: i })) })
  }
}

/** Include padrão: a tabela sempre viaja junto com a taxa (sem N+1). */
export const INCLUDE_PARCELAMENTO = {
  parcelamento: { orderBy: { parcelasDe: 'asc' } },
} as const

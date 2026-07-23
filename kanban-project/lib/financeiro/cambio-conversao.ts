// lib/financeiro/cambio-conversao.ts
// ============================================================================
// CONVERSÃO CAMBIAL — direção + aplicação da cotação. PURO (sem Prisma).
//
// A cotação é sempre armazenada/usada como ORIGEM→DESTINO:
//   valorDestino = valorOrigem × cotacao
// Assim EUR→BRL (cotacao 6,11) e BRL→EUR (cotacao 0,163) usam a MESMA fórmula —
// a "direção" é só rótulo para a UI/snapshot. Quando a base disponível é o par
// inverso (DESTINO→ORIGEM), a cotação efetiva é 1/taxa (inversão explícita).
//
// Precisão: a cotação guarda 6 casas; cada valor convertido é arredondado a 2
// casas (centavos), meia-para-cima — sem acúmulo de erro de float.
// ============================================================================

export type DirecaoConversao = 'MESMA' | 'DIRETA' | 'INVERSA'

const round2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100
const round6 = (v: number) => Math.round((Number(v) || 0) * 1e6) / 1e6

/** Direção lógica entre duas moedas (só rótulo). */
export function direcaoConversao(origem: string, destino: string): DirecaoConversao {
  const o = String(origem || '').toUpperCase(), d = String(destino || '').toUpperCase()
  if (!o || !d || o === d) return 'MESMA'
  return 'DIRETA'
}

/** Precisa de cotação? (origem ≠ destino) */
export function exigeCotacao(origem: string, destino: string): boolean {
  return String(origem || '').toUpperCase() !== String(destino || '').toUpperCase()
}

/**
 * Cotação efetiva ORIGEM→DESTINO a partir de uma linha de cotação da base.
 * Se a base é (origem→destino), usa a taxa direto; se é (destino→origem),
 * inverte (1/taxa). Retorna null se a linha não serve para o par.
 */
export function cotacaoEfetiva(
  origem: string, destino: string,
  linha: { moedaDe: string; moedaPara: string; taxa: number },
): { cotacao: number; direcao: DirecaoConversao } | null {
  const o = String(origem).toUpperCase(), d = String(destino).toUpperCase()
  const de = String(linha.moedaDe).toUpperCase(), para = String(linha.moedaPara).toUpperCase()
  const taxa = Number(linha.taxa)
  if (!(taxa > 0)) return null
  if (de === o && para === d) return { cotacao: round6(taxa), direcao: 'DIRETA' }
  if (de === d && para === o) return { cotacao: round6(1 / taxa), direcao: 'INVERSA' }
  return null
}

/** valorDestino = valorOrigem × cotacao (arredondado a centavos). */
export function converter(valorOrigem: number, cotacao: number): number {
  return round2(Number(valorOrigem) * Number(cotacao))
}

/** valorOrigem = valorDestino ÷ cotacao (arredondado a centavos). */
export function converterInverso(valorDestino: number, cotacao: number): number {
  if (!(Number(cotacao) > 0)) return 0
  return round2(Number(valorDestino) / Number(cotacao))
}

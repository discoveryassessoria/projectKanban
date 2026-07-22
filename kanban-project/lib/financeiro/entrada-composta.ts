// lib/financeiro/entrada-composta.ts
// ============================================================================
// ENTRADA COMPOSTA — a entrada NÃO é uma condição separada; é uma composição da
// cobrança: entrada no ato (forma PIX/Transferência) + saldo parcelado em outra
// forma (cartão/boleto). PURO: valida e reparte; não persiste.
//   Ex.: entrada PIX no ato + saldo em 6x no cartão.
// ============================================================================
import { validarFormaEntrada, validarParcelamentoPorNatureza, type ErroRegra } from './regras-forma-natureza'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export interface EntradaCompostaInput {
  valorTotal: number
  entrada: { tipoForma: string; tipo?: 'PERCENTUAL' | 'VALOR_FIXO'; valor: number } // valor = % ou R$
  saldo: { tipoForma: string; nParcelas: number }
}

export interface ParcelaComposta { numero: number; valor: number; entrada: boolean; tipoForma: string }
export interface ResultadoEntradaComposta {
  ok: boolean
  erros: ErroRegra[]
  valorEntrada: number
  valorSaldo: number
  parcelas: ParcelaComposta[]
}

/** Valida e compõe entrada + saldo. Determinístico; última parcela absorve centavos. */
export function comporEntrada(input: EntradaCompostaInput): ResultadoEntradaComposta {
  const erros: ErroRegra[] = []
  const total = cent(input.valorTotal)

  // 1. forma da entrada só PIX/Transferência
  const eForma = validarFormaEntrada(input.entrada.tipoForma)
  if (eForma) erros.push(eForma)

  // 2. valor da entrada
  const valorEntrada = input.entrada.tipo === 'VALOR_FIXO'
    ? cent(input.entrada.valor)
    : cent((total * (Number(input.entrada.valor) || 0)) / 100)
  if (valorEntrada <= 0) erros.push({ codigo: 'ENTRADA_INVALIDA', mensagem: 'O valor da entrada deve ser maior que zero.' })
  if (valorEntrada >= total) erros.push({ codigo: 'ENTRADA_MAIOR_QUE_TOTAL', mensagem: 'A entrada não pode ser igual ou maior que o total.' })

  const valorSaldo = cent(total - valorEntrada)

  // 3. forma do saldo × parcelas (natureza)
  const n = Math.max(1, Math.trunc(input.saldo.nParcelas || 1))
  const sForma = validarParcelamentoPorNatureza(input.saldo.tipoForma, n)
  if (sForma) erros.push(sForma)

  if (erros.length) return { ok: false, erros, valorEntrada, valorSaldo, parcelas: [] }

  // 4. compõe: entrada (nº 0/entrada) + saldo dividido em n; última absorve resíduo
  const parcelas: ParcelaComposta[] = [{ numero: 1, valor: valorEntrada, entrada: true, tipoForma: input.entrada.tipoForma.toUpperCase() }]
  const base = cent(valorSaldo / n)
  let acum = 0
  for (let i = 0; i < n; i++) {
    const ultima = i === n - 1
    const v = ultima ? cent(valorSaldo - acum) : base
    acum = cent(acum + v)
    parcelas.push({ numero: i + 2, valor: v, entrada: false, tipoForma: input.saldo.tipoForma.toUpperCase() })
  }
  return { ok: true, erros: [], valorEntrada, valorSaldo, parcelas }
}

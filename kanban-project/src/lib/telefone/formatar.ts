// src/lib/telefone/formatar.ts
// ============================================================================
// FORMATADOR DE TELEFONE — o ÚNICO. Veio, sem alteração de comportamento, de
// `contratantes-tabela.tsx`; o valor gravado (`Contratante.telefone` /
// `Requerente.telefone`, VarChar(20)) continua exatamente o que ele produz:
// "+55 (19) 98441-2070". Tudo o que é seletor de país (DDI) se apoia nele — não
// existe segundo formatador.
//
// Regras do valor (herdadas): sem "+" é Brasil (prefixa +55); +55, +1, +351, +34,
// +39, +49, +33 e +54 têm máscara própria; os demais DDIs caem na genérica
// (grupos de 3 dígitos, no máximo 15 dígitos — E.164).
//
// PURO: sem React, sem rede.
// ============================================================================

import { DDI_DO_PAIS, PAIS_PADRAO_DO_DDI, PAISES_COM_MASCARA } from "./ddi"

/** Limite da coluna `telefone` (VarChar(20)). */
export const LIMITE_TELEFONE = 20

export function formatTelefone(value: string): string {
  let cleaned = value.replace(/[^\d+]/g, '')
  
  if (cleaned && !cleaned.startsWith('+')) {
    cleaned = '+55' + cleaned
  }
  
  if (cleaned === '+') return '+'
  
  const digits = cleaned.slice(1)
  if (!digits) return '+'
  
  // Brasil +55
  if (digits.startsWith('55')) {
    const number = digits.slice(2)
    if (number.length === 0) return '+55'
    if (number.length <= 2) return `+55 (${number}`
    const ddd = number.slice(0, 2)
    const rest = number.slice(2)
    if (rest.length === 0) return `+55 (${ddd})`
    if (rest.length <= 5) return `+55 (${ddd}) ${rest}`
    if (rest.length <= 9) {
      if (rest.length === 9) {
        return `+55 (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`
      } else if (rest.length === 8) {
        return `+55 (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`
      }
      return `+55 (${ddd}) ${rest}`
    }
    const maxRest = rest.slice(0, 9)
    return `+55 (${ddd}) ${maxRest.slice(0, 5)}-${maxRest.slice(5)}`
  }
  
  // EUA/Canadá +1
  if (digits.startsWith('1')) {
    const number = digits.slice(1)
    if (number.length === 0) return '+1'
    if (number.length <= 3) return `+1 (${number}`
    const areaCode = number.slice(0, 3)
    const rest = number.slice(3)
    if (rest.length === 0) return `+1 (${areaCode})`
    if (rest.length <= 3) return `+1 (${areaCode}) ${rest}`
    if (rest.length <= 7) {
      return `+1 (${areaCode}) ${rest.slice(0, 3)}-${rest.slice(3)}`
    }
    const maxRest = rest.slice(0, 7)
    return `+1 (${areaCode}) ${maxRest.slice(0, 3)}-${maxRest.slice(3)}`
  }
  
  // Portugal +351
  if (digits.startsWith('351')) {
    const number = digits.slice(3)
    if (number.length === 0) return '+351'
    if (number.length <= 3) return `+351 ${number}`
    if (number.length <= 6) return `+351 ${number.slice(0, 3)} ${number.slice(3)}`
    if (number.length <= 9) return `+351 ${number.slice(0, 3)} ${number.slice(3, 6)} ${number.slice(6)}`
    const maxNum = number.slice(0, 9)
    return `+351 ${maxNum.slice(0, 3)} ${maxNum.slice(3, 6)} ${maxNum.slice(6)}`
  }
  
  // Espanha +34
  if (digits.startsWith('34')) {
    const number = digits.slice(2)
    if (number.length === 0) return '+34'
    if (number.length <= 3) return `+34 ${number}`
    if (number.length <= 6) return `+34 ${number.slice(0, 3)} ${number.slice(3)}`
    if (number.length <= 9) return `+34 ${number.slice(0, 3)} ${number.slice(3, 6)} ${number.slice(6)}`
    const maxNum = number.slice(0, 9)
    return `+34 ${maxNum.slice(0, 3)} ${maxNum.slice(3, 6)} ${maxNum.slice(6)}`
  }
  
  // Itália +39
  if (digits.startsWith('39')) {
    const number = digits.slice(2)
    if (number.length === 0) return '+39'
    if (number.length <= 3) return `+39 ${number}`
    if (number.length <= 6) return `+39 ${number.slice(0, 3)} ${number.slice(3)}`
    if (number.length <= 10) return `+39 ${number.slice(0, 3)} ${number.slice(3, 6)} ${number.slice(6)}`
    const maxNum = number.slice(0, 10)
    return `+39 ${maxNum.slice(0, 3)} ${maxNum.slice(3, 6)} ${maxNum.slice(6)}`
  }
  
  // Alemanha +49
  if (digits.startsWith('49')) {
    const number = digits.slice(2)
    if (number.length === 0) return '+49'
    if (number.length <= 4) return `+49 ${number}`
    if (number.length <= 11) return `+49 ${number.slice(0, 4)} ${number.slice(4)}`
    const maxNum = number.slice(0, 11)
    return `+49 ${maxNum.slice(0, 4)} ${maxNum.slice(4)}`
  }
  
  // França +33
  if (digits.startsWith('33')) {
    const number = digits.slice(2)
    if (number.length === 0) return '+33'
    if (number.length <= 1) return `+33 ${number}`
    if (number.length <= 3) return `+33 ${number.slice(0, 1)} ${number.slice(1)}`
    if (number.length <= 5) return `+33 ${number.slice(0, 1)} ${number.slice(1, 3)} ${number.slice(3)}`
    if (number.length <= 7) return `+33 ${number.slice(0, 1)} ${number.slice(1, 3)} ${number.slice(3, 5)} ${number.slice(5)}`
    if (number.length <= 9) return `+33 ${number.slice(0, 1)} ${number.slice(1, 3)} ${number.slice(3, 5)} ${number.slice(5, 7)} ${number.slice(7)}`
    const maxNum = number.slice(0, 9)
    return `+33 ${maxNum.slice(0, 1)} ${maxNum.slice(1, 3)} ${maxNum.slice(3, 5)} ${maxNum.slice(5, 7)} ${maxNum.slice(7)}`
  }
  
  // Argentina +54
  if (digits.startsWith('54')) {
    const number = digits.slice(2)
    if (number.length === 0) return '+54'
    if (number.length <= 2) return `+54 ${number}`
    if (number.length <= 6) return `+54 ${number.slice(0, 2)} ${number.slice(2)}`
    if (number.length <= 10) return `+54 ${number.slice(0, 2)} ${number.slice(2, 6)} ${number.slice(6)}`
    const maxNum = number.slice(0, 10)
    return `+54 ${maxNum.slice(0, 2)} ${maxNum.slice(2, 6)} ${maxNum.slice(6)}`
  }
  
  // Para qualquer outro DDI - formatação genérica
  if (digits.length <= 3) return `+${digits}`
  if (digits.length <= 6) return `+${digits.slice(0, 3)} ${digits.slice(3)}`
  if (digits.length <= 9) return `+${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
  if (digits.length <= 12) return `+${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`
  
  // Limita a 15 dígitos (padrão E.164)
  const maxDigits = digits.slice(0, 15)
  return `+${maxDigits.slice(0, 3)} ${maxDigits.slice(3, 6)} ${maxDigits.slice(6, 9)} ${maxDigits.slice(9, 12)} ${maxDigits.slice(12)}`
}

const DDIS_ORDENADOS: string[] = [...new Set(Object.values(DDI_DO_PAIS))].sort((a, b) => b.length - a.length)

/**
 * País do valor gravado: o MAIOR prefixo de DDI que casar. Valor sem "+" é Brasil
 * (mesma regra do formatador). DDI compartilhado abre no país principal
 * (+1 → Estados Unidos, +7 → Rússia...). `null` = nenhum DDI conhecido.
 */
export function descobrirPais(valor: string | null | undefined): { iso: string; ddi: string } | null {
  const bruto = String(valor ?? "").trim()
  if (!bruto) return null
  const limpo = bruto.replace(/[^\d+]/g, "")
  const digitos = (limpo.startsWith("+") ? limpo.slice(1) : `55${limpo}`).replace(/\D/g, "")
  if (!digitos) return null
  for (const ddi of DDIS_ORDENADOS) {
    if (digitos.startsWith(ddi)) return { iso: PAIS_PADRAO_DO_DDI[ddi], ddi }
  }
  return null
}

/** Dígitos da parte nacional de um valor gravado, dado o DDI. */
export function digitosNacionais(valor: string | null | undefined, ddi: string): string {
  const bruto = String(valor ?? "").trim()
  if (!bruto) return ""
  const limpo = bruto.replace(/[^\d+]/g, "")
  const digitos = (limpo.startsWith("+") ? limpo.slice(1) : `55${limpo}`).replace(/\D/g, "")
  return digitos.startsWith(ddi) ? digitos.slice(ddi.length) : digitos
}

/**
 * Valor a gravar: DDI + número nacional, no formato do formatador único e nunca
 * acima do limite da coluna. Sem número nacional devolve "" (campo vazio não
 * grava "+55").
 */
export function comporTelefone(ddi: string, nacional: string): string {
  let d = nacional.replace(/\D/g, "")
  if (!d) return ""
  let saida = formatTelefone(`+${ddi}${d}`)
  while (saida.length > LIMITE_TELEFONE && d.length > 0) {
    d = d.slice(0, -1)
    saida = formatTelefone(`+${ddi}${d}`)
  }
  return saida
}

/**
 * A parte nacional como o usuário a vê no campo: o valor formatado sem o "+DDI"
 * (a formatação genérica agrupa de 3 em 3 e pode cruzar a fronteira do DDI —
 * por isso se descontam os DÍGITOS do DDI, não uma fatia de texto).
 */
export function exibirParteNacional(valor: string, ddi: string): string {
  if (!valor) return ""
  let faltam = ddi.length
  let i = valor.startsWith("+") ? 1 : 0
  while (i < valor.length && faltam > 0) {
    if (/\d/.test(valor[i])) faltam--
    i++
  }
  return valor.slice(i).replace(/^[\s-]+/, "")
}

export { PAISES_COM_MASCARA }

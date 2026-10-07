// src/lib/datas-br.ts
// ============================================================================
// DATAS NO FORMATO DO BRASIL — dd/mm/aaaa (e dd/mm/aaaa hh:mm). PURO, sem `new Date` (que desloca por fuso).
// O sistema inteiro digita e mostra data assim; o valor INTERNO continua ISO («AAAA-MM-DD» / «AAAA-MM-DDTHH:mm»), como o input nativo devolvia.
// `<input type="date">` mostra o formato do idioma do NAVEGADOR (mm/dd/aaaa num Chrome em inglês): 07/10/2026 virava 10/07/2026. Por isso o
// teste `scripts/campos-de-data-br.test.ts` proíbe `type="date"`/`datetime-local` em qualquer tela.
// ============================================================================

/** Máscara enquanto digita: só dígitos, «dd/mm/aaaa» (e « hh:mm» quando `comHora`). */
export function mascararData(entrada: string, comHora = false): string {
  const d = entrada.replace(/\D/g, "").slice(0, comHora ? 12 : 8)
  let out = d.slice(0, 2)
  if (d.length > 2) out += `/${d.slice(2, 4)}`
  if (d.length > 4) out += `/${d.slice(4, 8)}`
  if (comHora && d.length > 8) out += ` ${d.slice(8, 10)}`
  if (comHora && d.length > 10) out += `:${d.slice(10, 12)}`
  return out
}

const bissexto = (a: number) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0
const diasDoMes = (a: number, m: number) => [31, bissexto(a) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]

/** Dia, mês e ano REAIS (31/02 e 29/02 de ano comum não existem). */
export function dataReal(dia: number, mes: number, ano: number): boolean {
  return Number.isInteger(dia) && Number.isInteger(mes) && Number.isInteger(ano) && ano >= 1000 && ano <= 9999 && mes >= 1 && mes <= 12 && dia >= 1 && dia <= diasDoMes(ano, mes)
}

/** «07/10/2026» → «2026-10-07»; `null` se incompleta ou inexistente. */
export function brParaIso(texto: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto.trim())
  if (!m) return null
  const [dia, mes, ano] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return dataReal(dia, mes, ano) ? `${m[3]}-${m[2]}-${m[1]}` : null
}

/** «2026-10-07» (ou «2026-10-07T15:30…») → «07/10/2026». Sem `new Date`. */
export function isoParaBr(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "")
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ""
}

/** «07/10/2026 15:30» → «2026-10-07T15:30»; `null` se inválido. */
export function brHoraParaIso(texto: string): string | null {
  const m = /^(\d{2}\/\d{2}\/\d{4}) (\d{2}):(\d{2})$/.exec(texto.trim())
  if (!m) return null
  const dia = brParaIso(m[1])
  const [h, mi] = [Number(m[2]), Number(m[3])]
  return dia && h >= 0 && h <= 23 && mi >= 0 && mi <= 59 ? `${dia}T${m[2]}:${m[3]}` : null
}
export function isoHoraParaBr(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso ?? "")
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : isoParaBr(iso)
}

/** Por que o texto não vale (para a mensagem do campo); `null` = vale ou está vazio. */
export function motivoDaDataInvalida(texto: string, comHora = false): string | null {
  const t = texto.trim()
  if (!t) return null
  if (comHora ? !brHoraParaIso(t) : !brParaIso(t)) return comHora ? "Use dd/mm/aaaa hh:mm com data e hora reais." : "Use dd/mm/aaaa com dia, mês e ano reais."
  return null
}

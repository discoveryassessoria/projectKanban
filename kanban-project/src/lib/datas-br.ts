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

// ============================================================================
// EXIBIÇÃO — dois tipos de data, nunca misturados.
// 1) DATA PURA (registro/evento/nascimento/óbito/casamento/emissão/validade): dia do calendário, SEM horário e SEM fuso.
//    O banco guarda `AAAA-MM-DDT00:00:00Z`; ler no fuso do navegador/servidor (UTC-3) mostrava o DIA ANTERIOR (16/07 → 15/07).
// 2) DATA COM HORÁRIO (movimentações, prazos, criação): instante real, exibido SEMPRE em America/Sao_Paulo.
// ============================================================================

/** DATA PURA → «dd/mm/aaaa» lendo ano-mês-dia em UTC. Vazio/inválido → `vazio` (padrão «—»). */
export function formatarDataPura(valor: string | Date | null | undefined, vazio = "—"): string {
  if (valor == null || valor === "") return vazio
  if (typeof valor === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor.trim())
    if (m) return `${m[3]}/${m[2]}/${m[1]}`
    const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor.trim())
    if (br) return valor.trim()
  }
  const d = valor instanceof Date ? valor : new Date(valor)
  if (Number.isNaN(d.getTime())) return vazio
  const p = (n: number, t = 2) => String(n).padStart(t, "0")
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCFullYear(), 4)}`
}

const FUSO_BRASILIA = "America/Sao_Paulo"

/** DATA COM HORÁRIO → «dd/mm/aaaa hh:mm» no fuso de Brasília (independe do fuso do servidor/navegador). */
export function formatarDataHoraBrasilia(valor: string | Date | null | undefined, vazio = "—"): string {
  if (valor == null || valor === "") return vazio
  const d = valor instanceof Date ? valor : new Date(valor)
  if (Number.isNaN(d.getTime())) return vazio
  const partes = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO_BRASILIA, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d)
  const g = (t: string) => partes.find((p) => p.type === t)?.value ?? ""
  return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}`
}

/** Dia (sem hora) de um INSTANTE real, no fuso de Brasília — para «criado em», «concluído em». */
export function formatarDiaBrasilia(valor: string | Date | null | undefined, vazio = "—"): string {
  const s = formatarDataHoraBrasilia(valor, "")
  return s ? s.slice(0, 10) : vazio
}

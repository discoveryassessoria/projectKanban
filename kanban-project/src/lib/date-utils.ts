// src/lib/date-utils.ts
// Utilitários para tratar datas corretamente com timezone

/**
 * Converte uma string de data (YYYY-MM-DD) para Date ajustada para meia-noite no timezone local
 * Isso garante que "2026-01-22" seja sempre dia 22, independente do timezone
 */
export function parseLocalDate(dateString: string | null | undefined): Date | null {
  if (!dateString) return null
  
  // Se já é uma data ISO completa (com T), extrai apenas a parte da data
  const datePart = dateString.split('T')[0]
  
  // Cria a data usando os componentes para evitar conversão UTC
  const [year, month, day] = datePart.split('-').map(Number)
  
  // new Date(year, month-1, day) cria no timezone LOCAL
  return new Date(year, month - 1, day, 12, 0, 0, 0) // meio-dia para evitar problemas de DST
}

/**
 * Converte uma Date para string no formato YYYY-MM-DD
 * Usa o timezone local, não UTC
 */
export function formatDateToISO(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Retorna a data de hoje (apenas data, sem hora) no timezone local
 */
export function getToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0)
}

/**
 * Retorna a data de hoje como string YYYY-MM-DD
 */
export function getTodayISO(): string {
  return formatDateToISO(new Date())
}

/**
 * Compara duas datas (apenas a parte da data, ignorando hora)
 * Retorna: -1 se a < b, 0 se iguais, 1 se a > b
 */
export function compareDates(a: Date | string | null, b: Date | string | null): number {
  const dateA = typeof a === 'string' ? parseLocalDate(a) : a
  const dateB = typeof b === 'string' ? parseLocalDate(b) : b
  
  if (!dateA && !dateB) return 0
  if (!dateA) return -1
  if (!dateB) return 1
  
  const isoA = formatDateToISO(dateA)
  const isoB = formatDateToISO(dateB)
  
  if (isoA < isoB) return -1
  if (isoA > isoB) return 1
  return 0
}

/**
 * Verifica se a data é hoje
 */
export function isToday(date: Date | string | null): boolean {
  return compareDates(date, getToday()) === 0
}

/**
 * Verifica se a data já passou (é anterior a hoje)
 */
export function isPast(date: Date | string | null): boolean {
  return compareDates(date, getToday()) < 0
}

/**
 * Verifica se a data está dentro dos próximos N dias
 */
export function isWithinDays(date: Date | string | null, days: number): boolean {
  const dateObj = typeof date === 'string' ? parseLocalDate(date) : date
  if (!dateObj) return false
  
  const today = getToday()
  const futureDate = new Date(today)
  futureDate.setDate(futureDate.getDate() + days)
  
  return compareDates(dateObj, today) > 0 && compareDates(dateObj, futureDate) <= 0
}

/**
 * Formata data para exibição em pt-BR
 * Usa o timezone local corretamente
 */
export function formatDateBR(date: Date | string | null | undefined): string {
  if (!date) return ''
  
  const dateObj = typeof date === 'string' ? parseLocalDate(date) : date
  if (!dateObj) return ''
  
  return dateObj.toLocaleDateString('pt-BR')
}

/**
 * Para salvar no banco: cria uma data que quando convertida para UTC
 * ainda representa o dia correto.
 * 
 * Exemplo: Se o usuário quer dia 22, salvamos como 22 ao meio-dia UTC
 * para que em qualquer timezone ainda seja dia 22.
 */
export function toUTCNoon(dateString: string | null | undefined): Date | null {
  if (!dateString) return null
  
  const datePart = dateString.split('T')[0]
  const [year, month, day] = datePart.split('-').map(Number)
  
  // Cria como meio-dia UTC (12:00:00.000Z)
  // Isso garante que em qualquer timezone do mundo ainda seja o dia correto
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0))
}
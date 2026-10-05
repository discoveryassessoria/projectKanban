// lib/operacional/tempo-extenso.ts
// ============================================================================
// TEMPO POR EXTENSO — UM formatador para "5 dias", "1 dia", "menos de 1 dia", "2 horas", "10 minutos".
// Puro (sem Prisma): serve à API e ao cliente. Onde não cabe (selo pequeno), as telas continuam com a forma curta — e isso está
// listado no relatório da entrega; aqui só existe o texto completo.
// ============================================================================
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** 0 (ou menos) → "menos de 1 dia"; 1 → "1 dia"; 5 → "5 dias". */
export function diasPorExtenso(n: number): string {
  const v = Math.floor(Number.isFinite(n) ? n : 0)
  return v < 1 ? 'menos de 1 dia' : plural(v, 'dia', 'dias')
}
/** 0 → "menos de 1 hora"; 1 → "1 hora"; 5 → "5 horas". */
export function horasPorExtenso(n: number): string {
  const v = Math.floor(Number.isFinite(n) ? n : 0)
  return v < 1 ? 'menos de 1 hora' : plural(v, 'hora', 'horas')
}
/** 0 → "menos de 1 minuto"; 1 → "1 minuto"; 10 → "10 minutos". */
export function minutosPorExtenso(n: number): string {
  const v = Math.floor(Number.isFinite(n) ? n : 0)
  return v < 1 ? 'menos de 1 minuto' : plural(v, 'minuto', 'minutos')
}

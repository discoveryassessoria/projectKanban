// src/lib/motor/observability-helpers.ts
// CP-4G — helpers PUROS de observabilidade do runtime v2 (sem prisma/sem @/).

export interface AdvanceCounters {
  AVANCADO: number
  FORCADO: number
  REABERTO: number
  RETORNADO: number
  BLOQUEADO: number
  IDEMPOTENTE: number
  CONFLITO: number
}

export function novoContador(): AdvanceCounters {
  return { AVANCADO: 0, FORCADO: 0, REABERTO: 0, RETORNADO: 0, BLOQUEADO: 0, IDEMPOTENTE: 0, CONFLITO: 0 }
}

/** Conta resultados de PhaseAdvanceLog de forma determinística. */
export function contarResultados(resultados: string[]): AdvanceCounters {
  const c = novoContador()
  for (const r of resultados) {
    if (r in c) c[r as keyof AdvanceCounters]++
  }
  return c
}

/** Converte pares (runtime, count) em mapa estável {legacy, v2}. */
export function mapaRuntime(pares: { runtime: string; total: number }[]): { legacy: number; v2: number } {
  const m = { legacy: 0, v2: 0 }
  for (const p of pares) {
    if (p.runtime === "v2") m.v2 += p.total
    else m.legacy += p.total
  }
  return m
}

// lib/financeiro/encargos-avancados.ts
// ============================================================================
// Multa e Juros AVANÇADOS — consome os campos EXPANDIDOS da Condição que o motor
// base (encargos-financeiros.ts) ignora: multaTipo (FIXA|PERCENTUAL), multaValor,
// jurosTipo (SIMPLES|COMPOSTO), jurosPeriodo (DIARIO|MENSAL), carenciaDias.
// PURO. Padrão do domínio: multa 2% após carência (uma vez); juros 1%/mês
// pro-rata (base 30 dias), não capitalizado por padrão.
// ============================================================================

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100
const num = (v: unknown) => { const n = Number(v); return isFinite(n) ? n : 0 }

export interface RegrasEncargosAvancado {
  multaTipo?: string | null // FIXA | PERCENTUAL
  multaValor?: number | string | null // usado quando FIXA
  multaPercent?: number | string | null // usado quando PERCENTUAL (default 2)
  jurosTipo?: string | null // SIMPLES | COMPOSTO
  jurosPeriodo?: string | null // DIARIO | MENSAL (default MENSAL)
  jurosPercent?: number | string | null // taxa do período (default 1 ao mês)
  carenciaDias?: number | null // atraso só conta após a carência
}

export interface ResultadoEncargos {
  diasAtraso: number
  diasEfetivos: number // após a carência
  base: number
  multa: number
  juros: number
  total: number
  memoria: string[]
}

/** Calcula multa + juros de UMA parcela em atraso. diasAtraso >= 0. */
export function calcularEncargosAvancado(base: number, diasAtraso: number, r: RegrasEncargosAvancado): ResultadoEncargos {
  const b = cent(base)
  const dias = Math.max(0, Math.trunc(diasAtraso))
  const carencia = Math.max(0, Math.trunc(r.carenciaDias ?? 0))
  const efetivos = Math.max(0, dias - carencia)
  const memoria: string[] = [`Base ${b.toFixed(2)} · atraso ${dias}d · carência ${carencia}d · efetivos ${efetivos}d`]

  let multa = 0, juros = 0
  if (efetivos > 0) {
    // ── multa (uma única vez) ──
    const tipo = String(r.multaTipo ?? 'PERCENTUAL').toUpperCase()
    if (tipo === 'FIXA') { multa = cent(num(r.multaValor)); if (multa) memoria.push(`Multa fixa: ${multa.toFixed(2)}`) }
    else { const p = num(r.multaPercent ?? 2); multa = cent((b * p) / 100); if (p) memoria.push(`Multa ${p}%: ${multa.toFixed(2)}`) }

    // ── juros ──
    const periodo = String(r.jurosPeriodo ?? 'MENSAL').toUpperCase()
    const taxaMes = num(r.jurosPercent ?? 1) // % ao mês por padrão
    const taxaDia = periodo === 'DIARIO' ? num(r.jurosPercent ?? (1 / 30)) / 100 : (taxaMes / 100) / 30
    const composto = String(r.jurosTipo ?? 'SIMPLES').toUpperCase() === 'COMPOSTO'
    if (taxaDia > 0) {
      juros = composto ? cent(b * (Math.pow(1 + taxaDia, efetivos) - 1)) : cent(b * taxaDia * efetivos)
      memoria.push(`Juros ${composto ? 'compostos' : 'simples'} ${(taxaDia * 100).toFixed(4)}%/dia × ${efetivos}d: ${juros.toFixed(2)}`)
    }
  } else memoria.push('Sem encargos (dentro da carência ou sem atraso).')

  const total = cent(b + multa + juros)
  return { diasAtraso: dias, diasEfetivos: efetivos, base: b, multa, juros, total, memoria }
}

"use client"

// ============================================================================
// APRESENTAÇÃO DO SLA — semáforo único de toda a aplicação
// ----------------------------------------------------------------------------
// Aqui NÃO se calcula nada: status, faixa, dias e rótulos já vêm prontos da
// engine (src/lib/motor/sla-core.ts). Este módulo existe só para que a Central
// Operacional, a listagem de processos e o detalhe do processo pintem o MESMO
// estado com a MESMA cor e o MESMO vocabulário — uma paleta, um lugar.
//
// Cores no vocabulário do Discovery Design System (mesmas classes dos chips de
// nível da Home), sem CSS próprio e sem token local.
// ============================================================================

import type { FaixaSla, StatusSla } from "@/src/types/sla"

export interface CorSla {
  chip: string
  ponto: string
  texto: string
  aro: string
}

/** Paleta canônica do prazo — definida UMA vez. */
export const CORES_SLA = {
  atrasado: {
    chip: "bg-red-50 text-red-700 border-red-200",
    ponto: "bg-red-400",
    texto: "text-red-700",
    aro: "ring-red-400/25",
  },
  hoje: {
    chip: "bg-amber-50 text-amber-700 border-amber-200",
    ponto: "bg-amber-400",
    texto: "text-amber-700",
    aro: "ring-amber-400/25",
  },
  atencao: {
    chip: "bg-amber-50 text-amber-700 border-amber-200",
    ponto: "bg-amber-400",
    texto: "text-amber-700",
    aro: "ring-amber-400/25",
  },
  ok: {
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
    ponto: "bg-emerald-400",
    texto: "text-emerald-700",
    aro: "ring-emerald-400/25",
  },
  neutro: {
    chip: "bg-[var(--surface-primary)] text-white/70 border-[var(--border-default)]",
    ponto: "bg-[var(--surface-elevated)]",
    texto: "text-white/70",
    aro: "ring-white/10",
  },
} satisfies Record<string, CorSla>

/** Cor por STATUS (semáforo de 3 estados + ausência de configuração). */
export const ESTILO_STATUS_SLA: Record<StatusSla, CorSla> = {
  atrasado: CORES_SLA.atrasado,
  proximo_vencimento: CORES_SLA.hoje,
  no_prazo: CORES_SLA.ok,
  sem_prazo: CORES_SLA.neutro,
}

/** Cor por FAIXA (mesmo semáforo, com "vence hoje" separado de "próximos 7"). */
export const ESTILO_FAIXA_SLA: Record<FaixaSla, CorSla> = {
  atrasados: CORES_SLA.atrasado,
  "vencem-hoje": CORES_SLA.hoje,
  "proximos-7": CORES_SLA.atencao,
  "no-prazo": CORES_SLA.ok,
}

/** Selo de status do SLA. O texto vem da engine (`sla.rotuloStatus`). */
export function SlaBadge({
  status,
  rotulo,
  className = "",
}: {
  status: StatusSla
  rotulo: string
  className?: string
}) {
  const st = ESTILO_STATUS_SLA[status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium ${st.chip} ${className}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${st.ponto}`} />
      {rotulo}
    </span>
  )
}

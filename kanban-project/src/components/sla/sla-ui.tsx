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
    chip: "bg-[var(--surface-secondary)] text-red-700 border-[var(--border-default)]",
    ponto: "bg-red-600",
    texto: "text-red-700",
    aro: "ring-[var(--border-strong)]",
  },
  hoje: {
    chip: "bg-[var(--surface-secondary)] text-amber-800 border-[var(--border-default)]",
    ponto: "bg-amber-600",
    texto: "text-amber-800",
    aro: "ring-[var(--border-strong)]",
  },
  atencao: {
    chip: "bg-[var(--surface-secondary)] text-amber-800 border-[var(--border-default)]",
    ponto: "bg-amber-600",
    texto: "text-amber-800",
    aro: "ring-[var(--border-strong)]",
  },
  ok: {
    chip: "bg-[var(--surface-secondary)] text-green-800 border-[var(--border-default)]",
    ponto: "bg-green-600",
    texto: "text-green-800",
    aro: "ring-[var(--border-strong)]",
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

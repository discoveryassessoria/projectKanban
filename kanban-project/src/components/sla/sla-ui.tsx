"use client"

// ============================================================================
// PALETA DE TOM — semáforo único de prazo/SLA de toda a aplicação
// ----------------------------------------------------------------------------
// Aqui NÃO se calcula nada: quem chama já resolveu status/faixa/dias/rótulo
// na engine canônica correspondente (Tarefa/Subtarefa: `estadoTemporal`/
// `estadoTemporalSubtarefa`, `lib/operacional/tempo-operacional.ts`). Este
// módulo guarda só a PALETRA — as cores do semáforo — pra ninguém pintar de
// um jeito na Home e de outro em Tarefas e Projetos.
//
// Achado real (17/09/2026): existia aqui também `ESTILO_STATUS_SLA`/
// `ESTILO_FAIXA_SLA`/`SlaBadge`, específicos do SLA de FaseMacro/Processo —
// removidos junto com o conceito (ver [[prazo-tarefa-subtarefa-dois-relogios]]).
// A paleta (`CORES_SLA`) ficou — é reaproveitada pelos dois relógios oficiais
// (ver `ESTILO_FAIXA_PRAZO` em `src/components/home/home-content.tsx`).
// ============================================================================

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

// src/components/processo/PhaseProgressHeader.tsx

"use client"

import { useEffect, useState, useCallback } from "react"
import { Loader2 } from "lucide-react"

/**
 * Header de progresso da fase do processo.
 *
 * Mostra:
 *   BUSCA DOCUMENTAL · 0%
 *   0 / 2 doc(s) nesta fase
 *
 * Espelha o `updatePhaseProgressHeader()` do HTML do Marco. Posiciona
 * em qualquer lugar do header da página do processo — alinha com o nome
 * da família / país.
 *
 * Auto-recarrega quando `refreshKey` muda (parent passa um contador que
 * incrementa após salvar algum documento, criar pessoa, etc).
 */

import type { OperationalProjection } from "@/src/types/kanban"

interface PhaseProgress {
  stage: string
  label: string
  done: number
  total: number
  percent: number
  reason: string
  /** Projeção operacional oficial (fonte única). */
  projection?: OperationalProjection | null
}

export interface PhaseProgressHeaderProps {
  processoId: number
  /** Incrementa pra forçar refetch. */
  refreshKey?: number
  /** Estilo visual: "light" (header claro) ou "dark" (header escuro). */
  variant?: "light" | "dark"
}

export function PhaseProgressHeader({
  processoId,
  refreshKey = 0,
  variant = "light",
}: PhaseProgressHeaderProps) {
  const [data, setData] = useState<PhaseProgress | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/processos/${processoId}/phase`, {
        headers: {
          Authorization: `Bearer ${
            typeof window !== "undefined"
              ? localStorage.getItem("authToken") ?? ""
              : ""
          }`,
        },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: PhaseProgress = await res.json()
      setData(json)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "erro"
      console.warn("[PhaseProgressHeader] falha:", e)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [processoId])

  useEffect(() => {
    carregar()
  }, [carregar, refreshKey])

  // Skeleton enquanto carrega
  if (loading && !data) {
    return (
      <div
        className={`flex items-center gap-2 ${
          variant === "dark" ? "text-white/50" : "text-gray-400"
        }`}
      >
        <Loader2 className="w-3 h-3 animate-spin" />
        <span className="text-[11px]">Calculando fase…</span>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className={`text-[11px] ${variant === "dark" ? "text-white/40" : "text-gray-400"}`}>
        Fase indisponível
      </div>
    )
  }

  const isDark = variant === "dark"
  const labelCls = isDark
    ? "text-white/85 font-semibold uppercase tracking-wider"
    : "text-gray-900 font-semibold uppercase tracking-wider"
  const pctCls = isDark
    ? "text-white tabular-nums"
    : "text-gray-900 tabular-nums"
  const countsCls = isDark ? "text-white/50" : "text-gray-500"
  const trackCls = isDark ? "bg-white/10" : "bg-gray-200"

  // FONTE ÚNICA: projeção oficial (percentual, label e métricas). Sem recálculo local.
  const proj = data.projection ?? null
  const pct = proj?.progress.percentage ?? data.percent
  const label = proj?.activePhase?.name ?? data.label
  const required = proj?.metrics.required ?? data.total
  const completed = proj?.metrics.completed ?? data.done
  const blocked = proj?.status.blocked ?? false

  // Cor da barra: bloqueada (âmbar) · concluída (verde) · em andamento (azul/escuro)
  const fillBg = blocked
    ? "#f59e0b"
    : pct >= 100
    ? "#10b981"
    : isDark
    ? "#3b82f6"
    : "#1e293b"

  return (
    <div className="flex flex-col gap-1 min-w-[220px] max-w-[400px]">
      {/* Linha superior: label + percent */}
      <div className="flex items-center justify-between gap-3">
        <span className={`text-[10px] ${labelCls}`} title={data.reason}>
          {label}
        </span>
        <span className={`text-[11px] font-bold ${pctCls}`}>{pct}%</span>
      </div>

      {/* Barra de progresso */}
      <div className={`h-1 ${trackCls} rounded-full overflow-hidden`}>
        <div
          className="h-full transition-all duration-500"
          style={{ width: `${pct}%`, background: fillBg }}
        />
      </div>

      {/* Linha inferior: métrica detalhada da projeção (metrics) — sem recalcular */}
      <div className={`text-[10px] ${countsCls}`}>
        {required === 0
          ? blocked ? "Pendências obrigatórias em aberto" : "Sem itens obrigatórios nesta fase"
          : `${completed} / ${required} concluído(s) nesta fase`}
      </div>
    </div>
  )
}
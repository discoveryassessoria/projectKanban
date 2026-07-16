"use client"

// Primitivas visuais da Central Operacional — superfície clara, alto contraste,
// cards sólidos (sem glassmorphism, sem imagem de fundo). Reutilizadas por
// todas as seções da Home.

import * as React from "react"
import { AlertTriangle, Inbox } from "lucide-react"
import type { NivelPrioridade, PrioridadeTarefa } from "@/src/types/home"

// ---- Estilos por nível de prioridade --------------------------------------
export interface NivelStyle {
  card: string
  chip: string
  dot: string
  texto: string
}
export function nivelStyle(nivel: NivelPrioridade): NivelStyle {
  switch (nivel) {
    case "critico":
      return { card: "border-red-200 bg-red-50 hover:bg-red-100", chip: "bg-red-100 text-red-700", dot: "bg-red-500", texto: "text-red-700" }
    case "alto":
      return { card: "border-amber-200 bg-amber-50 hover:bg-amber-100", chip: "bg-amber-100 text-amber-800", dot: "bg-amber-500", texto: "text-amber-800" }
    case "medio":
      return { card: "border-sky-200 bg-sky-50 hover:bg-sky-100", chip: "bg-sky-100 text-sky-700", dot: "bg-sky-500", texto: "text-sky-700" }
    default:
      return { card: "border-slate-200 bg-white hover:bg-slate-50", chip: "bg-slate-100 text-slate-600", dot: "bg-slate-400", texto: "text-slate-600" }
  }
}

// ---- Badge de prioridade de tarefa ----------------------------------------
const PRIORIDADE_STYLE: Record<PrioridadeTarefa, string> = {
  URGENTE: "bg-red-100 text-red-700 border-red-200",
  ALTA: "bg-amber-100 text-amber-800 border-amber-200",
  MEDIA: "bg-sky-100 text-sky-700 border-sky-200",
  BAIXA: "bg-slate-100 text-slate-600 border-slate-200",
}
export function PriorityBadge({ prioridade }: { prioridade: PrioridadeTarefa }) {
  const label = prioridade.charAt(0) + prioridade.slice(1).toLowerCase()
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${PRIORIDADE_STYLE[prioridade]}`}>
      {label}
    </span>
  )
}

// ---- Cabeçalho de seção ----------------------------------------------------
export function SectionHeader({
  titulo,
  descricao,
  acao,
  icon: Icon,
}: {
  titulo: string
  descricao?: string
  acao?: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-slate-400" />}
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-slate-900">{titulo}</h2>
          {descricao && <p className="text-xs text-slate-500">{descricao}</p>}
        </div>
      </div>
      {acao}
    </div>
  )
}

// ---- Card de seção (superfície branca sólida) ------------------------------
export function SectionCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>{children}</section>
  )
}

// ---- Estados vazios / erro -------------------------------------------------
export function EmptyState({ children, icon: Icon = Inbox }: { children: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
      <Icon className="h-6 w-6 text-slate-300" />
      <p className="text-sm text-slate-500">{children}</p>
    </div>
  )
}

export function ErrorState({ onRetry, mensagem }: { onRetry?: () => void; mensagem?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <AlertTriangle className="h-6 w-6 text-red-400" />
      <p className="text-sm text-slate-600">{mensagem ?? "Não foi possível carregar estes dados."}</p>
      {onRetry && (
        <button onClick={onRetry} className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
          Tentar novamente
        </button>
      )}
    </div>
  )
}

// ---- Formatação ------------------------------------------------------------
export function tempoRelativo(iso: string): string {
  const agora = Date.now()
  const t = new Date(iso).getTime()
  if (isNaN(t)) return ""
  const diff = agora - t
  const min = Math.floor(diff / 60000)
  if (min < 1) return "agora mesmo"
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h}h`
  const d = Math.floor(h / 24)
  if (d === 1) return "ontem"
  if (d < 7) return `há ${d} dias`
  return new Date(iso).toLocaleDateString("pt-BR")
}

export function formatarPrazo(iso: string | null): string {
  if (!iso) return "sem prazo"
  const d = new Date(iso)
  if (isNaN(d.getTime())) return "sem prazo"
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
}

export function formatarHorario(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}

"use client"

import { estadoTemporal, FUSO_OPERACIONAL } from "@/lib/operacional/tempo-operacional"

// ============================================================================
// PRIMITIVAS VISUAIS DO CENTRO OPERACIONAL
// ----------------------------------------------------------------------------
// MESMA identidade do módulo Financeiro (src/components/financeiro/
// dashboard-corporativo.tsx): fundo arquitetônico escurecido, cards glass/dark,
// acento dourado no que é primário e as cores de status verde/vermelho/âmbar.
// Nada de superfície clara ou paleta própria — a Home é parte do mesmo sistema.
// ============================================================================

import * as React from "react"
import { AlertTriangle, Inbox } from "lucide-react"
import type { NivelPrioridade } from "@/src/types/home"

/** Acento dourado — mesmo token do Financeiro. */
export const OURO = 'var(--accent-primary)'
export const OURO_TINTA = 'var(--accent-text)'
/** Card glass — mesma composição do Financeiro. */
export const CARD = "rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur-md"
/**
 * Card FOCAL — a tela tem um assunto principal, e ele não pode ter o mesmo peso
 * dos apoios. Superfície OPACA do DS (`--surface-overlay`, o mesmo token dos
 * overlays) + sombra projetada: eleva de verdade, em vez de depender de mais
 * uma camada translúcida sobre a foto.
 */
export const CARD_FOCAL =
  "relative overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur-md shadow-[var(--elev-2)]"

// ---- Estilos por nível -----------------------------------------------------
export interface NivelStyle {
  chip: string
  ponto: string
  texto: string
  aro: string
}
export function nivelStyle(nivel: NivelPrioridade | "critico" | "alto"): NivelStyle {
  switch (nivel) {
    case "critico":
      return {
        chip: "bg-[var(--surface-secondary)] text-[var(--text-secondary)] border-[var(--border-default)]",
        ponto: "bg-red-600",
        texto: "text-red-700",
        aro: "ring-[var(--border-strong)]",
      }
    case "alto":
      return {
        chip: "bg-[var(--surface-secondary)] text-[var(--text-secondary)] border-[var(--border-default)]",
        ponto: "bg-amber-600",
        texto: "text-amber-800",
        aro: "ring-[var(--border-strong)]",
      }
    case "medio":
      return {
        chip: "bg-[var(--surface-secondary)] text-[var(--text-secondary)] border-[var(--border-default)]",
        ponto: "bg-[var(--text-muted)]",
        texto: "text-[var(--text-primary)]",
        aro: "ring-[var(--border-strong)]",
      }
    default:
      return {
        chip: "bg-[var(--surface-secondary)] text-[var(--text-secondary)] border-[var(--border-default)]",
        ponto: "bg-[var(--text-muted)]",
        texto: "text-[var(--text-primary)]",
        aro: "ring-[var(--border-strong)]",
      }
  }
}

// O semáforo de SLA NÃO mora aqui: a paleta de prazo é uma só para o app inteiro
// (src/components/sla/sla-ui.tsx), compartilhada com a listagem de processos e o
// detalhe do processo. A Home importa de lá em vez de manter uma cópia.

// ---- Card / cabeçalho de bloco --------------------------------------------
export function BlocoCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`${CARD} p-4 md:p-5 ${className}`}>{children}</section>
}

export function BlocoHeader({
  titulo,
  descricao,
  acao,
}: {
  titulo: string
  descricao?: string
  acao?: React.ReactNode
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-white/90">{titulo}</h2>
        {descricao && <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{descricao}</p>}
      </div>
      {acao}
    </div>
  )
}

// ---- Estados ---------------------------------------------------------------
export function EmptyState({
  children,
  icon: Icon = Inbox,
}: {
  children: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <Icon className="h-6 w-6 text-[var(--text-muted)]" />
      <p className="text-sm text-[var(--text-secondary)]">{children}</p>
    </div>
  )
}

export function ErrorState({ onRetry, mensagem }: { onRetry?: () => void; mensagem?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
      <AlertTriangle className="h-6 w-6 text-red-700" />
      <p className="text-sm text-white/70">{mensagem ?? "Não foi possível carregar estes dados."}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-[var(--surface-hover)]"
        >
          Tentar novamente
        </button>
      )}
    </div>
  )
}

// ---- Formatação ------------------------------------------------------------
export function formatarHorario(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}

/**
 * O PRAZO NA HOME — mesma régua, texto curto.
 *
 * O corte era `setHours(0,0,0,0)`, isto é, meia-noite NO FUSO DO NAVEGADOR: um
 * gestor em Lisboa via "vence hoje" enquanto a operação em São Paulo ainda
 * estava em ontem. A régua da operação não pode depender de onde o navegador
 * está aberto.
 */
export function formatarPrazo(iso: string | null): string {
  if (!iso) return "sem prazo"
  const d = new Date(iso)
  if (isNaN(d.getTime())) return "sem prazo"
  const t = estadoTemporal({ dataPrazo: d })
  if (t.atrasado) return `${t.atrasadoHaDias}d em atraso`
  if (t.venceHoje) return "vence hoje"
  if (t.venceAmanha) return "vence amanhã"
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: FUSO_OPERACIONAL })
}

export function saudacao(agora = new Date()): string {
  const h = agora.getHours()
  if (h < 12) return "Bom dia"
  if (h < 18) return "Boa tarde"
  return "Boa noite"
}

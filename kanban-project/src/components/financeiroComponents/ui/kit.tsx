// ============================================================================
// LINGUAGEM VISUAL — KIT COMPARTILHADO DO FINANCEIRO GERAL
// ----------------------------------------------------------------------------
// Fonte ÚNICA dos componentes de UI das telas do Financeiro (Dashboard,
// Tesouraria, A Receber, Cobranças, A Pagar, Fluxo de Caixa).
// Nenhuma tela cria versão própria de card, KPI, botão, input, filtro, badge,
// tabela, estado vazio, cabeçalho ou abas — todas consomem estes componentes,
// e estes consomem os tokens de globals.css (--surface-*, --border-*, --text-*,
// --accent-*, --radius-*, --space-*). Zero hex/rgba arbitrário nas páginas.
//
// O shell global (sidebar preta translúcida + header) já é provido por
// SidebarWrapper/BitrixSidebar/HeaderBar no layout raiz — este kit cuida do
// CONTEÚDO de cada tela dentro desse shell.
// ============================================================================

"use client"

import * as React from "react"
import { ChevronRight, ChevronLeft, MoreVertical } from "lucide-react"

// ---- token helpers (mantém as páginas livres de valores literais) ----------
export const ACCENT = "var(--accent-primary)"
export const ACCENT_HOVER = "var(--accent-hover)"
// Superfícies opacas de overlay — expostas pelo DS para modal/drawer/popover.
export const SURFACE_OVERLAY = "var(--surface-overlay)"
export const SURFACE_POPOVER = "var(--surface-popover)"
export const SURFACE_INPUT = "var(--surface-input)"

const S = {
  surface: "var(--surface-primary)",
  surface2: "var(--surface-secondary)",
  surfaceHover: "var(--surface-hover)",
  surfaceActive: "var(--surface-active)",
  // Superfícies OPACAS (overlays) — tokens globais do DS (globals.css).
  surfaceOverlay: "var(--surface-overlay)",
  surfacePopover: "var(--surface-popover)",
  surfaceInput: "var(--surface-input)",
  border: "var(--border-default)",
  borderStrong: "var(--border-strong)",
  textPrimary: "var(--text-primary)",
  textSecondary: "var(--text-secondary)",
  textMuted: "var(--text-muted)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  info: "var(--info)",
} as const

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent"
export function toneColor(t: Tone): string {
  switch (t) {
    case "success": return S.success
    case "warning": return S.warning
    case "danger": return S.danger
    case "info": return S.info
    case "accent": return "var(--accent-primary)"
    default: return S.textPrimary
  }
}

// ============================================================================
// FORMATO (centralizado — mesmas regras em toda tela)
// ============================================================================
export function fmtBRL(v: number): string {
  return `R$ ${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
export function fmtBRLshort(v: number): string {
  const n = Math.abs(v ?? 0)
  if (n >= 1000) return `R$ ${(v / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}k`
  return fmtBRL(v)
}
export function fmtEUR(v: number): string { return `€ ${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
export function fmtUSD(v: number): string { return `US$ ${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
export function fmtPct(v: number): string { return `${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` }
export function fmtDate(d: string | Date | null): string {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

// ============================================================================
// SUPERFÍCIE BASE
// ============================================================================
export function SurfaceCard({
  children, className = "", padding = "p-4", onClick, hover = false, style,
}: {
  children: React.ReactNode; className?: string; padding?: string
  onClick?: () => void; hover?: boolean; style?: React.CSSProperties
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-[var(--radius-md)] border backdrop-blur-md transition-colors ${padding} ${hover || onClick ? "cursor-pointer" : ""} ${className}`}
      style={{
        background: S.surface,
        borderColor: S.border,
        boxShadow: "var(--shadow-surface)",
        ...(style || {}),
      }}
      onMouseEnter={hover || onClick ? (e) => (e.currentTarget.style.background = S.surfaceHover) : undefined}
      onMouseLeave={hover || onClick ? (e) => (e.currentTarget.style.background = S.surface) : undefined}
    >
      {children}
    </div>
  )
}

// ============================================================================
// CABEÇALHO DE PÁGINA (título + subtítulo + ações)
// ============================================================================
export function PageHeader({
  icon, title, subtitle, meta, actions,
}: {
  icon?: React.ReactNode; title: string; subtitle?: React.ReactNode
  meta?: React.ReactNode; actions?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between flex-wrap gap-3">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold flex items-center gap-2" style={{ color: S.textPrimary }}>
          {icon && <span style={{ color: S.textSecondary }}>{icon}</span>}
          {title}
        </h2>
        {subtitle && <p className="text-sm mt-0.5" style={{ color: S.textSecondary }}>{subtitle}</p>}
        {meta && <div className="text-xs mt-1 flex items-center gap-2 flex-wrap" style={{ color: S.textSecondary }}>{meta}</div>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  )
}

// ============================================================================
// BOTÕES
// ============================================================================
export function PrimaryButton({
  children, icon, onClick, type = "button", className = "",
}: {
  children: React.ReactNode; icon?: React.ReactNode
  onClick?: () => void; type?: "button" | "submit"; className?: string
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold rounded-[var(--radius-sm)] transition-colors ${className}`}
      style={{ background: "var(--accent-primary)", color: "var(--accent-ink)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "var(--accent-primary)")}
    >
      {icon}{children}
    </button>
  )
}

export function SecondaryButton({
  children, icon, onClick, className = "",
}: {
  children: React.ReactNode; icon?: React.ReactNode; onClick?: () => void; className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-[var(--radius-sm)] border transition-colors ${className}`}
      style={{ background: "transparent", borderColor: S.borderStrong, color: S.textPrimary }}
      onMouseEnter={(e) => (e.currentTarget.style.background = S.surfaceHover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {icon}{children}
    </button>
  )
}

export function DangerButton({
  children, icon, onClick, className = "",
}: {
  children: React.ReactNode; icon?: React.ReactNode; onClick?: () => void; className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-[var(--radius-sm)] border transition-colors ${className}`}
      style={{ borderColor: "color-mix(in srgb, var(--danger) 30%, transparent)", color: S.danger }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in srgb, var(--danger) 12%, transparent)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {icon}{children}
    </button>
  )
}

// Link de ação discreto em dourado ("Ver todos →")
export function LinkAction({
  children, onClick, center = false,
}: { children: React.ReactNode; onClick?: () => void; center?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-sm font-medium transition-opacity hover:opacity-80 ${center ? "mx-auto" : ""}`}
      style={{ color: "var(--accent-text)" }}
    >
      {children}
    </button>
  )
}

// ============================================================================
// KPI — padrão único: superfície neutra, borda neutra, título cinza,
// valor branco (cor semântica só quando fizer sentido), ícone neutro.
// SEM linha colorida inferior, SEM borda colorida decorativa.
// ============================================================================
export function KpiCard({
  icon, label, value, sub, tone = "neutral", iconTone = "neutral",
  iconRight = false, iconVariant = "subtle", previa, footer,
}: {
  icon?: React.ReactNode; label: string; value: React.ReactNode; sub?: React.ReactNode
  tone?: Tone; iconTone?: Tone
  // iconRight: ícone no topo-direito (senão topo-esquerdo, ao lado do rótulo).
  // iconVariant: "subtle" caixa neutra (padrão) · "filled" caixa preenchida com a
  // cor semântica · "plain" ícone colorido sem caixa. Mesmo componente, sem variante nova.
  iconRight?: boolean; iconVariant?: "subtle" | "filled" | "plain"
  previa?: boolean; footer?: React.ReactNode
}) {
  const c = iconTone === "neutral" ? S.textSecondary : toneColor(iconTone)
  const iconEl = icon && (
    iconVariant === "plain"
      ? <span className="shrink-0" style={{ color: c }}>{icon}</span>
      : <span
          className="h-9 w-9 shrink-0 grid place-items-center rounded-[var(--radius-sm)] border"
          style={
            iconVariant === "filled"
              ? { background: iconTone === "neutral" ? S.surface2 : c, borderColor: "transparent", color: iconTone === "neutral" ? S.textSecondary : "var(--app-background)" }
              : { background: S.surface2, borderColor: S.border, color: c }
          }
        >{icon}</span>
  )
  return (
    <SurfaceCard padding="p-4" className="relative">
      {previa && <PreviaTag />}
      {iconRight ? (
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-medium" style={{ color: S.textSecondary }}>{label}</span>
          {iconEl}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {iconEl}
          <span className="text-xs font-medium" style={{ color: S.textSecondary }}>{label}</span>
        </div>
      )}
      <div className="text-2xl font-bold mt-2 tabular-nums" style={{ color: toneColor(tone) }}>{value}</div>
      {sub && <div className="text-[11px] mt-1" style={{ color: S.textMuted }}>{sub}</div>}
      {footer && <div className="mt-2">{footer}</div>}
    </SurfaceCard>
  )
}

// ============================================================================
// SEÇÃO COM CABEÇALHO (card + header + ação opcional)
// ============================================================================
export function SectionHeader({
  icon, title, previa, right,
}: { icon?: React.ReactNode; title: React.ReactNode; previa?: boolean; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3 gap-2">
      <div className="text-sm font-semibold flex items-center gap-2" style={{ color: S.textPrimary }}>
        {icon && <span style={{ color: S.textSecondary }}>{icon}</span>}
        {title}
        {previa && <PreviaTag inline />}
      </div>
      {right}
    </div>
  )
}

export function SectionCard({
  icon, title, previa, right, children, footer, className = "", bodyClassName = "",
}: {
  icon?: React.ReactNode; title?: React.ReactNode; previa?: boolean; right?: React.ReactNode
  children: React.ReactNode; footer?: React.ReactNode; className?: string; bodyClassName?: string
}) {
  return (
    <SurfaceCard padding="p-4" className={className}>
      {title && <SectionHeader icon={icon} title={title} previa={previa} right={right} />}
      <div className={bodyClassName}>{children}</div>
      {footer && (
        <div className="mt-3 pt-3 border-t flex justify-center" style={{ borderColor: S.border }}>
          {footer}
        </div>
      )}
    </SurfaceCard>
  )
}

// Selo "prévia" (mock/estimativa)
export function PreviaTag({ inline }: { inline?: boolean }) {
  return (
    <span
      className={`${inline ? "" : "absolute top-2 right-2"} text-[9px] px-1.5 py-0.5 rounded`}
      style={{ background: S.surface2, color: S.textMuted }}
    >
      prévia
    </span>
  )
}

// ============================================================================
// TABELA — cabeçalho e células padronizados
// ============================================================================
export const TABLE_HEAD_CLS = "text-xs border-b"
export function Thead({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      <tr className={TABLE_HEAD_CLS} style={{ color: S.textMuted, borderColor: S.border }}>
        {children}
      </tr>
    </thead>
  )
}
export function Th({ children, align = "left" }: { children?: React.ReactNode; align?: "left" | "right" | "center" }) {
  const a = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
  return <th className={`font-medium py-2 px-2 ${a}`}>{children}</th>
}
export function Tr({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <tr
      onClick={onClick}
      className={`border-b last:border-0 transition-colors ${onClick ? "cursor-pointer" : ""}`}
      style={{ borderColor: "color-mix(in srgb, var(--border-default) 60%, transparent)" }}
      onMouseEnter={onClick ? (e) => (e.currentTarget.style.background = S.surfaceHover) : undefined}
      onMouseLeave={onClick ? (e) => (e.currentTarget.style.background = "transparent") : undefined}
    >
      {children}
    </tr>
  )
}

// ============================================================================
// ESTADO VAZIO
// ============================================================================
export function EmptyState({
  icon, title, subtitle, footer, compact,
}: { icon?: React.ReactNode; title: string; subtitle?: string; footer?: React.ReactNode; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? "py-8" : "py-12"}`}>
      {icon && (
        <div
          className="h-12 w-12 rounded-[var(--radius-md)] grid place-items-center mb-3 border"
          style={{ background: S.surface2, borderColor: S.border, color: S.textMuted }}
        >
          {icon}
        </div>
      )}
      <p className="text-sm" style={{ color: S.textSecondary }}>{title}</p>
      {subtitle && <p className="text-xs mt-1" style={{ color: S.textMuted }}>{subtitle}</p>}
      {footer && <div className="mt-4">{footer}</div>}
    </div>
  )
}

// ============================================================================
// FILTRO EM PÍLULA (chip)
// ============================================================================
export function FilterChip({
  active, onClick, children, count, gold, dot,
}: { active: boolean; onClick: () => void; children: React.ReactNode; count?: number; gold?: boolean; dot?: string }) {
  const activeStyle = gold
    ? { background: "color-mix(in srgb, var(--accent-primary) 14%, transparent)", borderColor: "color-mix(in srgb, var(--accent-primary) 45%, transparent)", color: "var(--accent-text)" }
    : { background: S.surfaceActive, borderColor: S.borderStrong, color: S.textPrimary }
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-[var(--radius-sm)] border transition-colors"
      style={active ? activeStyle : { background: S.surface, borderColor: S.border, color: S.textSecondary }}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot }} />}
      {children}
      {count != null && (
        <span className="text-[10px] px-1.5 rounded-full" style={{ background: S.surfaceActive, color: S.textSecondary }}>
          {count}
        </span>
      )}
    </button>
  )
}

// ============================================================================
// BUSCA
// ============================================================================
export function SearchInput({
  value, onChange, placeholder, icon, className = "",
}: { value: string; onChange: (v: string) => void; placeholder?: string; icon?: React.ReactNode; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      {icon && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: S.textMuted }}>{icon}</span>}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-[var(--radius-sm)] border py-2 pr-3 text-sm outline-none ${icon ? "pl-9" : "pl-3"}`}
        style={{ background: "rgba(0,0,0,0.30)", borderColor: S.border, color: S.textPrimary }}
      />
    </div>
  )
}

// ============================================================================
// BADGE DE SITUAÇÃO
// ============================================================================
export function StatusBadge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  const c = toneColor(tone)
  const bg = tone === "neutral" ? S.surfaceActive : `color-mix(in srgb, ${c} 16%, transparent)`
  const bd = tone === "neutral" ? S.border : `color-mix(in srgb, ${c} 32%, transparent)`
  const fg = tone === "neutral" ? S.textSecondary : c
  return (
    <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium" style={{ background: bg, borderColor: bd, color: fg }}>
      {children}
    </span>
  )
}

// ============================================================================
// LINHA DE MÉTRICA (label ↔ valor) — painéis laterais
// ============================================================================
export function MetricRow({
  label, value, tone = "neutral", muted,
}: { label: React.ReactNode; value: React.ReactNode; tone?: Tone; muted?: boolean }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span style={{ color: S.textSecondary }}>{label}</span>
      <span className={muted ? "text-xs" : "font-medium tabular-nums"} style={{ color: muted ? S.textMuted : toneColor(tone) }}>{value}</span>
    </div>
  )
}

// Painel lateral (título em caixa alta + linhas)
export function SidePanel({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <SurfaceCard padding="p-4">
      <div className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: S.textSecondary }}>{title}</div>
      <div className="space-y-1.5">{children}</div>
    </SurfaceCard>
  )
}

// Barra de ferramentas de tabela (filtros à esquerda, ações à direita)
export function TableToolbar({ left, right }: { left?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div className="flex items-center gap-2 flex-wrap">{left}</div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  )
}

// Menu de ações (kebab) — mesma célula "Ações" de todas as tabelas
export function ActionMenu({ onClick }: { onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Ações"
      className="grid place-items-center h-7 w-7 rounded-md transition-colors hover:bg-[var(--surface-hover)]" style={{ color: S.textSecondary }}>
      <MoreVertical className="h-4 w-4" />
    </button>
  )
}

// Paginação padrão de tabela (rodapé): "Mostrando X a Y de Z" + páginas + "N por página".
export function Pagination({
  from, to, total, unit = "itens", page = 1, pages = 1, onPage, perPage = 20, onPerPage, left,
}: {
  from?: number; to?: number; total?: number; unit?: string
  page?: number; pages?: number; onPage?: (p: number) => void
  perPage?: number; onPerPage?: (n: number) => void; left?: React.ReactNode
}) {
  const nums: (number | "…")[] = []
  if (pages <= 5) { for (let i = 1; i <= pages; i++) nums.push(i) }
  else { nums.push(1, 2, 3, "…", pages) }
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap pt-3 mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
      <div>{left ?? <>Mostrando {from ?? 0} a {to ?? 0} de {total ?? 0} {unit}</>}</div>
      <div className="flex items-center gap-2">
        {pages > 1 && (
          <div className="flex items-center gap-1">
            <PageBtn disabled={page <= 1} onClick={() => onPage?.(page - 1)}><ChevronLeft className="h-4 w-4" /></PageBtn>
            {nums.map((n, i) => n === "…"
              ? <span key={`e${i}`} className="px-1" style={{ color: "var(--text-muted)" }}>…</span>
              : <PageBtn key={n} active={n === page} onClick={() => onPage?.(n)}>{n}</PageBtn>)}
            <PageBtn disabled={page >= pages} onClick={() => onPage?.(page + 1)}><ChevronRight className="h-4 w-4" /></PageBtn>
          </div>
        )}
        <div className="relative">
          <select
            value={perPage} onChange={(e) => onPerPage?.(Number(e.target.value))}
            className="appearance-none rounded-[var(--radius-sm)] border pl-3 pr-7 py-1.5 text-sm outline-none cursor-pointer"
            style={{ background: "var(--surface-primary)", borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
          >
            {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n} por página</option>)}
          </select>
          <ChevronRight className="h-3.5 w-3.5 rotate-90 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-muted)" }} />
        </div>
      </div>
    </div>
  )
}
function PageBtn({ children, active, disabled, onClick }: { children: React.ReactNode; active?: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className="min-w-8 h-8 px-2 grid place-items-center rounded-[var(--radius-sm)] border text-sm transition-colors disabled:opacity-40"
      style={{
        background: active ? "color-mix(in srgb, var(--accent-primary) 15%, transparent)" : "transparent",
        borderColor: active ? "color-mix(in srgb, var(--accent-primary) 45%, transparent)" : "var(--border-default)",
        color: active ? "var(--accent-primary)" : "var(--text-secondary)",
      }}>
      {children}
    </button>
  )
}

export const Chevron = ChevronRight

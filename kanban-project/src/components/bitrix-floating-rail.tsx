"use client"

// src/components/bitrix-floating-rail.tsx
// ============================================================================
// TRILHO FLUTUANTE — IDENTIDADE BITRIX (14-15/09/2026, ver plano em
// ~/.claude/plans/dapper-plotting-barto.md).
//
// No Bitrix24, uma faixa vertical fica fixa na borda direita da janela em
// TODA tela: sino, assistente de IA, marcador, avatares de conversa. O
// Discovery não tinha esse elemento — é componente novo, não reskin de algo
// existente. Monta uma vez (`SidebarWrapper`), nunca por página.
//
// O sino aqui é DECORATIVO: a notificação de verdade já vive em
// `HeaderBar` (SWR em `/api/notificacoes`, badge com contagem real). Duplicar
// esse fetch aqui criaria uma segunda fonte do mesmo sinal — contra a regra
// do projeto. Os outros três ícones (IA/marcador/conversas) também são
// decorativos: não existe recurso equivalente no Discovery ainda.
// ============================================================================

import { Bell, Sparkles, Bookmark } from "lucide-react"

export function BitrixFloatingRail() {
  return (
    <div
      className="fixed right-3 top-1/2 z-40 flex -translate-y-1/2 flex-col items-center gap-2"
      aria-hidden="true"
    >
      <button
        type="button"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-elevated)] text-[var(--text-secondary)] shadow-[var(--elev-2)] border border-[var(--border-default)] transition-colors hover:bg-[var(--surface-hover)]"
        title="Notificações"
      >
        <Bell className="h-4 w-4" />
      </button>
      <button
        type="button"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-elevated)] text-[var(--text-secondary)] shadow-[var(--elev-2)] border border-[var(--border-default)] transition-colors hover:bg-[var(--surface-hover)]"
        title="Assistente"
      >
        <Sparkles className="h-4 w-4" />
      </button>
      <button
        type="button"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-elevated)] text-[var(--text-secondary)] shadow-[var(--elev-2)] border border-[var(--border-default)] transition-colors hover:bg-[var(--surface-hover)]"
        title="Marcadores"
      >
        <Bookmark className="h-4 w-4" />
      </button>
    </div>
  )
}

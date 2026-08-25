"use client"

// ============================================================================
// BUSCA COMO COMANDO (⌘K) — gatilho + overlay
// ----------------------------------------------------------------------------
// A busca global não precisa de um campo permanente ocupando meia largura do
// cabeçalho: ela é usada em rajadas, não o tempo todo. Aqui ela vira uma pílula
// discreta que abre um overlay centralizado — e continua sendo O MESMO
// componente de busca (`GlobalSearch`), com o mesmo endpoint, o mesmo debounce e
// a mesma navegação por teclado. Este arquivo só cuida de ABRIR e FECHAR.
//
// `GlobalSearch` já expõe `autoFocusRef` exatamente para este caso: quem abre o
// overlay é quem manda o foco para o campo.
// ============================================================================

import * as React from "react"
import { createPortal } from "react-dom"
import { Search } from "lucide-react"
import { GlobalSearch } from "@/src/components/home/global-search"
import { LAYER } from "@/src/lib/ui/layers"
import { useIsClient } from "@/src/lib/cliente"

export function CommandPalette() {
  const [aberto, setAberto] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const noCliente = useIsClient()

  // Atalho global: ⌘K / Ctrl+K abre, Esc fecha. Só isto justifica um efeito —
  // é assinatura de evento do documento, não estado derivado.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setAberto(true)
      } else if (e.key === "Escape") {
        setAberto(false)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  // O foco vai para o campo no mesmo compasso em que o overlay aparece.
  React.useEffect(() => {
    if (aberto) inputRef.current?.focus()
  }, [aberto])

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        className="flex h-9 items-center gap-2 rounded-full border border-[var(--border-default)] bg-black/30 px-3 text-sm text-[var(--text-secondary)] backdrop-blur-md transition hover:border-[var(--border-strong)] hover:text-white/70 focus:outline-none focus:ring-2 focus:ring-white/20"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Buscar</span>
        <kbd className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">
          ⌘K
        </kbd>
      </button>

      {aberto &&
        noCliente &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Busca global"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setAberto(false)
            }}
            className="fixed inset-0 flex items-start justify-center bg-[var(--overlay-modal)] px-4 pt-[14vh] backdrop-blur-sm"
            style={{ zIndex: LAYER.aboveProcess }}
          >
            <div className="w-full max-w-xl rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-popover)] p-3 shadow-2xl">
              <GlobalSearch autoFocusRef={inputRef} />
              <p className="px-1 pt-2 text-[11px] text-[var(--text-muted)]">
                Família, requerente, processo ou cliente · <kbd className="text-[var(--text-secondary)]">Esc</kbd> para fechar
              </p>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

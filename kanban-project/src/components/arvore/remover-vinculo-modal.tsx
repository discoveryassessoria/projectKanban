"use client"

// src/components/arvore/remover-vinculo-modal.tsx
// ============================================================================
// CONFIRMAÇÃO DE REMOÇÃO DE VÍNCULO — a única porta para remover pai/mãe/união
// pelo canvas. (Esc fecha pela captura global da árvore — dono único do Escape.) A tecla Delete/Backspace NÃO remove mais nada (ver react-flow-tree);
// remover é ação explícita, com o efeito dito antes.
//
// O modal não escreve nada sozinho: `executar` é a função da tela, que chama as
// rotas oficiais (as que passam por `aplicarMudancaNaArvore`). Erro do servidor
// (guarda bloqueou) aparece AQUI, dentro do modal, sem fechá-lo.
// ============================================================================

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, Loader2, Unlink, X } from "lucide-react"
import { LAYER } from "@/src/lib/ui/layers"
import { efeitoDoVinculo, type VinculoRemovivel } from "@/src/lib/genealogia/vinculos-edicao"

export function RemoverVinculoModal({
  vinculo,
  onFechar,
  executar,
}: {
  vinculo: VinculoRemovivel
  onFechar: () => void
  /** Devolve `null` quando deu certo, ou a mensagem do servidor. */
  executar: (vinculo: VinculoRemovivel) => Promise<string | null>
}) {
  const [executando, setExecutando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const cancelarRef = useRef<HTMLButtonElement>(null)
  const efeito = efeitoDoVinculo(vinculo)

  // Foco no CANCELAR: Enter sem querer não destrói nada.
  useEffect(() => { cancelarRef.current?.focus() }, [])

  if (typeof document === "undefined") return null

  const confirmar = async () => {
    setExecutando(true)
    setErro(null)
    const msg = await executar(vinculo)
    setExecutando(false)
    if (msg) setErro(msg)
  }

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: LAYER.aboveProcessCritical }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="remover-vinculo-titulo"
    >
      <div className="absolute inset-0 bg-[var(--overlay-modal)]" onClick={executando ? undefined : onFechar} />
      <div className="relative w-full max-w-md overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] shadow-[var(--elev-3)]">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border-default)] px-5 py-4">
          <h2 id="remover-vinculo-titulo" className="text-base font-semibold text-red-700">{efeito.titulo}</h2>
          <button
            type="button"
            onClick={onFechar}
            disabled={executando}
            aria-label="Fechar"
            className="rounded-md p-1 text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)] disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4 text-sm text-[var(--text-secondary)]">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide">Quem é afetado</h3>
            <ul className="mt-1.5 space-y-1">
              {efeito.afetados.map((a) => <li key={a} className="font-medium text-[var(--text-primary)]">{a}</li>)}
            </ul>
          </section>
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide">O que muda na documentação</h3>
            <ul className="mt-1.5 list-disc space-y-1 pl-5">
              {efeito.efeitos.map((e) => <li key={e}>{e}</li>)}
            </ul>
          </section>
          <p className="text-xs">Depois de remover, Ctrl+Z (ou Cmd+Z) restaura o vínculo.</p>

          {erro && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-2.5 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{erro}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-[var(--border-default)] px-5 py-4">
          <button
            type="button"
            onClick={() => void confirmar()}
            disabled={executando}
            className="flex items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-2.5 text-sm font-medium text-[var(--action-primary-ink)] transition-colors hover:bg-red-800 disabled:opacity-40"
          >
            {executando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink className="h-4 w-4" />}
            Remover vínculo
          </button>
          <button
            ref={cancelarRef}
            type="button"
            onClick={onFechar}
            disabled={executando}
            className="rounded-lg px-4 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] disabled:opacity-40"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

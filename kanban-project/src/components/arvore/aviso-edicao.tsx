"use client"

// src/components/arvore/aviso-edicao.tsx
// ============================================================================
// AVISO DE EDIÇÃO — a faixa curta no pé da árvore que diz o que acabou de
// acontecer ("Vínculo removido") e oferece a saída ("Desfazer"/"Refazer").
// Erro nunca some sozinho rápido demais: o operador precisa ler o que o
// servidor respondeu.
// ============================================================================

import { useEffect } from "react"
import { AlertTriangle, CheckCircle2, X } from "lucide-react"
import { LAYER } from "@/src/lib/ui/layers"

export interface AvisoEdicaoDados {
  id: number
  tipo: "sucesso" | "erro"
  mensagem: string
  acao?: { rotulo: string; onClick: () => void }
}

export function AvisoEdicao({ aviso, onFechar }: { aviso: AvisoEdicaoDados | null; onFechar: () => void }) {
  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(onFechar, aviso.tipo === "erro" ? 15000 : 9000)
    return () => clearTimeout(t)
  }, [aviso, onFechar])

  if (!aviso) return null
  const erro = aviso.tipo === "erro"
  return (
    <div
      role={erro ? "alert" : "status"}
      aria-live={erro ? "assertive" : "polite"}
      className="fixed bottom-6 left-1/2 flex max-w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] px-4 py-3 text-sm text-gray-900 shadow-[var(--elev-3)]"
      style={{ zIndex: LAYER.toast }}
    >
      {erro ? (
        <AlertTriangle className="h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-700" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1">{aviso.mensagem}</span>
      {aviso.acao && (
        <button
          type="button"
          onClick={aviso.acao.onClick}
          className="shrink-0 rounded px-2 py-1 font-semibold text-[var(--action-primary)] hover:bg-[var(--surface-secondary)]"
        >
          {aviso.acao.rotulo}
        </button>
      )}
      <button
        type="button"
        onClick={onFechar}
        aria-label="Fechar aviso"
        className="shrink-0 rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}

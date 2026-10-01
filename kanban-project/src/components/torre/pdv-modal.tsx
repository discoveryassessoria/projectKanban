"use client"
// src/components/torre/pdv-modal.tsx — a MOLDURA dos modais largos do "Precisa de você" (Revisar o dia 760 px · Briefing 720 px).
// Superfície opaca do Design System (tokens globais, camada de `LAYER`), fecha no clique de fora e no Esc.
import { useEffect, type ReactNode } from "react"
import { LAYER } from "@/src/lib/ui/layers"
import "./precisa.css"

export function PdvModal({ rotulo, classe, onFechar, children }: { rotulo: string; classe: "rev" | "brief" | "peq"; onFechar: () => void; children: ReactNode }) {
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar() }
    window.addEventListener("keydown", aoTeclar)
    return () => window.removeEventListener("keydown", aoTeclar)
  }, [onFechar])
  return (
    <div className="pdv-overlay tor" style={{ zIndex: LAYER.popover }} onClick={onFechar}>
      <div role="dialog" aria-modal="true" aria-label={rotulo} className={`pdv-modal ${classe}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

/** Diálogo pequeno das ações do "Precisa de você" (escolher pessoa, justificativa, registrar ligação…) — mesmo visual dos modais largos. */
export function PdvDialogo({ titulo, subtitulo, onFechar, rodape, ocupado, children }: {
  titulo: string; subtitulo?: string; onFechar: () => void; rodape: ReactNode; ocupado?: boolean; children: ReactNode
}) {
  return (
    <PdvModal rotulo={titulo} classe="peq" onFechar={ocupado ? () => undefined : onFechar}>
      <div>
        <div className="pdv-dlg-t">{titulo}</div>
        {subtitulo && <div className="pdv-det">{subtitulo}</div>}
      </div>
      {children}
      <div className="pdv-dlg-rodape">{rodape}</div>
    </PdvModal>
  )
}

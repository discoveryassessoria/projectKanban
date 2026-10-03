"use client"

// src/components/kanban/ConferenciaColetaHost.tsx
// ============================================================================
// Escuta o pedido de conferência (`pedirConferenciaColeta`) e mostra o modal. Montado UMA
// vez no layout — assim toda porta de mudança de fase abre a mesma conferência.
// ============================================================================

import { useEffect, useState } from "react"
import { EVENTO_CONFERENCIA_COLETA, type DetalheConferenciaColeta } from "@/src/lib/coleta/conferencia-evento"
import { ConferenciaColetaModal } from "./ConferenciaColetaModal"

export function ConferenciaColetaHost() {
  const [pedido, setPedido] = useState<DetalheConferenciaColeta | null>(null)
  useEffect(() => {
    const aoPedir = (e: Event) => setPedido((e as CustomEvent<DetalheConferenciaColeta>).detail)
    window.addEventListener(EVENTO_CONFERENCIA_COLETA, aoPedir)
    return () => window.removeEventListener(EVENTO_CONFERENCIA_COLETA, aoPedir)
  }, [])
  if (!pedido) return null
  return (
    <ConferenciaColetaModal
      processoId={pedido.processoId}
      onFechar={() => setPedido(null)}
      onConcluida={() => { const repetir = pedido.aoConcluir; setPedido(null); repetir?.() }}
    />
  )
}

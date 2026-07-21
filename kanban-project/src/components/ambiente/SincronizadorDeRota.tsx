"use client"

// src/components/ambiente/SincronizadorDeRota.tsx
//
// Neutraliza o ambiente nas áreas CORPORATIVAS (sem país). Não lê DOM/texto —
// decide só pela ROTA. As telas com país (Kanban, view de processo) dirigem o
// ambiente por conta própria (focarPais / entrarNoProcesso); aqui NÃO tocamos
// nelas, para não limpar o país durante navegação interna (evita flash neutro).

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { useAmbiente } from "@/src/contexts/ambiente-context"
import { rotaEhNeutra } from "@/src/lib/ambiente/rotas"

export function SincronizadorDeRota() {
  const pathname = usePathname()
  const { neutralizar } = useAmbiente()

  useEffect(() => {
    if (rotaEhNeutra(pathname)) neutralizar()
    // /kanban, /genealogy e rotas de processo: dirigidas pelas próprias telas.
  }, [pathname, neutralizar])

  return null
}

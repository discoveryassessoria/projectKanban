"use client"

// src/components/ambiente/AmbienteEscopo.tsx
//
// Publica as --amb-* na árvore inteira. Fica logo abaixo do provider e acima do
// conteúdo, para que qualquer .amb-* funcione em qualquer profundidade sem que
// o componente saiba de país algum.

import { useAmbiente } from "@/src/contexts/ambiente-context"
import { AmbienteFundo } from "./AmbienteFundo"

export function AmbienteEscopo({ children }: { children: React.ReactNode }) {
  const { ambiente } = useAmbiente()

  return (
    <div className="amb-escopo contents" style={ambiente.cssVars}>
      {children}
    </div>
  )
}

/**
 * Raiz do ambiente: fundo vivo + escopo de cores. Montado uma única vez, acima
 * do router, para que o fundo NÃO remonte ao navegar entre módulos.
 */
export function AmbienteRaiz({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AmbienteFundo />
      <AmbienteEscopo>{children}</AmbienteEscopo>
    </>
  )
}

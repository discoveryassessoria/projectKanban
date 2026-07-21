"use client"

// src/components/ambiente/AmbienteRaiz.tsx
//
// Raiz do ambiente, montada UMA vez na raiz autenticada (SidebarWrapper). Define
// explicitamente a hierarquia de camadas SEM z-index negativo:
//   z-0  → fundo visual (AmbienteFundo) + véu
//   z-10 → shell da aplicação (sidebar, header, conteúdo, modais herdam acima)
// O provider fica aqui em cima do conteúdo, então sobrevive às trocas de rota:
// o fundo NÃO remonta ao navegar entre Kanban/Lista/Financeiro/Documentos/Árvore.

import { AmbienteProvider } from "@/src/contexts/ambiente-context"
import { AmbienteFundo } from "./AmbienteFundo"
import { SincronizadorDeRota } from "./SincronizadorDeRota"

export function AmbienteRaiz({ children }: { children: React.ReactNode }) {
  return (
    <AmbienteProvider>
      <AmbienteFundo />
      <SincronizadorDeRota />
      <div className="relative z-10">{children}</div>
    </AmbienteProvider>
  )
}

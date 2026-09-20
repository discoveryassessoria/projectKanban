"use client"

import { createContext, useContext, useState, ReactNode } from "react"

interface SidebarContextType {
  isCollapsed: boolean
  setIsCollapsed: (value: boolean) => void
  /**
   * DRAWER MOBILE — estado PRÓPRIO, nunca reaproveita `isCollapsed` (mandato
   * "modernização visual — sidebar mobile", 19/09/2026). `isCollapsed` é o
   * trilho ícone-só do desktop; no mobile, fora do Kanban, a barra lateral
   * não tem "trilho" — ou está fechada (fora da tela) ou aberta (drawer
   * cobrindo o conteúdo). Kanban nunca lê este campo: fica inerte pra ele,
   * zero efeito colateral.
   */
  mobileAberto: boolean
  setMobileAberto: (value: boolean) => void
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined)

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [mobileAberto, setMobileAberto] = useState(false)

  return (
    <SidebarContext.Provider value={{ isCollapsed, setIsCollapsed, mobileAberto, setMobileAberto }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebarContext() {
  const context = useContext(SidebarContext)
  if (context === undefined) {
    throw new Error("useSidebarContext must be used within a SidebarProvider")
  }
  return context
}
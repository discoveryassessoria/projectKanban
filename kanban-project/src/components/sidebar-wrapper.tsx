"use client"

import { BitrixSidebar } from "@/src/components/bitrix-sidebar"
import { SidebarProvider, useSidebarContext } from "@/src/contexts/sidebar-context"
import { useSidebarVisibility } from "@/src/hooks/use-sidebar-visibility"
import { usePathname } from "next/navigation"
import { AmbienteRaiz } from "@/src/components/ambiente/AmbienteRaiz"

function SidebarContent({ children }: { children: React.ReactNode }) {
  const { isCollapsed } = useSidebarContext()

  // ─── POR QUE ESTE SHELL NÃO É FLEX ─────────────────────────────────────────
  // Era `flex` + `w-full` + filho `flex-1`. Nesse arranjo um descendente largo
  // demais consegue INFLAR o container (o `min-width: auto` do item de flex),
  // a página inteira fica mais larga que a janela, e como o recorte era
  // `overflow-hidden` a sobra sumia sem barra de rolagem: no iMac desapareciam
  // o sino, o avatar, o "Sair" e as últimas bandeiras, e a barra lateral saía
  // da tela ao rolar.
  //
  // Bloco não infla. Uma `div` de bloco tira a largura do bloco pai — que é a
  // janela — e vale exatamente `janela − margem`, aconteça o que acontecer lá
  // dentro. O recorte é `overflow-x: clip` e não `hidden`/`auto` de propósito:
  // `auto` viraria contêiner de rolagem e levaria junto o eixo vertical,
  // quebrando o cabeçalho `sticky`; `clip` corta só na horizontal e deixa a
  // página rolar de cima a baixo como sempre. Quem é largo de verdade (Kanban
  // de dez colunas, tabela comprida) rola no PRÓPRIO contêiner, com barra à
  // vista — é o que impede a lateral de sair da tela e o "Sair" de sumir.
  return (
    <div className="min-h-screen w-full max-w-[100vw] [overflow-x:clip] bg-transparent">
      <BitrixSidebar />
      <div
        className={`
          min-w-0 max-w-full [overflow-x:clip] transition-[margin] duration-300 ease-in-out
          ${isCollapsed ? "ml-16" : "ml-64"}
        `}
      >
        {children}
      </div>
    </div>
  )
}

export function SidebarWrapper({ children }: { children: React.ReactNode }) {
  const shouldShowSidebar = useSidebarVisibility()
  const pathname = usePathname()

  if (!shouldShowSidebar) {
    const isAuthPage = pathname.startsWith("/login")
    if (isAuthPage) {
      return <>{children}</>
    }
    return <div className="min-h-screen w-full">{children}</div>
  }

  return (
    <AmbienteRaiz>
      <SidebarProvider>
        <SidebarContent>{children}</SidebarContent>
      </SidebarProvider>
    </AmbienteRaiz>
  )
}
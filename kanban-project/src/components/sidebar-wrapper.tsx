// src/components/sidebar-wrapper.tsx
"use client"

import { BitrixSidebar } from "@/src/components/bitrix-sidebar"
import { SidebarProvider, useSidebarContext } from "@/src/contexts/sidebar-context"
import { useSidebarVisibility } from "@/src/hooks/use-sidebar-visibility"
import { useIsAdmin } from "@/src/hooks/use-is-admin"
import { usePathname } from "next/navigation"

function SidebarContent({ children }: { children: React.ReactNode }) {
  const { isCollapsed } = useSidebarContext()
  const { isAdmin } = useIsAdmin()

  return (
    <div className="flex min-h-screen w-full bg-transparent">
      <BitrixSidebar isAdmin={isAdmin} />
      {/* Main content - margem baseada apenas no estado colapsado real, não no hover */}
      {/* ✅ CORREÇÃO: min-w-0 e overflow-hidden para impedir expansão */}
      <div 
        className={`
          flex-1 min-w-0 overflow-hidden transition-all duration-300 ease-in-out
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
      // páginas de login/registro controlam o próprio layout
      return <>{children}</>
    }

    // páginas sem sidebar
    return <div className="min-h-screen w-full">{children}</div>
  }

  return (
    <SidebarProvider>
      <SidebarContent>{children}</SidebarContent>
    </SidebarProvider>
  )
}
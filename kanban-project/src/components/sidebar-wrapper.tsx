// src/components/sidebar-wrapper.tsx
'use client'
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/src/components/app-sidebar";
import { useSidebarVisibility } from "@/src/hooks/use-sidebar-visibility";
import { usePathname } from 'next/navigation';

export function SidebarWrapper({ children }: { children: React.ReactNode }) {
  const shouldShowSidebar = useSidebarVisibility()
  const pathname = usePathname()

  if (!shouldShowSidebar) {
    const isAuthPage = pathname.startsWith('/auth')
    
    if (isAuthPage) {
      // Layout específico para páginas de auth - deixa a página controlar completamente o layout
      return <>{children}</>
    }
    
    // Para outras páginas sem sidebar - layout normal
    return (
      <div className="min-h-screen w-full">
        {children}
      </div>
    )
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <main className="flex-1 w-full">
        <SidebarTrigger />
        {children}
      </main>
    </SidebarProvider>
  )
}
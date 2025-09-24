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
    // Classes específicas para páginas sem sidebar (como auth)
    const isAuthPage = pathname.startsWith('/auth')
    
    return (
      <div className={`min-h-screen w-full ${
        isAuthPage 
          ? 'flex items-center justify-center bg-gray-50' // Centralizado para auth
          : '' // Normal para outras páginas sem sidebar
      }`}>
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
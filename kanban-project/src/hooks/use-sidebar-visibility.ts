// src/hooks/use-sidebar-visibility.ts (ou onde preferir)
'use client'
import { usePathname } from 'next/navigation'

export function useSidebarVisibility() {
  const pathname = usePathname()
  
  // Rotas que NÃO devem ter sidebar
  const noSidebarRoutes = ['/auth', '/login', '/register']
  
  return !noSidebarRoutes.some(route => pathname.startsWith(route))
}

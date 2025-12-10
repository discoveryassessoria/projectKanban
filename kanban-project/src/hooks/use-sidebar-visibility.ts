"use client"

import { usePathname } from "next/navigation"

export function useSidebarVisibility() {
  const pathname = usePathname()

  // Hide sidebar on auth pages
  if (pathname.startsWith("/login")) {
    return false
  }

  // Show sidebar on all other pages
  return true
}

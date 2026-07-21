"use client"

import { ThemeProvider } from "@/src/contexts/theme-context"
import { ToastProvider } from "@/src/contexts/toast-context"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        {children}
      </ToastProvider>
    </ThemeProvider>
  )
}
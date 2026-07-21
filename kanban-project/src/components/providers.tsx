"use client"

import { ThemeProvider } from "@/src/contexts/theme-context"
import { ToastProvider } from "@/src/contexts/toast-context"
import { AmbienteProvider } from "@/src/contexts/ambiente-context"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      {/* Ambiente acima do router: é o que faz o fundo do processo sobreviver
          à navegação entre módulos. Ver ambiente-context.tsx. */}
      <AmbienteProvider>
        <ToastProvider>
          {children}
        </ToastProvider>
      </AmbienteProvider>
    </ThemeProvider>
  )
}
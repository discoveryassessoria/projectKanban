"use client"

import { ThemeProvider } from "@/src/contexts/theme-context"
import { ToastProvider } from "@/src/contexts/toast-context"
import { SessaoProvider } from "@/src/components/sessao/SessaoProvider"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        {/* Gerente de sessão na RAIZ: uma instância para o app inteiro.
            Sem token (login, páginas públicas) ele fica inerte. */}
        <SessaoProvider>{children}</SessaoProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}
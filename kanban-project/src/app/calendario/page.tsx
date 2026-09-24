// src/app/calendario/page.tsx
//
// CALENDÁRIO — casca da tela. Mesmo shell das demais telas (fundo + HeaderBar
// + main), mesmo porteiro por PERMISSÃO. O conteúdo vive em
// src/components/operacao/calendario-consular.tsx.
//
// Só o DESENHO por enquanto (mandato 24/09/2026, explícito do usuário) — sem
// fonte de dado, sem prazo de Tarefa. A configuração dos agendamentos
// consulares vem depois.

"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { HeaderBarApp } from "@/src/components/header-bar-app"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { encerrarSessao } from "@/src/lib/sessao/cliente"
import { useIsClient, useJsonLocalStorage } from "@/src/lib/cliente"
import { CalendarioConsular } from "@/src/components/operacao/calendario-consular"

const CARREGANDO = (
  <div className="relative min-h-screen [overflow-x:clip] text-[var(--text-primary)]">
    <div className="pointer-events-none fixed inset-0 -z-10 bg-[var(--app-background)]" />
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[var(--border-default)] border-t-transparent" />
        <p className="text-[var(--text-secondary)]">Carregando calendário…</p>
      </div>
    </div>
  </div>
)

export default function CalendarioPage() {
  const router = useRouter()
  const { pode, carregando } = usePermissoes()
  const mounted = useIsClient()
  const userSalvo = useJsonLocalStorage<{ nome?: string; tipo?: string; email?: string }>("user")
  const user = userSalvo ?? { nome: "Usuário" }

  const autorizado = pode("tarefas.ver")

  useEffect(() => {
    if (mounted && !carregando && !autorizado) router.push("/")
  }, [mounted, carregando, autorizado, router])

  if (!mounted || carregando || !autorizado) return CARREGANDO

  return (
    <div className="relative min-h-screen [overflow-x:clip] overscroll-none text-[var(--text-primary)]">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[var(--app-background)]" />

      <HeaderBarApp
        title="Calendário"
        subtitle="Agendamentos consulares da operação."
        userName={user.nome}
        userRole={user.tipo === "admin" ? "Administrador" : user.tipo || "Usuário"}
        onLogout={() => void encerrarSessao("manual")}
      />

      <main className="flex max-h-[calc(100vh-80px)] flex-col pb-16">
        <CalendarioConsular />
      </main>
    </div>
  )
}

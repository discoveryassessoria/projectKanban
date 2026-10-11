// src/app/leads/page.tsx
//
// LEADS — a rota `/leads` (docs/leads-mandato.md, regras 19 a 27): quem chegou pelo WhatsApp, a conversa com o agente e a
// resposta da pessoa. Mesmo casco da Torre. Acesso só para quem tem a permissão EXCLUSIVA `leads.atender` — o middleware
// não protege esta página; a API confere a permissão de novo em cada chamada.

"use client"

import { Suspense, useEffect } from "react"
import { useRouter } from "next/navigation"
import { HeaderBarApp } from "@/src/components/header-bar-app"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { encerrarSessao } from "@/src/lib/sessao/cliente"
import { useIsClient, useJsonLocalStorage } from "@/src/lib/cliente"
import { Leads } from "@/src/components/leads/Leads"

const CARREGANDO = (
  <div className="relative min-h-screen [overflow-x:clip] text-[var(--text-primary)]">
    <div className="pointer-events-none fixed inset-0 -z-10 bg-[var(--app-background)]" />
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[var(--border-default)] border-t-transparent" />
        <p className="text-[var(--text-secondary)]">Carregando os leads…</p>
      </div>
    </div>
  </div>
)

export default function LeadsPage() {
  return (
    <Suspense fallback={CARREGANDO}>
      <LeadsPageConteudo />
    </Suspense>
  )
}

function LeadsPageConteudo() {
  const router = useRouter()
  const { pode, carregando } = usePermissoes()
  const mounted = useIsClient()
  const userSalvo = useJsonLocalStorage<{ nome?: string; tipo?: string }>("user")
  const user = userSalvo ?? { nome: "Usuário" }
  const autorizado = pode("leads.atender")

  useEffect(() => {
    if (mounted && !carregando && !autorizado) router.push("/dashboard")
  }, [mounted, carregando, autorizado, router])

  if (!mounted || carregando || !autorizado) return CARREGANDO

  const perfil = user.tipo === "admin" ? "Administrador" : user.tipo || "Usuário"
  return (
    <div className="relative min-h-screen [overflow-x:clip] overscroll-none text-[var(--text-primary)]">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[var(--app-background)]" />
      <HeaderBarApp
        title="Leads"
        subtitle="Quem chegou pelo WhatsApp e ainda não virou processo. O agente faz o primeiro atendimento; você continua por aqui."
        userName={user.nome}
        userRole={perfil}
        onLogout={() => void encerrarSessao("manual")}
      />
      <main className="flex max-h-[calc(100vh-80px)] flex-col px-3 pb-16 pt-4 sm:px-6 sm:pt-6">
        <div className="flex min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-lg border border-white/[0.08] bg-[var(--surface-page)] p-2 sm:p-4">
          <div className="min-w-0 flex-1"><Leads /></div>
        </div>
      </main>
    </div>
  )
}

// src/app/torre/page.tsx
//
// TORRE DE CONTROLE — casca provisória dos Blocos G/H (30/09/2026). SEM item no menu (Decisão 3
// do Passo 0: o menu só entra no Bloco J). Mesmo shell da Operação; acesso só para administrador e
// gerência operacional (`operacao.distribuirTarefas`) — a API confere de novo em cada chamada.

"use client"

import { Suspense, useEffect } from "react"
import { useRouter } from "next/navigation"
import { HeaderBarApp } from "@/src/components/header-bar-app"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { encerrarSessao } from "@/src/lib/sessao/cliente"
import { useIsClient, useJsonLocalStorage } from "@/src/lib/cliente"
import { Torre } from "@/src/components/torre/Torre"

const CARREGANDO = (
  <div className="relative min-h-screen [overflow-x:clip] text-[var(--text-primary)]">
    <div className="pointer-events-none fixed inset-0 -z-10 bg-[var(--app-background)]" />
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[var(--border-default)] border-t-transparent" />
        <p className="text-[var(--text-secondary)]">Carregando a Torre de Controle…</p>
      </div>
    </div>
  </div>
)

export default function TorrePage() {
  return (
    <Suspense fallback={CARREGANDO}>
      <TorrePageConteudo />
    </Suspense>
  )
}

function TorrePageConteudo() {
  const router = useRouter()
  const { pode, carregando } = usePermissoes()
  const mounted = useIsClient()
  const userSalvo = useJsonLocalStorage<{ nome?: string; tipo?: string; email?: string }>("user")
  const user = userSalvo ?? { nome: "Usuário" }
  const autorizado = user.tipo === "admin" || pode("operacao.distribuirTarefas")

  useEffect(() => {
    if (mounted && !carregando && !autorizado) router.push("/")
  }, [mounted, carregando, autorizado, router])

  if (!mounted || carregando || !autorizado) return CARREGANDO

  const hoje = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })
  return (
    <div className="relative min-h-screen [overflow-x:clip] overscroll-none text-[var(--text-primary)]">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[var(--app-background)]" />
      <HeaderBarApp
        title="Torre de Controle"
        subtitle={`${hoje} · fonte: projeção da Operação`}
        userName={user.nome}
        userRole={user.tipo === "admin" ? "Administrador" : user.tipo || "Usuário"}
        onLogout={() => void encerrarSessao("manual")}
      />
      <main className="flex max-h-[calc(100vh-80px)] flex-col px-6 pb-16 pt-6">
        <div className="flex min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-lg border border-white/[0.08] bg-[var(--surface-page)] p-4">
          <div className="min-w-0 flex-1"><Torre /></div>
        </div>
      </main>
    </div>
  )
}

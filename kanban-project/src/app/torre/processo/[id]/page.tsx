// src/app/torre/processo/[id]/page.tsx
//
// O PROCESSO COMO PÁGINA — Torre nova, Etapa A (01/10/2026). CASCA SIMPLES: o dono do detalhe (H) a preenche. Mesmo portão e
// mesma régua de acesso da Torre (`useIsClient` antes de qualquer coisa; só administrador e gerência operacional); a API
// confere de novo em cada chamada. O Foco (modal) continua funcionando até aqui estar completo.

"use client"

import { Suspense, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { HeaderBarApp } from "@/src/components/header-bar-app"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { encerrarSessao } from "@/src/lib/sessao/cliente"
import { useIsClient, useJsonLocalStorage } from "@/src/lib/cliente"
import { TorreProcessoPagina } from "@/src/components/torre/TorreProcessoPagina"

const CARREGANDO = (
  <div className="relative min-h-screen [overflow-x:clip] text-[var(--text-primary)]">
    <div className="pointer-events-none fixed inset-0 -z-10 bg-[var(--app-background)]" />
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[var(--border-default)] border-t-transparent" />
        <p className="text-[var(--text-secondary)]">Carregando o processo…</p>
      </div>
    </div>
  </div>
)

export default function TorreProcessoRota() {
  return (
    <Suspense fallback={CARREGANDO}>
      <TorreProcessoConteudo />
    </Suspense>
  )
}

function TorreProcessoConteudo() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const { pode, carregando } = usePermissoes()
  const mounted = useIsClient()
  const userSalvo = useJsonLocalStorage<{ nome?: string; tipo?: string; email?: string }>("user")
  const user = userSalvo ?? { nome: "Usuário" }
  const autorizado = user.tipo === "admin" || pode("operacao.distribuirTarefas")
  const processoId = Number(params?.id)
  const idValido = Number.isInteger(processoId) && processoId > 0

  useEffect(() => {
    if (mounted && !carregando && !autorizado) router.push("/operacao")
  }, [mounted, carregando, autorizado, router])

  if (!mounted || carregando || !autorizado) return CARREGANDO

  const perfil = user.tipo === "admin" ? "Administrador" : user.tipo || "Usuário"
  return (
    <div className="relative min-h-screen [overflow-x:clip] overscroll-none text-[var(--text-primary)]">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[var(--app-background)]" />
      <HeaderBarApp title="Torre de Controle" subtitle="Processo" userName={user.nome} userRole={perfil} onLogout={() => void encerrarSessao("manual")} />
      <main className="flex max-h-[calc(100vh-80px)] flex-col px-3 pb-16 pt-4 sm:px-6 sm:pt-6">
        <div className="flex min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-lg border border-white/[0.08] bg-[var(--surface-page)] p-2 sm:p-4">
          <div className="min-w-0 flex-1">{idValido ? <TorreProcessoPagina processoId={processoId} /> : <div className="tor-card pad">Processo inválido.</div>}</div>
        </div>
      </main>
    </div>
  )
}

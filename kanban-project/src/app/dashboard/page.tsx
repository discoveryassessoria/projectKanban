"use client"

// ============================================================================
// CENTRAL OPERACIONAL — tela inicial do Discovery.
// Substitui o antigo "Painel Principal" (Total de Processos / Processos por
// País / histórico longo sobre foto de fundo). Aqui o foco é ação: o que exige
// atenção, o que fazer hoje, o que está bloqueado, o que pode avançar, onde
// estão os gargalos, a agenda e a atividade recente — tudo clicável.
//
// A página é fina: guarda de auth + carga da API agregadora (/api/home) via
// SWR, com skeleton, estado de erro e estado vazio. Toda a regra de leitura
// vive no backend; nada de números decorativos.
// ============================================================================

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useHomeData } from "@/src/components/home/use-home"
import { HomeContent } from "@/src/components/home/home-content"
import { HomeSkeleton } from "@/src/components/home/home-skeleton"
import { ErrorState } from "@/src/components/home/home-primitives"

export default function DashboardPage() {
  const router = useRouter()
  const [autorizado, setAutorizado] = useState(false)
  const { data, error, isLoading, recarregar } = useHomeData()

  // Guarda de autenticação (mesmo padrão do restante do app).
  useEffect(() => {
    const token = localStorage.getItem("authToken")
    const userData = localStorage.getItem("user")
    if (!token || !userData) {
      router.replace("/login")
      return
    }
    setAutorizado(true)
  }, [router])

  function handleLogout() {
    localStorage.removeItem("authToken")
    localStorage.removeItem("user")
    document.cookie = "authToken=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT"
    router.replace("/login")
  }

  // Sessão expirada durante a chamada → volta pro login.
  useEffect(() => {
    const status = (error as (Error & { status?: number }) | undefined)?.status
    if (status === 401) handleLogout()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error])

  if (!autorizado) return <div className="min-h-screen bg-slate-50" />

  return (
    <div className="min-h-screen bg-slate-50">
      {isLoading && !data ? (
        <HomeSkeleton />
      ) : error && !data ? (
        <div className="mx-auto max-w-7xl px-4 py-10 md:px-6">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <ErrorState onRetry={() => recarregar()} mensagem="Não foi possível carregar a Central Operacional." />
          </div>
        </div>
      ) : data ? (
        <HomeContent data={data} onLogout={handleLogout} recarregar={() => recarregar()} />
      ) : (
        <HomeSkeleton />
      )}
    </div>
  )
}

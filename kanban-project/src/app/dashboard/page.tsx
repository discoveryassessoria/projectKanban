"use client"

// ============================================================================
// HOME — CENTRO OPERACIONAL do escritório
// ----------------------------------------------------------------------------
// A tela inicial deixou de ser dashboard executivo: tudo o que aparece aqui
// ajuda a decidir o que fazer nos próximos minutos. Receita, caixa, processos
// ativos, processos por fase, workflow macro, indicadores e atividade recente
// pertencem aos módulos especializados e NÃO voltam para cá.
//
// A página é fina: guarda de auth + carga da API agregadora (/api/home) via
// SWR, com skeleton e estado de erro. Toda a leitura vive no backend.
// ============================================================================

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useHomeData } from "@/src/components/home/use-home"
import { HomeContent } from "@/src/components/home/home-content"
import { HomeShell } from "@/src/components/home/home-shell"
import { HomeSkeleton } from "@/src/components/home/home-skeleton"
import { BlocoCard, ErrorState } from "@/src/components/home/home-primitives"
import { encerrarSessao } from "@/src/lib/sessao/cliente"

export default function DashboardPage() {
  const router = useRouter()
  const [autorizado, setAutorizado] = useState(false)
  const { data, error, isLoading, recarregar } = useHomeData()

  useEffect(() => {
    const token = localStorage.getItem("authToken")
    const userData = localStorage.getItem("user")
    if (!token || !userData) {
      router.replace("/login")
      return
    }
    setAutorizado(true)
  }, [router])

  // Sessão expirada durante a chamada → volta pro login.
  useEffect(() => {
    const status = (error as (Error & { status?: number }) | undefined)?.status
    if (status === 401) {
      void encerrarSessao("token_invalido")
    }
  }, [error, router])

  if (!autorizado) {
    return (
      <HomeShell>
        <HomeSkeleton />
      </HomeShell>
    )
  }

  return (
    <HomeShell>
      {isLoading && !data ? (
        <HomeSkeleton />
      ) : error && !data ? (
        <div className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-6">
          <BlocoCard>
            <ErrorState onRetry={() => recarregar()} mensagem="Não foi possível carregar o Centro Operacional." />
          </BlocoCard>
        </div>
      ) : data ? (
        <HomeContent data={data} />
      ) : (
        <HomeSkeleton />
      )}
    </HomeShell>
  )
}

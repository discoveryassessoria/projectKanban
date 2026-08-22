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
import { encerrarSessao, credenciaisDoCliente, descartarCredenciais } from "@/src/lib/sessao/cliente"
import { useIsClient, useLocalStorage } from "@/src/lib/cliente"

export default function DashboardPage() {
  const router = useRouter()
  const { data, error, isLoading, recarregar } = useHomeData()
  // "Autorizado" é uma LEITURA de sessão, não um estado da tela: token e usuário
  // presentes. Como estado escrito por efeito, custava um render em que a Home já
  // existia mostrando o esqueleto mesmo com a sessão válida em mãos.
  const noCliente = useIsClient()
  const token = useLocalStorage("authToken")
  const usuario = useLocalStorage("user")
  // A MESMA DEFINIÇÃO DE SESSÃO QUE A TELA DE LOGIN USA. Aqui era "token + user" e
  // lá era "token + cookie": com `user` ausente, cada lado mandava para o outro,
  // num laço de ~150 navegações por segundo. `token`/`usuario` acima continuam
  // alimentando o render (é o que decide mostrar o esqueleto); quem decide NAVEGAR
  // é a definição única.
  const autorizado = noCliente && Boolean(token && usuario)

  // Sem sessão, volta para o login. Navegar é efeito; a autorização não era.
  useEffect(() => {
    if (!noCliente) return
    const c = credenciaisDoCliente()
    if (c.completa) return
    // APAGA ANTES DE SAIR. Ir para o login deixando credencial pela metade é o que
    // fazia o login mandar de volta para cá — cada tela confiando no sinal que a
    // outra não olhava.
    if (c.incompleta) descartarCredenciais()
    router.replace("/login")
  }, [noCliente, router])

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

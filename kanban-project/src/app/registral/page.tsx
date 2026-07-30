// src/app/registral/page.tsx
//
// REVISÃO REGISTRAL — casca da tela.
//
// Mesmo shell das demais telas do sistema (fundo + HeaderBar + main), mesmo
// contrato de hidratação (`useIsClient` + leituras pela camada oficial) e mesmo
// porteiro por PERMISSÃO das outras páginas. O conteúdo vive em
// src/components/registral/central-registral.tsx.
//
// Nenhum arquivo da Árvore Genealógica é tocado: esta é uma superfície NOVA.

"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { HeaderBar } from "@/src/components/header-bar"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { encerrarSessao } from "@/src/lib/sessao/cliente"
import { useIsClient, useJsonLocalStorage } from "@/src/lib/cliente"
import { useApi } from "@/src/lib/dados"
import { CentralRegistral, type ProcessoOpcao } from "@/src/components/registral/central-registral"
import type { ProcessoWithStatus } from "@/src/types/kanban"

/** Forma mínima que o HeaderBar consome das árvores. */
interface ItemNomeado {
  id: number | string
  nome: string
  descricao?: string | null
}

export default function RegistralPage() {
  const router = useRouter()
  const { pode, carregando } = usePermissoes()
  const mounted = useIsClient()
  const userSalvo = useJsonLocalStorage<{ nome?: string; tipo?: string; email?: string }>("user")
  const user = userSalvo ?? { nome: "Usuário" }

  const [processoId, setProcessoId] = useState<number | null>(null)

  const processosReq = useApi<{ processos?: ProcessoWithStatus[] }>("/api/processos")
  const arvoresReq = useApi<ItemNomeado[]>("/api/arvore")
  const processos = processosReq.dados?.processos ?? []
  const arvores = Array.isArray(arvoresReq.dados) ? arvoresReq.dados : []

  // Ver evidência é o piso: quem não tem isso não entra na tela.
  const autorizado = pode("registral.ver_evidencias") || pode("registral.revisar")

  useEffect(() => {
    if (mounted && !carregando && !autorizado) router.push("/")
  }, [mounted, carregando, autorizado, router])

  // Primeiro processo da lista como padrão — a tela sem processo não mostra nada
  // útil, e escolher o primeiro é melhor que exigir um clique para ver qualquer coisa.
  useEffect(() => {
    if (processoId == null && processos.length > 0) setProcessoId(Number(processos[0].id))
  }, [processoId, processos])

  const handleLogout = () => {
    void encerrarSessao("manual")
  }

  if (!mounted || carregando || !autorizado) {
    return (
      <div className="relative min-h-screen text-white overflow-x-hidden">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
        <div className="min-h-screen bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin h-12 w-12 border-4 border-white border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-white/70">Carregando revisão registral…</p>
          </div>
        </div>
      </div>
    )
  }

  const opcoes: ProcessoOpcao[] = processos.map((p) => ({
    id: Number(p.id),
    nome: p.nome,
    codigo: (p as { codigo?: string | null }).codigo ?? null,
  }))

  return (
    <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
      <div className="pointer-events-none fixed inset-0 -z-10 scale-105 blur-[6px] bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
      <div className="pointer-events-none fixed inset-0 -z-10 bg-black/60" />

      <HeaderBar
        title="Revisão Registral"
        subtitle="Certidões, evidências e decisões da árvore"
        userName={user.nome}
        userRole={user.tipo === "admin" ? "Administrador" : user.tipo || "Usuário"}
        userEmail={user.email || ""}
        projetos={[]}
        processos={processos}
        arvores={arvores}
        onLogout={handleLogout}
      />

      <div className="min-h-screen relative">
        <div className="absolute inset-0 bg-black/10 pointer-events-none" />
        <main className="relative px-4 py-4 max-w-full">
          <CentralRegistral
            processos={opcoes}
            processoId={processoId}
            aoTrocarProcesso={setProcessoId}
            permissoes={{
              aprovar: pode("registral.aprovar"),
              revisar: pode("registral.revisar"),
              alterarFiliacao: pode("registral.alterar_filiacao"),
              mesclarPessoas: pode("registral.mesclar_pessoas"),
              reverter: pode("registral.reverter"),
            }}
            podeProcessar={pode("registral.reprocessar")}
          />
        </main>
      </div>
    </div>
  )
}

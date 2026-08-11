// src/app/operacao/page.tsx
//
// OPERAÇÃO — casca da tela de tarefas canônicas.
//
// Mesmo shell das demais telas (fundo + HeaderBar + main), mesmo contrato de
// hidratação e mesmo porteiro por PERMISSÃO. O conteúdo vive em
// src/components/operacao/central-tarefas.tsx.
//
// Superfície NOVA: nasce sobre a Tarefa canônica e não toca a árvore legada de
// subtarefas (`tarefaPaiId`, COBRANCA, CONFERENCIA) que a tela de Atividades
// ainda usa.

"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { HeaderBar } from "@/src/components/header-bar"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { encerrarSessao } from "@/src/lib/sessao/cliente"
import { useIsClient, useJsonLocalStorage } from "@/src/lib/cliente"
import { CentralTarefas } from "@/src/components/operacao/central-tarefas"

const FUNDO =
  "linear-gradient(180deg, rgba(8,9,11,.985) 0%, rgba(8,9,11,.975) 46%, rgba(8,9,11,.95) 60%," +
  " rgba(8,9,11,.86) 72%, rgba(8,9,11,.76) 86%, rgba(8,9,11,.88) 100%)"

export default function OperacaoPage() {
  const router = useRouter()
  const { pode, carregando } = usePermissoes()
  const mounted = useIsClient()
  const userSalvo = useJsonLocalStorage<{ nome?: string; tipo?: string; email?: string }>("user")
  const user = userSalvo ?? { nome: "Usuário" }

  // Ver tarefa é o piso da tela; distribuir é o que separa quem executa de quem
  // gere. A permissão manda no que aparece — e o backend confere de novo, porque
  // esconder botão não é controle de acesso.
  const autorizado = pode("tarefas.ver")
  const podeDistribuir = pode("tarefas.editar")

  useEffect(() => {
    if (mounted && !carregando && !autorizado) router.push("/")
  }, [mounted, carregando, autorizado, router])

  if (!mounted || carregando || !autorizado) {
    return (
      <div className="relative min-h-screen overflow-x-hidden text-white">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
        <div className="pointer-events-none fixed inset-0 -z-10" style={{ background: FUNDO }} />
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-white border-t-transparent" />
            <p className="text-white/70">Carregando operação…</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden overscroll-none text-white">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
      <div className="pointer-events-none fixed inset-0 -z-10" style={{ background: FUNDO }} />

      <HeaderBar
        title="Operação"
        subtitle="Tarefas, distribuição e minha fila"
        userName={user.nome}
        userRole={user.tipo === "admin" ? "Administrador" : user.tipo || "Usuário"}
        onLogout={() => void encerrarSessao("manual")}
      />

      <main className="px-6 pb-16 pt-6">
        <CentralTarefas podeDistribuir={podeDistribuir} />
      </main>
    </div>
  )
}

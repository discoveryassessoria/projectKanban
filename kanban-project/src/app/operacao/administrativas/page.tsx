// src/app/operacao/administrativas/page.tsx
//
// TAREFAS ADMINISTRATIVAS — casca da visão gerencial das obrigações
// administrativas canônicas (tipo: ADMINISTRATIVA).
//
// Mesmo shell das demais telas de operação (fundo + HeaderBar + main), mesmo
// contrato de hidratação e mesmo porteiro por PERMISSÃO. O conteúdo vive em
// src/components/operacao/tarefas-administrativas.tsx.

"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { HeaderBar } from "@/src/components/header-bar"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { encerrarSessao } from "@/src/lib/sessao/cliente"
import { useIsClient, useJsonLocalStorage } from "@/src/lib/cliente"
import { TarefasAdministrativas } from "@/src/components/operacao/tarefas-administrativas"

const FUNDO = "var(--landscape-veil)"

export default function TarefasAdministrativasPage() {
  const router = useRouter()
  const { pode, carregando } = usePermissoes()
  const mounted = useIsClient()
  const userSalvo = useJsonLocalStorage<{ nome?: string; tipo?: string; email?: string }>("user")
  const user = userSalvo ?? { nome: "Usuário" }

  // MESMA hierarquia de "Tarefas e Projetos": gerir as obrigações
  // administrativas de todo mundo é ato de gestão, não de execução.
  // `tarefas.editar` sozinho também autoriza editar a PRÓPRIA tarefa, então
  // não prova gestão. O backend confere de novo — esconder a tela não é
  // controle de acesso.
  const autorizado = pode("tarefas.editar") && user.tipo === "admin"

  useEffect(() => {
    if (mounted && !carregando && !autorizado) router.push("/operacao")
  }, [mounted, carregando, autorizado, router])

  if (!mounted || carregando || !autorizado) {
    return (
      <div className="relative min-h-screen [overflow-x:clip] text-white">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
        <div className="pointer-events-none fixed inset-0 -z-10" style={{ background: FUNDO }} />
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[var(--border-default)] border-t-transparent" />
            <p className="text-white/70">Carregando tarefas administrativas…</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen [overflow-x:clip] overscroll-none text-white">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
      <div className="pointer-events-none fixed inset-0 -z-10" style={{ background: FUNDO }} />

      <HeaderBar
        title="Tarefas Administrativas"
        subtitle="O que precisa ser gerido — nunca a certidão, sempre a distribuição do trabalho"
        userName={user.nome}
        userRole={user.tipo === "admin" ? "Administrador" : user.tipo || "Usuário"}
        onLogout={() => void encerrarSessao("manual")}
      />

      <main className="px-6 pb-16 pt-6">
        <TarefasAdministrativas />
      </main>
    </div>
  )
}

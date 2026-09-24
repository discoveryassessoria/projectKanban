// src/app/operacao/distribuicao/page.tsx
//
// DISTRIBUIÇÃO DE TAREFAS — casca da tela. Mesmo shell das demais telas de
// operação (fundo + HeaderBar + main), mesmo porteiro por PERMISSÃO
// (`tarefas.editar` — é quem distribui, não quem só executa a própria fila).
// O conteúdo vive em src/components/operacao/distribuicao-tarefas.tsx.
//
// Aberta a partir do botão "Distribuir tarefas" do cartão de obrigação
// administrativa (Minha Operação) — tela PRÓPRIA (mandato 24/09/2026), não a
// mesma superfície de Tarefas e Projetos.

"use client"

import { Suspense, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronRight } from "lucide-react"
import { HeaderBarApp } from "@/src/components/header-bar-app"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { encerrarSessao } from "@/src/lib/sessao/cliente"
import { useIsClient, useJsonLocalStorage } from "@/src/lib/cliente"
import { DistribuicaoTarefas } from "@/src/components/operacao/distribuicao-tarefas"

const CARREGANDO = (
  <div className="relative min-h-screen [overflow-x:clip] text-[var(--text-primary)]">
    <div className="pointer-events-none fixed inset-0 -z-10 bg-[var(--app-background)]" />
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[var(--border-default)] border-t-transparent" />
        <p className="text-[var(--text-secondary)]">Carregando distribuição…</p>
      </div>
    </div>
  </div>
)

export default function DistribuicaoPage() {
  return (
    <Suspense fallback={CARREGANDO}>
      <DistribuicaoPageConteudo />
    </Suspense>
  )
}

function DistribuicaoPageConteudo() {
  const router = useRouter()
  const { pode, carregando } = usePermissoes()
  const mounted = useIsClient()
  const userSalvo = useJsonLocalStorage<{ nome?: string; tipo?: string; email?: string }>("user")
  const user = userSalvo ?? { nome: "Usuário" }

  // Distribuir é gestão de toda a operação — a mesma régua de "Sem
  // responsável" na Central e em Tarefas e Projetos: `tarefas.editar` sozinho
  // também autoriza editar a PRÓPRIA tarefa, então o backend (não a tela)
  // decide quem é gestor de verdade em cada porta que este componente chama.
  const autorizado = pode("tarefas.editar")

  useEffect(() => {
    if (mounted && !carregando && !autorizado) router.push("/operacao")
  }, [mounted, carregando, autorizado, router])

  if (!mounted || carregando || !autorizado) return CARREGANDO

  return (
    <div className="relative min-h-screen [overflow-x:clip] overscroll-none text-[var(--text-primary)]">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[var(--app-background)]" />

      <HeaderBarApp
        title="Operação"
        subtitle="Distribuição de tarefas"
        userName={user.nome}
        userRole={user.tipo === "admin" ? "Administrador" : user.tipo || "Usuário"}
        onLogout={() => void encerrarSessao("manual")}
      />

      <nav className="flex items-center gap-1.5 px-6 pt-4 text-[12px] text-[var(--text-secondary)]">
        <Link href="/dashboard" className="hover:text-[var(--text-primary)] hover:underline">Grupo Discovery</Link>
        <ChevronRight className="h-3 w-3 text-[var(--text-muted)]" />
        <Link href="/operacao" className="hover:text-[var(--text-primary)] hover:underline">Operação</Link>
        <ChevronRight className="h-3 w-3 text-[var(--text-muted)]" />
        <span className="font-medium text-[var(--text-primary)]">Distribuição de tarefas</span>
      </nav>

      <main className="flex max-h-[calc(100vh-116px)] flex-col pb-16">
        <DistribuicaoTarefas />
      </main>
    </div>
  )
}

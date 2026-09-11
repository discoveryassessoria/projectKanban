// src/app/operacao/central/page.tsx
//
// CENTRAL OPERACIONAL — casca da tela. Mesmo shell das demais telas de
// operação (fundo + HeaderBar + main), mesmo porteiro por PERMISSÃO. O
// conteúdo vive em src/components/operacao/central-operacional.tsx.

"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { HeaderBar } from "@/src/components/header-bar"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { encerrarSessao } from "@/src/lib/sessao/cliente"
import { useIsClient, useJsonLocalStorage } from "@/src/lib/cliente"
import { CentralOperacional } from "@/src/components/operacao/central-operacional"

const FUNDO = "var(--landscape-veil)"

export default function CentralOperacionalPage() {
  const router = useRouter()
  const { pode, carregando } = usePermissoes()
  const mounted = useIsClient()
  const userSalvo = useJsonLocalStorage<{ nome?: string; tipo?: string; email?: string }>("user")
  const user = userSalvo ?? { nome: "Usuário" }

  const autorizado = pode("tarefas.ver")

  useEffect(() => {
    if (mounted && !carregando && !autorizado) router.push("/")
  }, [mounted, carregando, autorizado, router])

  if (!mounted || carregando || !autorizado) {
    return (
      <div className="relative min-h-screen [overflow-x:clip] text-white">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
        <div className="pointer-events-none fixed inset-0 -z-10" style={{ background: FUNDO }} />
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[var(--border-default)] border-t-transparent" />
            <p className="text-white/70">Carregando a Central Operacional…</p>
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
        title="Central Operacional"
        subtitle="O que a empresa precisa fazer agora — agrupado por família"
        userName={user.nome}
        userRole={user.tipo === "admin" ? "Administrador" : user.tipo || "Usuário"}
        onLogout={() => void encerrarSessao("manual")}
      />

      <main className="px-6 pb-16 pt-6">
        <CentralOperacional />
      </main>
    </div>
  )
}

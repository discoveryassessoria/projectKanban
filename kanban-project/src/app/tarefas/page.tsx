// src/app/tarefas/page.tsx
//
// TAREFAS E PROJETOS — casca da visão gerencial global.
//
// Mesmo shell das demais telas (fundo + HeaderBar + main), mesmo contrato de
// hidratação e mesmo porteiro por PERMISSÃO. O conteúdo vive em
// src/components/operacao/visao-global.tsx.
//
// É a visão de QUEM RESPONDE PELA OPERAÇÃO: tudo o que existe, onde está, com
// quem, e o que já estourou. A Tarefa é a mesma da Minha Fila e da Central —
// não existe entidade de projeto, de board ou de atividade por trás dela.
//
// A tela ocupa a altura da janela porque o Kanban rola nas colunas, não na
// página: um quadro que empurra o rodapé para baixo obriga a rolar duas vezes
// para ver a mesma coluna.

"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { HeaderBar } from "@/src/components/header-bar"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { encerrarSessao } from "@/src/lib/sessao/cliente"
import { useIsClient, useJsonLocalStorage } from "@/src/lib/cliente"
import { VisaoGlobal } from "@/src/components/operacao/visao-global"

const FUNDO =
  "var(--landscape-veil)"

export default function TarefasEProjetosPage() {
  const router = useRouter()
  const { pode, carregando } = usePermissoes()
  const mounted = useIsClient()
  const userSalvo = useJsonLocalStorage<{ nome?: string; tipo?: string; email?: string }>("user")
  const user = userSalvo ?? { nome: "Usuário" }

  // Ver a operação INTEIRA é ato de gestão: exige a mesma permissão de
  // distribuir. Quem só executa tem a Minha Fila, que já é a sua visão do
  // mundo. O backend confere de novo — esconder a tela não é controle de acesso.
  const autorizado = pode("tarefas.editar")

  useEffect(() => {
    if (mounted && !carregando && !autorizado) router.push("/operacao")
  }, [mounted, carregando, autorizado, router])

  if (!mounted || carregando || !autorizado) {
    return (
      <div className="relative min-h-screen overflow-x-hidden text-white">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
        <div className="pointer-events-none fixed inset-0 -z-10" style={{ background: FUNDO }} />
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[var(--border-default)] border-t-transparent" />
            <p className="text-white/70">Carregando a operação…</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-screen flex-col overflow-hidden text-white">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
      <div className="pointer-events-none fixed inset-0 -z-10" style={{ background: FUNDO }} />

      <HeaderBar
        title="Tarefas e Projetos"
        subtitle="Toda a operação: o que existe, com quem está e o que já estourou"
        userName={user.nome}
        userRole={user.tipo === "admin" ? "Administrador" : user.tipo || "Usuário"}
        onLogout={() => void encerrarSessao("manual")}
      />

      <main className="min-h-0 flex-1 px-6 pb-4 pt-4">
        <div className="h-full overflow-hidden rounded-lg border border-white/[0.08] bg-black/25">
          <VisaoGlobal />
        </div>
      </main>
    </div>
  )
}

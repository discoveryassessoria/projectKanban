// src/app/operacao/page.tsx
//
// OPERAÇÃO — casca da tela de tarefas canônicas.
//
// Mesmo shell das demais telas (fundo + HeaderBar + main), mesmo contrato de
// hidratação e mesmo porteiro por PERMISSÃO. O conteúdo vive em
// src/components/operacao/minha-operacao.tsx.
//
// Superfície NOVA: nasce sobre a Tarefa canônica. A árvore de subtarefas que
// existia antes (`tarefaPaiId`) foi removida do schema — a execução se desdobra
// nos PASSOS do workflow, não em tarefas-filhas.

"use client"

import { Suspense, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { HeaderBarApp } from "@/src/components/header-bar-app"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { encerrarSessao } from "@/src/lib/sessao/cliente"
import { useIsClient, useJsonLocalStorage } from "@/src/lib/cliente"
import { MinhaOperacao } from "@/src/components/operacao/minha-operacao"

const CARREGANDO = (
  <div className="relative min-h-screen [overflow-x:clip] text-[var(--text-primary)]">
    <div className="pointer-events-none fixed inset-0 -z-10 bg-[var(--app-background)]" />
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[var(--border-default)] border-t-transparent" />
        <p className="text-[var(--text-secondary)]">Carregando operação…</p>
      </div>
    </div>
  </div>
)

// `useSearchParams()` exige um limite de Suspense — sem isto o build estático
// falha ("should be wrapped in a suspense boundary") na hora de prerenderizar
// a página. `OperacaoPageConteudo` é quem lê `?aba=`; a casca só monta o
// limite, com o MESMO visual de carregamento de sempre como fallback.
export default function OperacaoPage() {
  return (
    <Suspense fallback={CARREGANDO}>
      <OperacaoPageConteudo />
    </Suspense>
  )
}

function OperacaoPageConteudo() {
  const router = useRouter()
  const { pode, carregando } = usePermissoes()
  const mounted = useIsClient()
  const userSalvo = useJsonLocalStorage<{ nome?: string; tipo?: string; email?: string }>("user")
  const user = userSalvo ?? { nome: "Usuário" }

  // Operação é a fila PESSOAL de quem está logado — só isso. Distribuir é
  // gestão de TODA a operação da empresa: tem tela PRÓPRIA em
  // `/operacao/distribuicao` (mandato 24/09/2026), aberta a partir do cartão
  // de obrigação administrativa acima — nunca uma aba misturada aqui dentro.
  const autorizado = pode("tarefas.ver")

  useEffect(() => {
    if (mounted && !carregando && !autorizado) router.push("/")
  }, [mounted, carregando, autorizado, router])

  if (!mounted || carregando || !autorizado) return CARREGANDO

  return (
    <div className="relative min-h-screen [overflow-x:clip] overscroll-none text-[var(--text-primary)]">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[var(--app-background)]" />

      {/* Cabeçalho extremamente limpo (decisão do usuário, 16/09/2026): só o
          nome da tela e o que ela promete — sem métrica nem informação
          decorativa aqui. Os elementos globais (busca, câmbio, data,
          notificações, usuário, sair) são os mesmos do resto do sistema. */}
      <HeaderBarApp
        title="Minha Operação"
        subtitle="Tudo que precisa da sua atenção agora."
        userName={user.nome}
        userRole={user.tipo === "admin" ? "Administrador" : user.tipo || "Usuário"}
        onLogout={() => void encerrarSessao("manual")}
      />

      {/* `max-h` (não `h`): a lista pode PRECISAR do teto para rolar quando
          tem muita coisa, mas com poucos resultados o contêiner deve encolher
          para o conteúdo — não esticar até a viewport e deixar um vazio
          enorme embaixo (achado do mandato "modernização visual", 19/09/2026). */}
      <main className="flex max-h-[calc(100vh-80px)] flex-col px-6 pb-16 pt-6">
        <div className="mb-4 flex items-center justify-end gap-3">
          <Link
            href="/operacao/central"
            className="rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"
          >
            Abrir Central Operacional →
          </Link>
        </div>
        {/* `flex` aqui (não só `flex-1`): o filho usa `flex-1` pra herdar
            altura, e isso só funciona como ITEM de flexbox — `height:100%`
            contra um ancestral `display:block` não resolvia (achado real
            24/09/2026, a rolagem da Minha Operação nunca reproduzia). */}
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-white/[0.08]">
          <MinhaOperacao />
        </div>
      </main>
    </div>
  )
}

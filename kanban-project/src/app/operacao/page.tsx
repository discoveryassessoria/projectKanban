// src/app/operacao/page.tsx
//
// OPERAÇÃO — casca da tela de tarefas canônicas.
//
// Mesmo shell das demais telas (fundo + HeaderBar + main), mesmo contrato de
// hidratação e mesmo porteiro por PERMISSÃO. O conteúdo vive em
// src/components/operacao/central-tarefas.tsx.
//
// Superfície NOVA: nasce sobre a Tarefa canônica. A árvore de subtarefas que
// existia antes (`tarefaPaiId`) foi removida do schema — a execução se desdobra
// nos PASSOS do workflow, não em tarefas-filhas.

"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { HeaderBarApp } from "@/src/components/header-bar-app"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { encerrarSessao } from "@/src/lib/sessao/cliente"
import { useIsClient, useJsonLocalStorage } from "@/src/lib/cliente"
import { CentralTarefas } from "@/src/components/operacao/central-tarefas"
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
  const paramsIniciais = useSearchParams()
  const { pode, carregando } = usePermissoes()
  const mounted = useIsClient()
  const userSalvo = useJsonLocalStorage<{ nome?: string; tipo?: string; email?: string }>("user")
  const user = userSalvo ?? { nome: "Usuário" }

  // Ver tarefa é o piso da tela; distribuir é o que separa quem executa de quem
  // gere. `tarefas.editar` sozinho não prova isso — também autoriza editar a
  // PRÓPRIA tarefa —, então distribuir exige admin. O backend confere de novo,
  // porque esconder aba não é controle de acesso.
  const autorizado = pode("tarefas.ver")
  const podeDistribuir = pode("tarefas.editar") && user.tipo === "admin"
  // Minha Operação é a projeção PESSOAL (mandato 15/09/2026) — o que era
  // `CentralTarefas` inteira vira, para quem distribui, uma segunda aba: a
  // distribuição ("Sem responsável") continua exatamente como estava, sem
  // nenhuma mudança de comportamento — só deixou de ser a única vista.
  // DEEP-LINK — a tarefa administrativa "Atribuir tarefas" (dentro de Minha
  // Operação) manda pra cá com `?aba=distribuicao`, lido só uma vez, no mount.
  const [aba, setAba] = useState<"minha_operacao" | "distribuicao">(() =>
    paramsIniciais.get("aba") === "distribuicao" ? "distribuicao" : "minha_operacao",
  )

  // DEEP-LINK REATIVO: o `useState` acima só lê a URL no PRIMEIRO mount. Quem
  // clica em "Distribuir tarefas" de dentro de Minha Operação já aberta
  // (`/operacao` → `/operacao?aba=distribuicao&processo=N`) navega para a
  // MESMA rota — o componente não remonta, o `useState` não reavalia, e a
  // aba fica presa em "Minha Operação" mesmo com a URL certa. Parecia um
  // clique morto (achado real 24/09/2026). `useSearchParams()` muda de
  // identidade a cada navegação, mesmo sem remount — é o sinal certo.
  useEffect(() => {
    if (paramsIniciais.get("aba") === "distribuicao") setAba("distribuicao")
  }, [paramsIniciais])

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
      <main className={`px-6 pb-16 pt-6 ${aba === "minha_operacao" ? "flex max-h-[calc(100vh-80px)] flex-col" : ""}`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex gap-1">
            <button
              onClick={() => setAba("minha_operacao")}
              className={`rounded-t border-b-2 px-3 py-1.5 text-[12px] font-medium transition-colors ${
                aba === "minha_operacao" ? "border-[var(--action-primary)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              Minha Operação
            </button>
            {podeDistribuir && (
              <button
                onClick={() => setAba("distribuicao")}
                className={`rounded-t border-b-2 px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  aba === "distribuicao" ? "border-[var(--action-primary)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                Distribuição
              </button>
            )}
          </div>
          <Link
            href="/operacao/central"
            className="rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"
          >
            Abrir Central Operacional →
          </Link>
        </div>
        {aba === "minha_operacao" && (
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-white/[0.08]">
            <MinhaOperacao />
          </div>
        )}
        {aba === "distribuicao" && podeDistribuir && <CentralTarefas podeDistribuir={podeDistribuir} />}
      </main>
    </div>
  )
}

// src/app/relatorios/page.tsx
//
// RELATÓRIOS — POUCOS DOMÍNIOS, MOTOR DE FILTROS FORTE.
//
// ─── O QUE ESTA TELA NÃO É ──────────────────────────────────────────────────
// Não é um catálogo de relatórios prontos, e não é um dashboard. "Todos os
// protocolos de janeiro de 2023" não ganha uma entrada no menu: é o domínio
// Protocolos com um período. Se cada pergunta virasse um item, o menu cresceria
// para sempre e duas entradas acabariam respondendo a mesma coisa de formas
// diferentes.
//
// ─── A NACIONALIDADE ────────────────────────────────────────────────────────
// A versão anterior montava o seletor de NACIONALIDADE com o cadastro
// GEOGRÁFICO de países. Argentina, Brasil, Estados Unidos, França, Paraguai e
// Reino Unido apareciam como se fossem cidadanias vendidas — eles estão no
// cadastro porque são o país de um consulado ou de um fornecedor. Agora a lista
// vem de `/api/relatorios/meta`, que só devolve país COM oferta ativa. O país do
// órgão continua saindo da geografia, e é outro filtro.
//
// ─── SEM SEGUNDO SIDEBAR ────────────────────────────────────────────────────
// O menu global do Discovery continua sendo o menu. Os domínios são abas do
// workspace, não uma segunda navegação vertical competindo com a primeira.

"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { HeaderBar } from "@/src/components/header-bar"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { encerrarSessao } from "@/src/lib/sessao/cliente"
import { useIsClient, useJsonLocalStorage } from "@/src/lib/cliente"
import { Workspace } from "@/src/components/relatorios/workspace"

const auth = () => ({ Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("authToken") ?? "" : ""}` })

interface DominioResumo {
  key: string; rotulo: string; descricao: string; grain: string; ordem: number
  permissao: string; aceitaNacionalidade: boolean
}
interface VisaoResumo { id: number; dominio: string; nome: string; favorita: boolean; usadaEm: string | null }

function Conteudo() {
  const router = useRouter()
  const params = useSearchParams()
  const { pode, carregando } = usePermissoes()
  const mounted = useIsClient()
  const userSalvo = useJsonLocalStorage<{ nome?: string; tipo?: string }>("user")
  const user = userSalvo ?? { nome: "Usuário" }

  const [dominios, setDominios] = useState<DominioResumo[]>([])
  const [visoes, setVisoes] = useState<VisaoResumo[]>([])
  const [busca, setBusca] = useState("")

  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/relatorios/meta", { headers: auth() }).catch(() => null)
      if (r?.ok) setDominios((await r.json()).dominios ?? [])
    })()
    void (async () => {
      const r = await fetch("/api/relatorios/visoes", { headers: auth() }).catch(() => null)
      if (r?.ok) setVisoes((await r.json()).visoes ?? [])
    })()
  }, [])

  const dominioAtual = params.get("d")
  const abrir = useCallback((k: string | null) => router.push(k ? `/relatorios?d=${k}` : "/relatorios"), [router])

  const visiveis = dominios.filter((d) => pode(d.permissao as never))
  const autorizado = carregando || visiveis.length > 0

  useEffect(() => { if (mounted && !carregando && !autorizado) router.push("/") }, [mounted, carregando, autorizado, router])

  if (!mounted || carregando) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-[var(--border-default)] border-t-transparent" />
          <p className="text-[var(--text-secondary)]">Carregando relatórios…</p>
        </div>
      </div>
    )
  }
  if (!autorizado) return null

  const atual = visiveis.find((d) => d.key === dominioAtual) ?? null
  const filtrados = busca.trim()
    ? visiveis.filter((d) => `${d.rotulo} ${d.descricao}`.toLowerCase().includes(busca.trim().toLowerCase()))
    : visiveis

  return (
    <>
      <HeaderBar
        title="Relatórios"
        subtitle={atual ? atual.descricao : "Escolha um domínio e monte a pergunta"}
        userName={user.nome}
        userRole={user.tipo === "admin" ? "Administrador" : user.tipo || "Usuário"}
        onLogout={() => void encerrarSessao("manual")}
      />

      <main className="px-6 pb-16 pt-5">
        {/* TRILHA — não é sidebar; é onde se está. */}
        <div className="mb-4 flex items-center gap-1.5 text-[13px]">
          <button type="button" onClick={() => abrir(null)}
            className={atual ? "text-[var(--action-primary)] hover:underline" : "font-semibold text-[var(--text-primary)]"}>
            Relatórios
          </button>
          {atual && (
            <>
              <span className="text-[var(--text-muted)]">/</span>
              <span className="font-semibold text-[var(--text-primary)]">{atual.rotulo}</span>
            </>
          )}
        </div>

        {atual ? (
          <Workspace dominioKey={atual.key} />
        ) : (
          <div className="space-y-5">
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar um domínio…"
              className="w-full max-w-xl rounded-[12px] border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3.5 py-2.5 text-[14px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
            />

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Domínios</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {filtrados.map((d) => (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => abrir(d.key)}
                    className="rounded-[12px] border border-[var(--border-default)] bg-[var(--surface-primary)] p-3.5 text-left transition-colors hover:border-[var(--action-primary)]"
                  >
                    <p className="text-[14px] font-semibold text-[var(--text-primary)]">{d.rotulo}</p>
                    <p className="mt-0.5 text-[12px] leading-snug text-[var(--text-secondary)]">{d.descricao}</p>
                    <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">{d.grain}</p>
                  </button>
                ))}
                {filtrados.length === 0 && (
                  <p className="text-[13px] text-[var(--text-secondary)]">Nenhum domínio com esse nome.</p>
                )}
              </div>
            </div>

            {visoes.length > 0 && (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Favoritos</p>
                  <div className="rounded-[12px] border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
                    {visoes.filter((v) => v.favorita).length === 0
                      ? <p className="text-[13px] text-[var(--text-secondary)]">Nenhuma visão favoritada ainda.</p>
                      : visoes.filter((v) => v.favorita).map((v) => (
                        <button key={v.id} type="button" onClick={() => abrir(v.dominio)}
                          className="block py-0.5 text-left text-[13px] text-[var(--action-primary)] hover:underline">
                          {v.nome} <span className="text-[var(--text-muted)]">· {v.dominio}</span>
                        </button>
                      ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Recentes</p>
                  <div className="rounded-[12px] border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
                    {visoes.filter((v) => v.usadaEm).length === 0
                      ? <p className="text-[13px] text-[var(--text-secondary)]">Nada aberto recentemente.</p>
                      : visoes.filter((v) => v.usadaEm).slice(0, 6).map((v) => (
                        <button key={v.id} type="button" onClick={() => abrir(v.dominio)}
                          className="block py-0.5 text-left text-[13px] text-[var(--action-primary)] hover:underline">
                          {v.nome} <span className="text-[var(--text-muted)]">· {v.dominio}</span>
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </>
  )
}

export default function RelatoriosPage() {
  return (
    // O fundo continua ambiental, mas a leitura vem primeiro: o véu garante que
    // filtro e tabela nunca fiquem boiando sobre a paisagem.
    <div className="relative min-h-screen overflow-x-hidden overscroll-none">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
      <div className="pointer-events-none fixed inset-0 -z-10" style={{ background: "var(--landscape-veil)" }} />
      <Suspense fallback={null}>
        <Conteudo />
      </Suspense>
    </div>
  )
}

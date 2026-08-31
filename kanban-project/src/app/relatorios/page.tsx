// src/app/relatorios/page.tsx
//
// RELATÓRIOS — NACIONALIDADE → FAMÍLIA → RELATÓRIO.
//
// A navegação é por NACIONALIDADE porque é assim que a operação se divide: cada
// nacionalidade tem órgão próprio (consulado × tribunal), base jurídica própria
// e regra de requerimento própria. "Todas as nacionalidades" existe porque
// algumas perguntas só fazem sentido consolidadas.
//
// A LISTA DE NACIONALIDADES NÃO ESTÁ NESTE ARQUIVO. Ela vem de `CatalogoPais`,
// pelo endpoint do cadastro — uma rota nova aparece aqui sem deploy. Se você
// encontrar "Espanha" escrito em código nesta pasta, é regressão: existe guard
// (npm run test:relatorios) que falha por isso.
//
// A nacionalidade é CONTEXTO, não fork: existe UM relatório de Protocolos, e o
// país escolhido entra nele como filtro.

"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import dynamic from "next/dynamic"
import { HeaderBar } from "@/src/components/header-bar"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { encerrarSessao } from "@/src/lib/sessao/cliente"
import { useIsClient, useJsonLocalStorage } from "@/src/lib/cliente"
import { familiasVisiveis, relatorioPorChave } from "@/src/lib/relatorios/registry"

const FUNDO = "var(--landscape-veil)"
/** Valor do seletor quando nenhuma nacionalidade estreita a leitura. */
const TODAS = "__todas__"

const RelatorioProtocolos = dynamic(
  () => import("@/src/components/gerenciamentoComponents/RelatorioProtocolosTab"),
  { ssr: false, loading: () => <p className="text-sm text-white/70">Carregando relatório…</p> },
)
const RelatorioCompletude = dynamic(
  () => import("@/src/components/relatorios/RelatorioCompletude"),
  { ssr: false, loading: () => <p className="text-sm text-white/70">Carregando relatório…</p> },
)

/** Chave do catálogo → tela. A ligação vive aqui; o resto conhece só a chave. */
const TELAS: Record<string, React.ComponentType<{ paisKey: string | null }>> = {
  protocolos: RelatorioProtocolos as unknown as React.ComponentType<{ paisKey: string | null }>,
  "pendencias-por-pessoa": (props) => <RelatorioCompletude {...props} modo="pessoa" />,
  "pendencias-por-requisito": (props) => <RelatorioCompletude {...props} modo="requisito" />,
}

type PaisCadastro = { id: number; countryKey: string; countryLabel: string; flag?: string | null }

function Conteudo() {
  const router = useRouter()
  const params = useSearchParams()
  const { pode, carregando } = usePermissoes()
  const mounted = useIsClient()
  const userSalvo = useJsonLocalStorage<{ nome?: string; tipo?: string }>("user")
  const user = userSalvo ?? { nome: "Usuário" }

  const [paises, setPaises] = useState<PaisCadastro[]>([])
  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/gerenciamento/paises", {
        headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
      }).catch(() => null)
      if (!r?.ok) return
      const j = await r.json()
      const lista: PaisCadastro[] = j.paises ?? j.registros ?? j.catalogo ?? []
      setPaises(lista.filter((p) => p.countryKey))
    })()
  }, [])

  const grupos = useMemo(() => (carregando ? [] : familiasVisiveis(pode)), [pode, carregando])
  const autorizado = grupos.length > 0

  const paisKey = params.get("pais") ?? TODAS
  const chave = params.get("r")
  const atual = relatorioPorChave(chave) ?? grupos[0]?.itens[0] ?? null
  const Tela = atual ? TELAS[atual.key] : null

  useEffect(() => {
    if (mounted && !carregando && !autorizado) router.push("/")
  }, [mounted, carregando, autorizado, router])

  const irPara = (r: string, p: string) => router.push(`/relatorios?pais=${encodeURIComponent(p)}&r=${r}`)

  if (!mounted || carregando) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[var(--border-default)] border-t-transparent" />
          <p className="text-white/70">Carregando relatórios…</p>
        </div>
      </div>
    )
  }
  if (!autorizado) return null

  const paisAtual = paises.find((p) => p.countryKey === paisKey) ?? null

  return (
    <>
      <HeaderBar
        title="Relatórios"
        subtitle={atual ? `${atual.familia} · ${atual.granularidade}` : "Leituras da operação"}
        userName={user.nome}
        userRole={user.tipo === "admin" ? "Administrador" : user.tipo || "Usuário"}
        onLogout={() => void encerrarSessao("manual")}
      />

      <main className="px-6 pb-16 pt-6">
        <div className="flex flex-col gap-6 lg:flex-row">
          <nav className="w-full shrink-0 lg:w-72">
            {/* NACIONALIDADE — vinda do cadastro, nunca escrita aqui. */}
            <div className="mb-4 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Nacionalidade
              </p>
              <button
                type="button"
                onClick={() => irPara(atual?.key ?? "protocolos", TODAS)}
                className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${
                  paisKey === TODAS
                    ? "bg-[var(--action-primary)] font-medium text-[var(--text-inverse)]"
                    : "text-white/90 hover:bg-[var(--surface-hover)]"
                }`}
              >
                Todas as nacionalidades
              </button>
              {paises.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => irPara(atual?.key ?? "protocolos", p.countryKey)}
                  className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${
                    paisKey === p.countryKey
                      ? "bg-[var(--action-primary)] font-medium text-[var(--text-inverse)]"
                      : "text-white/90 hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  {p.flag ? `${p.flag} ` : ""}{p.countryLabel}
                </button>
              ))}
              {paises.length === 0 && (
                <p className="px-2 py-1 text-[11px] text-[var(--text-muted)]">
                  Nenhuma nacionalidade cadastrada em Países e Regiões.
                </p>
              )}
            </div>

            {/* FAMÍLIAS — cada relatório tem um domínio proprietário. */}
            <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
              {grupos.map((g) => (
                <div key={g.familia} className="mb-3 last:mb-0">
                  <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    {g.familia}
                  </p>
                  {g.itens.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => irPara(r.key, paisKey)}
                      className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${
                        atual?.key === r.key
                          ? "bg-[var(--action-primary)] font-medium text-[var(--text-inverse)]"
                          : "text-white/90 hover:bg-[var(--surface-hover)]"
                      }`}
                    >
                      {r.titulo}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </nav>

          <section className="min-w-0 flex-1">
            {atual && (
              <p className="mb-3 text-sm text-white/70">
                {atual.descricao}
                {paisAtual && <span className="text-white/50"> · {paisAtual.countryLabel}</span>}
              </p>
            )}
            {Tela ? <Tela paisKey={paisKey === TODAS ? null : paisKey} /> : <p className="text-sm text-white/70">Selecione um relatório.</p>}
          </section>
        </div>
      </main>
    </>
  )
}

export default function RelatoriosPage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden overscroll-none text-white">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
      <div className="pointer-events-none fixed inset-0 -z-10" style={{ background: FUNDO }} />
      <Suspense fallback={null}>
        <Conteudo />
      </Suspense>
    </div>
  )
}

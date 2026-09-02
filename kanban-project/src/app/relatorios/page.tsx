// src/app/relatorios/page.tsx
//
// RELATÓRIOS — NACIONALIDADE → DOMÍNIO → PERGUNTA.
//
// ─── O QUE ESTA TELA NÃO É ──────────────────────────────────────────────────
// Não é um catálogo de relatórios prontos. "Todos os protocolos de janeiro de
// 2023" não ganha entrada no menu: é o domínio Protocolos com um período. Se
// cada pergunta virasse um item, o menu cresceria para sempre e duas entradas
// acabariam respondendo a mesma coisa de formas diferentes.
//
// São 17 domínios × N nacionalidades — mas UMA implementação. A nacionalidade
// entra como contexto na consulta, e a diferença estrutural entre países sai do
// CADASTRO (a cardinalidade da modalidade legal), nunca de `if (pais)`.
//
// ─── A NACIONALIDADE ────────────────────────────────────────────────────────
// A versão anterior montava este seletor com o cadastro GEOGRÁFICO de países.
// Argentina, Brasil, Estados Unidos, França, Paraguai e Reino Unido apareciam
// como se fossem cidadanias vendidas — eles estão no cadastro porque são o país
// de um consulado ou de um fornecedor. Agora a lista vem de
// `/api/relatorios/meta`, que só devolve país COM oferta ativa. O país do órgão
// continua saindo da geografia, e é outro filtro, dentro do domínio.
//
// ─── POR QUE ESTA TELA CAÍA ─────────────────────────────────────────────────
// A versão anterior redirecionava para a home quando a lista de domínios estava
// vazia — e ela SEMPRE está vazia no primeiro render, porque vem de uma busca
// assíncrona. Resultado: a tela expulsava todo mundo antes de carregar. Aqui
// "ainda carregando" é um estado próprio, e só se redireciona quando a resposta
// chegou e realmente veio vazia. Falha de rede vira mensagem, não expulsão.

"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { HeaderBar } from "@/src/components/header-bar"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { encerrarSessao } from "@/src/lib/sessao/cliente"
import { useIsClient, useJsonLocalStorage } from "@/src/lib/cliente"
import { Workspace } from "@/src/components/relatorios/workspace"

const auth = () => ({
  Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("authToken") ?? "" : ""}`,
})

interface DominioResumo {
  key: string; rotulo: string; descricao: string; grain: string; ordem: number
  grupo: string; permissao: string; aceitaNacionalidade: boolean
}
interface Nacionalidade { valor: string; rotulo: string; detalhe?: string | null }
interface VisaoResumo { id: number; dominio: string; nome: string; favorita: boolean; usadaEm: string | null }

/** Três estados distintos. Confundi-los foi o que derrubou a tela anterior. */
type Estado = "carregando" | "pronto" | "erro"

const CARTAO = "rounded-[12px] border border-[var(--border-default)] bg-[var(--surface-primary)]"

function Conteudo() {
  const router = useRouter()
  const params = useSearchParams()
  const { pode, carregando: carregandoPermissoes } = usePermissoes()
  const mounted = useIsClient()
  const userSalvo = useJsonLocalStorage<{ nome?: string; tipo?: string }>("user")
  const user = userSalvo ?? { nome: "Usuário" }

  const [estado, setEstado] = useState<Estado>("carregando")
  const [dominios, setDominios] = useState<DominioResumo[]>([])
  const [nacionalidades, setNacionalidades] = useState<Nacionalidade[]>([])
  const [visoes, setVisoes] = useState<VisaoResumo[]>([])
  const [busca, setBusca] = useState("")

  const carregar = useCallback(async () => {
    setEstado("carregando")
    try {
      const r = await fetch("/api/relatorios/meta", { headers: auth() })
      if (!r.ok) throw new Error(String(r.status))
      const j = await r.json()
      setDominios(j.dominios ?? [])
      setNacionalidades(j.nacionalidades ?? [])
      setEstado("pronto")
    } catch {
      setEstado("erro")
    }
  }, [])

  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/relatorios/visoes", { headers: auth() }).catch(() => null)
      if (r?.ok) setVisoes((await r.json()).visoes ?? [])
    })()
  }, [])

  const pais = params.get("pais")
  const dominioKey = params.get("d")

  const ir = useCallback((p: string | null, d: string | null) => {
    const q = new URLSearchParams()
    if (p) q.set("pais", p)
    if (d) q.set("d", d)
    const s = q.toString()
    router.push(s ? `/relatorios?${s}` : "/relatorios")
  }, [router])

  const visiveis = dominios.filter((d) => pode(d.permissao as never))

  // SÓ redireciona com resposta na mão. "Ainda não carregou" nunca é "não pode".
  useEffect(() => {
    if (!mounted || carregandoPermissoes) return
    if (estado !== "pronto") return
    if (visiveis.length === 0) router.push("/")
  }, [mounted, carregandoPermissoes, estado, visiveis.length, router])

  if (!mounted || carregandoPermissoes || estado === "carregando") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-[var(--border-default)] border-t-transparent" />
          <p className="text-[var(--text-secondary)]">Carregando relatórios…</p>
        </div>
      </div>
    )
  }

  if (estado === "erro") {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className={`${CARTAO} max-w-md p-6 text-center`}>
          <p className="text-[15px] font-semibold text-[var(--text-primary)]">Não foi possível carregar os relatórios.</p>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
            O catálogo de domínios não respondeu. Nada foi perdido — é só tentar de novo.
          </p>
          <button type="button" onClick={() => void carregar()}
            className="mt-4 rounded-[10px] bg-[var(--action-primary)] px-4 py-2 text-[13px] font-medium text-[var(--text-inverse)]">
            Tentar novamente
          </button>
        </div>
      </div>
    )
  }

  const atual = visiveis.find((d) => d.key === dominioKey) ?? null
  const paisAtual = nacionalidades.find((n) => n.valor === pais) ?? null
  const filtrados = busca.trim()
    ? visiveis.filter((d) => `${d.rotulo} ${d.descricao} ${d.grupo}`.toLowerCase().includes(busca.trim().toLowerCase()))
    : visiveis

  // Os grupos saem da DECLARAÇÃO dos domínios, na ordem em que aparecem — não
  // existe lista de assuntos escrita nesta tela.
  const grupos: [string, DominioResumo[]][] = []
  for (const d of [...filtrados].sort((a, b) => a.ordem - b.ordem)) {
    const atual = grupos.find(([g]) => g === d.grupo)
    if (atual) atual[1].push(d)
    else grupos.push([d.grupo, [d]])
  }

  return (
    <>
      <HeaderBar
        title="Relatórios"
        subtitle={atual ? atual.descricao : "Escolha a nacionalidade e o domínio"}
        userName={user.nome}
        userRole={user.tipo === "admin" ? "Administrador" : user.tipo || "Usuário"}
        onLogout={() => void encerrarSessao("manual")}
      />

      <main className="px-6 pb-16 pt-5">
        {/* TRILHA — onde se está. Não é um segundo menu lateral. */}
        <div className="mb-4 flex flex-wrap items-center gap-1.5 text-[13px]">
          <button type="button" onClick={() => ir(null, null)}
            className={pais || atual ? "text-[var(--action-primary)] hover:underline" : "font-semibold text-[var(--text-primary)]"}>
            Relatórios
          </button>
          {paisAtual && (
            <>
              <span className="text-[var(--text-muted)]">/</span>
              <button type="button" onClick={() => ir(pais, null)}
                className={atual ? "text-[var(--action-primary)] hover:underline" : "font-semibold text-[var(--text-primary)]"}>
                {paisAtual.detalhe ? `${paisAtual.detalhe} ` : ""}{paisAtual.rotulo}
              </button>
            </>
          )}
          {atual && (
            <>
              <span className="text-[var(--text-muted)]">/</span>
              <span className="font-semibold text-[var(--text-primary)]">{atual.rotulo}</span>
            </>
          )}
        </div>

        {/* NACIONALIDADE — o contexto vale para toda a navegação. */}
        <div className="mb-5 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Nacionalidade
          </span>
          <button type="button" onClick={() => ir(null, dominioKey)}
            className={`rounded-[10px] border px-2.5 py-1.5 text-[13px] ${
              !pais ? "border-[var(--action-primary)] bg-[var(--action-primary)] text-[var(--text-inverse)]"
                    : "border-[var(--border-default)] bg-[var(--surface-elevated)] text-[var(--text-primary)] hover:border-[var(--action-primary)]"}`}>
            Todas
          </button>
          {nacionalidades.map((n) => (
            <button key={n.valor} type="button" onClick={() => ir(n.valor, dominioKey)}
              className={`rounded-[10px] border px-2.5 py-1.5 text-[13px] ${
                pais === n.valor ? "border-[var(--action-primary)] bg-[var(--action-primary)] text-[var(--text-inverse)]"
                                 : "border-[var(--border-default)] bg-[var(--surface-elevated)] text-[var(--text-primary)] hover:border-[var(--action-primary)]"}`}>
              {n.detalhe ? `${n.detalhe} ` : ""}{n.rotulo}
            </button>
          ))}
          {nacionalidades.length === 0 && (
            <span className="text-[13px] text-[var(--text-secondary)]">
              Nenhuma nacionalidade ofertada — cadastre um tipo de processo em Gerenciamento.
            </span>
          )}
        </div>

        {atual ? (
          <Workspace dominioKey={atual.key} nacionalidade={pais} />
        ) : (
          <div className="space-y-5">
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar um domínio…"
              className="w-full max-w-sm rounded-[10px] border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
            />

            {/* AGRUPADO POR ASSUNTO, em lista.
                Dezessete cartões iguais numa grade não davam hierarquia nenhuma:
                tudo do mesmo tamanho, e quem chegava não sabia por onde começar.
                Aqui o assunto vem primeiro e cada domínio é uma linha — mais
                denso, e a ordem de leitura é óbvia. */}
            {filtrados.length === 0 ? (
              <p className="text-[13px] text-[var(--text-secondary)]">Nenhum domínio com esse nome.</p>
            ) : (
              <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-2">
                {grupos.map(([grupo, itens]) => (
                  <section key={grupo}>
                    <h2 className="mb-1.5 border-b border-[var(--border-default)] pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                      {grupo}
                    </h2>
                    <div className="divide-y divide-[var(--border-subtle)]">
                      {itens.map((d) => (
                        <button key={d.key} type="button" onClick={() => ir(pais, d.key)}
                          className="group flex w-full items-baseline gap-3 py-2 text-left">
                          <span className="w-[11.5rem] shrink-0 text-[14px] font-medium text-[var(--text-primary)] group-hover:text-[var(--action-primary)]">
                            {d.rotulo}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--text-secondary)]" title={d.descricao}>
                            {d.descricao}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}

            {visoes.length > 0 && (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Favoritos</p>
                  <div className={`${CARTAO} p-3`}>
                    {visoes.filter((v) => v.favorita).length === 0
                      ? <p className="text-[13px] text-[var(--text-secondary)]">Nenhuma visão favoritada ainda.</p>
                      : visoes.filter((v) => v.favorita).map((v) => (
                        <button key={v.id} type="button" onClick={() => ir(pais, v.dominio)}
                          className="block py-0.5 text-left text-[13px] text-[var(--action-primary)] hover:underline">
                          {v.nome} <span className="text-[var(--text-muted)]">· {v.dominio}</span>
                        </button>
                      ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Recentes</p>
                  <div className={`${CARTAO} p-3`}>
                    {visoes.filter((v) => v.usadaEm).length === 0
                      ? <p className="text-[13px] text-[var(--text-secondary)]">Nada aberto recentemente.</p>
                      : visoes.filter((v) => v.usadaEm).slice(0, 6).map((v) => (
                        <button key={v.id} type="button" onClick={() => ir(pais, v.dominio)}
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

"use client"

// WORKSPACE DE UM DOMÍNIO. Uma tela serve a todos: ela lê a declaração do
// domínio e desenha. Não existe "tela de Protocolos" — existe o workspace com o
// domínio Protocolos carregado.
//
// A TABELA É A PROTAGONISTA. Filtros ficam numa faixa compacta em cima; nada de
// cards decorativos roubando altura de quem veio ler dados.

import { useCallback, useEffect, useMemo, useState } from "react"
import { FiltroControle, type FiltroMeta } from "./filtro-controle"
import type { QuerySpec, ValorDeFiltro } from "@/src/lib/relatorios/motor/tipos"

const auth = () => ({
  Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("authToken") ?? "" : ""}`,
  "Content-Type": "application/json",
})

interface Meta {
  dominio: { key: string; rotulo: string; descricao: string; grain: string; aceitaNacionalidade: boolean }
  nacionalidades: { valor: string; rotulo: string; detalhe?: string | null }[]
  filtros: FiltroMeta[]
  agrupamentos: { key: string; rotulo: string }[]
  colunas: { key: string; rotulo: string; alinhamento: string | null }[]
  ordenacoes: { key: string; rotulo: string }[]
  colunasIniciais: string[]
  ordenacaoPadrao: { key: string; direcao: "asc" | "desc" }
  visoesDoSistema: { key: string; nome: string; spec: QuerySpec }[]
}
interface Linha { id: number; celulas: { key: string; valor: string | number | null; link?: string | null }[] }
interface Resultado {
  total: number; pagina: number; porPagina: number; grain: string
  colunas: { key: string; rotulo: string; alinhamento?: string }[]
  linhas: Linha[]
  grupos: { chave: string; rotulo: string; total: number; linhas: Linha[] }[] | null
  aplicados: { key: string; rotulo: string; descricao: string }[]
}
interface Visao { id: number; dominio: string; nome: string; spec: QuerySpec; favorita: boolean; usadaEm: string | null }

const BOTAO =
  "rounded-[10px] border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-[13px] text-[var(--text-primary)] hover:border-[var(--action-primary)]"
const PAINEL = "rounded-[12px] border border-[var(--border-default)] bg-[var(--surface-primary)]"

export function Workspace({ dominioKey }: { dominioKey: string }) {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [spec, setSpec] = useState<QuerySpec>({ dominio: dominioKey, filtros: [], pagina: 1, porPagina: 50 })
  const [res, setRes] = useState<Resultado | null>(null)
  const [aba, setAba] = useState<"explorar" | "visoes" | "favoritos">("explorar")
  const [visoes, setVisoes] = useState<Visao[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [mostrarColunas, setMostrarColunas] = useState(false)
  const [novoFiltro, setNovoFiltro] = useState("")

  useEffect(() => { setSpec({ dominio: dominioKey, filtros: [], pagina: 1, porPagina: 50 }); setRes(null) }, [dominioKey])

  useEffect(() => {
    void (async () => {
      const r = await fetch(`/api/relatorios/meta?dominio=${dominioKey}`, { headers: auth() }).catch(() => null)
      if (r?.ok) setMeta(await r.json())
    })()
  }, [dominioKey])

  const carregarVisoes = useCallback(async () => {
    const r = await fetch(`/api/relatorios/visoes?dominio=${dominioKey}`, { headers: auth() }).catch(() => null)
    if (r?.ok) setVisoes((await r.json()).visoes ?? [])
  }, [dominioKey])
  useEffect(() => { void carregarVisoes() }, [carregarVisoes])

  // A consulta roda quando a pergunta muda. É a MESMA chamada para tudo:
  // filtrar, agrupar, ordenar e paginar não são telas diferentes.
  useEffect(() => {
    let vivo = true
    void (async () => {
      setCarregando(true); setErro(null)
      try {
        const r = await fetch("/api/relatorios/consultar", { method: "POST", headers: auth(), body: JSON.stringify(spec) })
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Falha na consulta")
        if (vivo) setRes(await r.json())
      } catch (e) {
        if (vivo) { setErro(e instanceof Error ? e.message : "Falha na consulta"); setRes(null) }
      } finally { if (vivo) setCarregando(false) }
    })()
    return () => { vivo = false }
  }, [spec])

  const usados = useMemo(() => new Set(spec.filtros.map((f) => f.key)), [spec.filtros])
  const disponiveis = useMemo(() => (meta?.filtros ?? []).filter((f) => !usados.has(f.key)), [meta, usados])
  const colunasAtivas = spec.colunas ?? meta?.colunasIniciais ?? []

  const mudar = (patch: Partial<QuerySpec>) => setSpec((s) => ({ ...s, pagina: 1, ...patch }))
  const setFiltro = (key: string, valor: ValorDeFiltro | null) =>
    setSpec((s) => ({
      ...s, pagina: 1,
      filtros: valor === null ? s.filtros.filter((f) => f.key !== key)
        : s.filtros.some((f) => f.key === key)
          ? s.filtros.map((f) => (f.key === key ? { key, valor } : f))
          : [...s.filtros, { key, valor }],
    }))

  async function salvarVisao() {
    const nome = prompt("Nome da visão:")?.trim()
    if (!nome) return
    const r = await fetch("/api/relatorios/visoes", { method: "POST", headers: auth(), body: JSON.stringify({ nome, spec }) })
    if (r.ok) { await carregarVisoes(); setAba("visoes") }
  }

  async function exportar() {
    const r = await fetch("/api/relatorios/exportar", { method: "POST", headers: auth(), body: JSON.stringify(spec) })
    if (!r.ok) return
    const url = URL.createObjectURL(await r.blob())
    const a = document.createElement("a")
    a.href = url; a.download = `${dominioKey}-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  async function abrirVisao(v: Visao | { nome: string; spec: QuerySpec }, id?: number) {
    setSpec({ ...v.spec, dominio: dominioKey, pagina: 1, porPagina: 50 })
    setAba("explorar")
    if (id) { await fetch("/api/relatorios/visoes", { method: "PATCH", headers: auth(), body: JSON.stringify({ id, usar: true }) }); void carregarVisoes() }
  }

  if (!meta) return <p className="p-6 text-sm text-[var(--text-secondary)]">Carregando…</p>

  const tabela = (linhas: Linha[]) => (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr className="border-b border-[var(--border-default)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
          {res?.colunas.map((c) => (
            <th key={c.key} className={`px-3 py-2 font-medium ${c.alinhamento === "direita" ? "text-right" : ""}`}>{c.rotulo}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {linhas.map((l) => (
          <tr key={l.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--surface-secondary)]">
            {l.celulas.map((c, i) => (
              <td key={c.key} className={`px-3 py-1.5 ${res?.colunas[i]?.alinhamento === "direita" ? "text-right tabular-nums" : ""}`}>
                {c.link
                  ? <a href={c.link} className="text-[var(--action-primary)] hover:underline">{c.valor ?? "—"}</a>
                  : <span className="text-[var(--text-primary)]">{c.valor ?? "—"}</span>}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )

  return (
    <div className="space-y-3">
      {/* CONTEXTO + ABAS */}
      <div className="flex flex-wrap items-center gap-2">
        {meta.dominio.aceitaNacionalidade && (
          <select
            value={spec.nacionalidade ?? ""}
            onChange={(e) => mudar({ nacionalidade: e.target.value || null })}
            className={BOTAO}
            title="Só nacionalidades ofertadas — país geográfico não entra aqui"
          >
            <option value="">Todas as nacionalidades</option>
            {meta.nacionalidades.map((n) => (
              <option key={n.valor} value={n.valor}>{n.detalhe ? `${n.detalhe} ` : ""}{n.rotulo}</option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-1 rounded-[10px] border border-[var(--border-default)] bg-[var(--surface-elevated)] p-0.5">
          {(["explorar", "visoes", "favoritos"] as const).map((a) => (
            <button key={a} type="button" onClick={() => setAba(a)}
              className={`rounded-[8px] px-2.5 py-1 text-[13px] ${aba === a ? "bg-[var(--action-primary)] text-[var(--text-inverse)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}>
              {a === "explorar" ? "Explorar" : a === "visoes" ? "Visões salvas" : "Favoritos"}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-[var(--text-muted)]">{meta.dominio.grain}</span>
      </div>

      {aba !== "explorar" ? (
        <div className={`${PAINEL} p-3`}>
          {aba === "visoes" && (
            <>
              <p className="mb-2 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Prontas do sistema</p>
              <div className="mb-4 flex flex-wrap gap-1.5">
                {meta.visoesDoSistema.map((v) => (
                  <button key={v.key} type="button" className={BOTAO} onClick={() => void abrirVisao(v)}>{v.nome}</button>
                ))}
              </div>
            </>
          )}
          <p className="mb-2 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
            {aba === "favoritos" ? "Favoritas" : "Minhas visões"}
          </p>
          {visoes.filter((v) => aba !== "favoritos" || v.favorita).length === 0 ? (
            <p className="text-[13px] text-[var(--text-secondary)]">
              {aba === "favoritos" ? "Nenhuma favorita ainda." : "Nenhuma visão salva ainda — monte uma consulta e clique em Salvar visão."}
            </p>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {visoes.filter((v) => aba !== "favoritos" || v.favorita).map((v) => (
                <div key={v.id} className="flex items-center justify-between gap-2 py-1.5">
                  <button type="button" onClick={() => void abrirVisao(v, v.id)}
                    className="text-left text-[13px] text-[var(--action-primary)] hover:underline">{v.nome}</button>
                  <div className="flex items-center gap-2 text-[11px]">
                    <button type="button" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      onClick={async () => { await fetch("/api/relatorios/visoes", { method: "PATCH", headers: auth(), body: JSON.stringify({ id: v.id, favorita: !v.favorita }) }); void carregarVisoes() }}>
                      {v.favorita ? "★ favorita" : "☆ favoritar"}
                    </button>
                    <button type="button" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      onClick={async () => { await fetch(`/api/relatorios/visoes?id=${v.id}`, { method: "DELETE", headers: auth() }); void carregarVisoes() }}>
                      excluir
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* FILTROS — faixa compacta, não um painel gigante. */}
          <div className={`${PAINEL} p-3`}>
            <div className="flex flex-wrap items-start gap-4">
              {spec.filtros.map((f) => {
                const m = meta.filtros.find((x) => x.key === f.key)
                if (!m) return null
                return <FiltroControle key={f.key} meta={m} valor={f.valor}
                  onChange={(v) => setFiltro(f.key, v)} onRemover={() => setFiltro(f.key, null)} />
              })}
              <div className="min-w-[190px]">
                <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">Adicionar filtro</label>
                <select value={novoFiltro} className={`${BOTAO} w-full`}
                  onChange={(e) => {
                    const k = e.target.value
                    setNovoFiltro("")
                    const m = meta.filtros.find((x) => x.key === k)
                    if (!m) return
                    // Entra sem valor: o motor ignora filtro vazio em vez de
                    // deixar passar tudo achando que filtrou.
                    setSpec((s) => ({ ...s, pagina: 1, filtros: [...s.filtros, { key: k, valor: { tipo: "texto", texto: "" } as ValorDeFiltro }] }))
                  }}>
                  <option value="">+ Adicionar filtro</option>
                  {disponiveis.map((f) => <option key={f.key} value={f.key}>{f.rotulo}</option>)}
                </select>
              </div>
            </div>

            {/* CONSULTA ATUAL — o que efetivamente entrou. */}
            {res && res.aplicados.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--border-subtle)] pt-2.5">
                <span className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Consulta atual</span>
                {res.aplicados.map((a) => (
                  <span key={a.key} className="inline-flex items-center gap-1 rounded-[8px] bg-[var(--surface-secondary)] px-2 py-0.5 text-[12px] text-[var(--text-primary)]">
                    {a.rotulo}: {a.descricao}
                    <button type="button" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      onClick={() => a.key === "__nacionalidade" ? mudar({ nacionalidade: null }) : setFiltro(a.key, null)}>×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* BARRA DO RESULTADO */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-[var(--text-primary)]">
              {carregando ? "…" : `${res?.total ?? 0} resultado${(res?.total ?? 0) === 1 ? "" : "s"}`}
            </span>
            <div className="flex-1" />
            <select className={BOTAO} value={spec.agruparPor ?? ""} onChange={(e) => mudar({ agruparPor: e.target.value || null })}>
              <option value="">Sem agrupamento</option>
              {meta.agrupamentos.map((a) => <option key={a.key} value={a.key}>Agrupar por {a.rotulo}</option>)}
            </select>
            <select className={BOTAO} value={spec.ordenarPor ?? meta.ordenacaoPadrao.key}
              onChange={(e) => mudar({ ordenarPor: e.target.value })}>
              {meta.ordenacoes.map((o) => <option key={o.key} value={o.key}>Ordenar por {o.rotulo}</option>)}
            </select>
            <button type="button" className={BOTAO}
              onClick={() => mudar({ direcao: (spec.direcao ?? meta.ordenacaoPadrao.direcao) === "desc" ? "asc" : "desc" })}>
              {(spec.direcao ?? meta.ordenacaoPadrao.direcao) === "desc" ? "↓" : "↑"}
            </button>
            <button type="button" className={BOTAO} onClick={() => setMostrarColunas((v) => !v)}>Colunas</button>
            <button type="button" className={BOTAO} onClick={() => void salvarVisao()}>Salvar visão</button>
            <button type="button" className={BOTAO} onClick={() => void exportar()}>Exportar CSV</button>
          </div>

          {mostrarColunas && (
            <div className={`${PAINEL} flex flex-wrap gap-x-4 gap-y-1 p-3`}>
              {meta.colunas.map((c) => (
                <label key={c.key} className="flex cursor-pointer items-center gap-1.5 text-[13px] text-[var(--text-primary)]">
                  <input type="checkbox" checked={colunasAtivas.includes(c.key)}
                    onChange={() => {
                      const novo = colunasAtivas.includes(c.key)
                        ? colunasAtivas.filter((k) => k !== c.key)
                        : [...colunasAtivas, c.key]
                      setSpec((s) => ({ ...s, colunas: novo }))
                    }} />
                  {c.rotulo}
                </label>
              ))}
            </div>
          )}

          {/* TABELA — o protagonista. */}
          <div className={`${PAINEL} overflow-hidden`}>
            {erro && <p className="p-4 text-[13px] text-[var(--text-primary)]">{erro}</p>}
            {!erro && carregando && <p className="p-4 text-[13px] text-[var(--text-secondary)]">Consultando…</p>}
            {!erro && !carregando && res && res.total === 0 && (
              <p className="p-6 text-center text-[13px] text-[var(--text-secondary)]">
                Nenhum resultado para esta consulta. Remova um filtro para ampliar.
              </p>
            )}
            {!erro && !carregando && res && res.total > 0 && (
              <div className="overflow-x-auto">
                {res.grupos
                  ? res.grupos.map((g) => (
                      <div key={g.chave}>
                        <div className="flex items-baseline gap-2 border-b border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-1.5">
                          <span className="text-[13px] font-semibold text-[var(--text-primary)]">{g.rotulo}</span>
                          <span className="text-[11px] text-[var(--text-muted)]">{g.total} nesta página</span>
                        </div>
                        {tabela(g.linhas)}
                      </div>
                    ))
                  : tabela(res.linhas)}
              </div>
            )}
          </div>

          {/* PAGINAÇÃO — o total acima é o global; aqui se anda nele. */}
          {res && res.total > res.porPagina && (
            <div className="flex items-center justify-center gap-3 text-[13px] text-[var(--text-secondary)]">
              <button type="button" className={BOTAO} disabled={res.pagina <= 1}
                onClick={() => setSpec((s) => ({ ...s, pagina: (s.pagina ?? 1) - 1 }))}>Anterior</button>
              <span>Página {res.pagina} de {Math.ceil(res.total / res.porPagina)}</span>
              <button type="button" className={BOTAO} disabled={res.pagina >= Math.ceil(res.total / res.porPagina)}
                onClick={() => setSpec((s) => ({ ...s, pagina: (s.pagina ?? 1) + 1 }))}>Próxima</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

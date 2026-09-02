"use client"

// Um filtro na tela. O componente NÃO sabe o que é "órgão" ou "situação": ele
// desenha o TIPO que o domínio declarou e busca as opções na fonte que o domínio
// apontou. Filtro novo no motor aparece aqui sem uma linha de front.

import { useCallback, useEffect, useRef, useState } from "react"
import type { ValorDeFiltro } from "@/src/lib/relatorios/motor/tipos"
import { CampoData } from "@/src/components/ui/campo-data"

export interface FiltroMeta {
  key: string
  rotulo: string
  tipo: string
  descricao: string | null
  opcoes: { valor: string; rotulo: string }[] | null
  fonte: string | null
}
export interface Opcao { valor: string; rotulo: string; detalhe?: string | null }

const auth = () => ({ Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("authToken") ?? "" : ""}` })

const CAMPO =
  "rounded-[10px] border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

/**
 * ATALHOS DE PERÍODO — "este mês", "este ano".
 *
 * A pergunta mais comum de um relatório é sobre um recorte de tempo redondo, e
 * digitar duas datas para chegar em "janeiro" é trabalho que o sistema devia
 * poupar. As datas continuam editáveis: o atalho preenche, não prende.
 */
const ATALHOS: { rotulo: string; calcular: () => { de: string; ate: string } }[] = [
  { rotulo: "Hoje", calcular: () => { const h = new Date(); return { de: iso(h), ate: iso(h) } } },
  { rotulo: "7 dias", calcular: () => { const a = new Date(); const d = new Date(); d.setDate(d.getDate() - 6); return { de: iso(d), ate: iso(a) } } },
  { rotulo: "30 dias", calcular: () => { const a = new Date(); const d = new Date(); d.setDate(d.getDate() - 29); return { de: iso(d), ate: iso(a) } } },
  { rotulo: "Este mês", calcular: () => { const h = new Date(); return { de: iso(new Date(h.getFullYear(), h.getMonth(), 1)), ate: iso(new Date(h.getFullYear(), h.getMonth() + 1, 0)) } } },
  { rotulo: "Mês ant.", calcular: () => { const h = new Date(); return { de: iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), ate: iso(new Date(h.getFullYear(), h.getMonth(), 0)) } } },
  { rotulo: "Este ano", calcular: () => { const h = new Date(); return { de: iso(new Date(h.getFullYear(), 0, 1)), ate: iso(new Date(h.getFullYear(), 11, 31)) } } },
  { rotulo: "Ano ant.", calcular: () => { const h = new Date(); return { de: iso(new Date(h.getFullYear() - 1, 0, 1)), ate: iso(new Date(h.getFullYear() - 1, 11, 31)) } } },
]

export function FiltroControle({
  meta, valor, onChange, onRemover, fixo = false,
}: {
  meta: FiltroMeta
  valor: ValorDeFiltro | null
  onChange: (v: ValorDeFiltro | null) => void
  onRemover: () => void
  /** Filtro principal: fica na barra e não tem "remover" — só se limpa. */
  fixo?: boolean
}) {
  const [opcoes, setOpcoes] = useState<Opcao[]>(meta.opcoes ?? [])
  const [busca, setBusca] = useState("")
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(false)
  const [aberto, setAberto] = useState(false)
  const caixaRef = useRef<HTMLDivElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fecha ao clicar fora — senão dois popovers ficam abertos ao mesmo tempo.
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (caixaRef.current && !caixaRef.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener("mousedown", fora)
    return () => document.removeEventListener("mousedown", fora)
  }, [aberto])

  const carregar = useCallback(async (q: string) => {
    if (!meta.fonte) return
    setCarregando(true); setErro(false)
    try {
      const r = await fetch(`/api/relatorios/opcoes?fonte=${meta.fonte}&q=${encodeURIComponent(q)}`, { headers: auth() })
      if (!r.ok) throw new Error()
      setOpcoes((await r.json()).opcoes ?? [])
    } catch { setErro(true) } finally { setCarregando(false) }
  }, [meta.fonte])

  useEffect(() => { if (meta.fonte) void carregar("") }, [meta.fonte, carregar])

  const buscar = (q: string) => {
    setBusca(q)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void carregar(q), 300)
  }

  const corpo = () => {
    switch (meta.tipo) {
      case "intervalo_data": {
        const v = valor?.tipo === "intervalo_data" ? valor : { tipo: "intervalo_data" as const, de: null, ate: null }
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <CampoData
                value={v.de ?? ""}
                onChange={(d) => onChange({ tipo: "intervalo_data", de: d || null, ate: v.ate })}
                className={`${CAMPO} w-[9rem]`}
                aria-label="De"
              />
              <span className="text-[11px] text-[var(--text-muted)]">até</span>
              <CampoData
                value={v.ate ?? ""}
                onChange={(d) => onChange({ tipo: "intervalo_data", de: v.de, ate: d || null })}
                className={`${CAMPO} w-[9rem]`}
                aria-label="Até"
              />
              {(v.de || v.ate) && (
                <button type="button" onClick={() => onChange(null)}
                  className="px-1 text-[13px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  aria-label="Limpar período">×</button>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {ATALHOS.map((a) => (
                <button key={a.rotulo} type="button"
                  onClick={() => { const p = a.calcular(); onChange({ tipo: "intervalo_data", de: p.de, ate: p.ate }) }}
                  className="rounded-[7px] border border-[var(--border-subtle)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)] hover:border-[var(--action-primary)] hover:text-[var(--text-primary)]">
                  {a.rotulo}
                </button>
              ))}
            </div>
          </div>
        )
      }
      case "booleano":
        return (
          <select className={`${CAMPO} w-full`} value={valor?.tipo === "booleano" ? String(valor.valor) : ""}
            onChange={(e) => onChange(e.target.value === "" ? null : { tipo: "booleano", valor: e.target.value === "true" })}>
            <option value="">Indiferente</option>
            <option value="true">Sim</option>
            <option value="false">Não</option>
          </select>
        )
      case "numero":
        return (
          <input type="number" className={`${CAMPO} w-full`} value={valor?.tipo === "numero" ? valor.numero : ""}
            onChange={(e) => onChange(e.target.value === "" ? null : { tipo: "numero", numero: Number(e.target.value) })} />
        )
      case "texto":
        return (
          <input className={`${CAMPO} w-full`} placeholder="Buscar…" value={valor?.tipo === "texto" ? valor.texto : ""}
            onChange={(e) => onChange(e.target.value ? { tipo: "texto", texto: e.target.value } : null)} />
        )
      case "entidade": {
        // A lista de resultados FLUTUA sobre a tela. Empurrando o conteúdo, ela
        // reposicionava os filtros vizinhos a cada tecla digitada.
        const sel = valor?.tipo === "entidade" ? valor : null
        return (
          <div ref={caixaRef} className="relative">
            <div className="relative">
              <input className={`${CAMPO} w-full ${sel ? "pr-6" : ""}`}
                placeholder={sel ? (sel.rotulo ?? `#${sel.id}`) : "Buscar…"}
                value={busca} onFocus={() => setAberto(true)} onChange={(e) => { setAberto(true); buscar(e.target.value) }} />
              {sel && !busca && (
                <button type="button" aria-label="Limpar"
                  onClick={() => { onChange(null); setBusca("") }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[13px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">×</button>
              )}
            </div>
            {aberto && (busca || carregando || erro) && (
              <div className="absolute z-30 mt-1 max-h-56 w-full min-w-[14rem] overflow-auto rounded-[10px] border border-[var(--border-default)] bg-[var(--surface-elevated)] shadow-lg">
                {carregando && <p className="px-2.5 py-1.5 text-[11px] text-[var(--text-muted)]">Carregando…</p>}
                {erro && (
                  <p className="px-2.5 py-1.5 text-[11px] text-[var(--text-muted)]">
                    Falhou. <button type="button" className="underline" onClick={() => void carregar(busca)}>Tentar novamente</button>
                  </p>
                )}
                {!carregando && !erro && opcoes.length === 0 && (
                  <p className="px-2.5 py-1.5 text-[11px] text-[var(--text-muted)]">Nada encontrado.</p>
                )}
                {!carregando && !erro && opcoes.map((o) => (
                  <button key={o.valor} type="button"
                    className="block w-full px-2.5 py-1.5 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--surface-secondary)]"
                    onClick={() => { onChange({ tipo: "entidade", id: Number(o.valor), rotulo: o.rotulo }); setBusca(""); setAberto(false) }}>
                    {o.rotulo}{o.detalhe ? <span className="text-[var(--text-muted)]"> · {o.detalhe}</span> : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      }
      case "multi_selecao": {
        // POPOVER, não lista aberta. Expandida, uma lista de seis situações
        // empurrava a barra inteira para baixo e deixava buraco ao lado dos
        // outros filtros — todos os controles precisam ter a MESMA altura para
        // a barra ser uma linha e não um painel.
        const sel = valor?.tipo === "multi_selecao" ? valor.valores : []
        const alternar = (v: string) => {
          const novo = sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v]
          const rotulos = novo.map((k) => opcoes.find((o) => o.valor === k)?.rotulo ?? k)
          onChange(novo.length ? { tipo: "multi_selecao", valores: novo, rotulos } : null)
        }
        const resumo = sel.length === 0 ? "Todos"
          : sel.length === 1 ? (opcoes.find((o) => o.valor === sel[0])?.rotulo ?? sel[0])
          : `${sel.length} selecionados`
        return (
          <div ref={caixaRef} className="relative">
            <button type="button" onClick={() => setAberto((v) => !v)}
              className={`${CAMPO} flex w-full items-center justify-between gap-2 text-left`}>
              <span className={sel.length ? "" : "text-[var(--text-muted)]"}>{resumo}</span>
              <span className="flex shrink-0 items-center gap-1">
                {sel.length > 0 && (
                  <span role="button" tabIndex={0} aria-label="Limpar"
                    onClick={(e) => { e.stopPropagation(); onChange(null) }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onChange(null) } }}
                    className="cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-primary)]">×</span>
                )}
                <span className="text-[var(--text-muted)]">▾</span>
              </span>
            </button>
            {aberto && (
              <div className="absolute z-30 mt-1 max-h-56 w-full min-w-[13rem] overflow-auto rounded-[10px] border border-[var(--border-default)] bg-[var(--surface-elevated)] p-1 shadow-lg">
                {carregando && <p className="px-1.5 py-1 text-[11px] text-[var(--text-muted)]">Carregando…</p>}
                {erro && (
                  <p className="px-1.5 py-1 text-[11px] text-[var(--text-muted)]">
                    Falhou. <button type="button" className="underline" onClick={() => void carregar("")}>Tentar novamente</button>
                  </p>
                )}
                {!carregando && !erro && opcoes.length === 0 && (
                  <p className="px-1.5 py-1 text-[11px] text-[var(--text-muted)]">Sem opções cadastradas.</p>
                )}
                {opcoes.map((o) => (
                  <label key={o.valor} className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-[13px] text-[var(--text-primary)] hover:bg-[var(--surface-secondary)]">
                    <input type="checkbox" checked={sel.includes(o.valor)} onChange={() => alternar(o.valor)} />
                    {o.detalhe && o.detalhe.length <= 3 ? `${o.detalhe} ` : ""}{o.rotulo}
                  </label>
                ))}
              </div>
            )}
          </div>
        )
      }
      default:
        return <p className="text-[11px] text-[var(--text-muted)]">Tipo não suportado.</p>
    }
  }

  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label className="text-[11px] font-medium text-[var(--text-secondary)]" title={meta.descricao ?? undefined}>
          {meta.rotulo}
        </label>
        {!fixo && (
          <button type="button" onClick={onRemover}
            className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">remover</button>
        )}
      </div>
      {corpo()}
    </div>
  )
}

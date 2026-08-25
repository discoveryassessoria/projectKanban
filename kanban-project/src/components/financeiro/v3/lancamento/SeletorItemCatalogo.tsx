// src/components/financeiro/v3/lancamento/SeletorItemCatalogo.tsx
// ============================================================================
// SELETOR INTELIGENTE de item do Catálogo Mestre — substitui o <select> nativo.
//
// Busca assíncrona com debounce (nunca carrega a lista inteira), resultados
// AGRUPADOS pela categoria oficial, navegação integral por teclado, skeleton de
// carregamento e estado vazio útil. Cada linha mostra os sinais que decidem a
// escolha: moeda configurada, fornecedor padrão, valor cadastrado e — o mais
// importante — quando a configuração financeira está INCOMPLETA.
//
// O operador não precisa saber a estrutura interna do sistema: ele procura pelo
// nome do que comprou. A natureza do item vem do cadastro, nunca de um campo
// "Tipo" preenchido à mão.
// ============================================================================
"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { AlertTriangle, Check, ChevronDown, Search, Tag, Truck, X } from "lucide-react"
import { authHeaders } from "@/src/lib/financeiro/http"

export interface ItemCatalogoOpcao {
  id: number
  code: string
  name: string
  descricao?: string | null
  natureza: string
  categoria: string | null
  unidade?: string
  temConfig: boolean
  temPreco: boolean
  moeda: string | null
  fornecedorPadraoNome: string | null
}

const SEM_CATEGORIA = "Sem categoria"

/** Agrupa preservando a ordem de chegada (o servidor já ordena por categoria e nome). */
export function agruparPorCategoria(itens: ItemCatalogoOpcao[]): { categoria: string; itens: ItemCatalogoOpcao[] }[] {
  const mapa = new Map<string, ItemCatalogoOpcao[]>()
  for (const i of itens) {
    const k = i.categoria?.trim() || SEM_CATEGORIA
    if (!mapa.has(k)) mapa.set(k, [])
    mapa.get(k)!.push(i)
  }
  return [...mapa.entries()].map(([categoria, itens]) => ({ categoria, itens }))
}

export function SeletorItemCatalogo({
  natureza,
  valor,
  onSelecionar,
  autoFocus,
  invalido,
  descrevePor,
}: {
  natureza: "CUSTO" | "RECEITA"
  valor: ItemCatalogoOpcao | null
  onSelecionar: (item: ItemCatalogoOpcao | null) => void
  autoFocus?: boolean
  invalido?: boolean
  descrevePor?: string
}) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState("")
  const [itens, setItens] = useState<ItemCatalogoOpcao[] | null>(null)
  const [truncado, setTruncado] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [ativo, setAtivo] = useState(0) // índice na lista achatada
  const caixa = useRef<HTMLDivElement>(null)
  const campo = useRef<HTMLInputElement>(null)
  const listaId = useId()

  // ── busca assíncrona com debounce e cancelamento ──
  useEffect(() => {
    if (!aberto) return
    const ctrl = new AbortController()
    // O estado de carregamento nasce DENTRO do timeout: setState síncrono no corpo do
    // efeito dispara render em cascata, e o skeleton só precisa aparecer quando a
    // requisição realmente sai (depois do debounce).
    const t = setTimeout(() => {
      setCarregando(true)
      const qs = new URLSearchParams()
      if (busca.trim()) qs.set("q", busca.trim())
      if (natureza === "RECEITA") qs.set("paraReceita", "1")
      fetch(`/api/financeiro/v3/itens-catalogo?${qs}`, { headers: authHeaders(), signal: ctrl.signal })
        .then((r) => r.json())
        .then((j) => { setItens(j?.itens ?? []); setTruncado(!!j?.truncado); setAtivo(0) })
        .catch((e) => { if (e?.name !== "AbortError") setItens([]) })
        .finally(() => { if (!ctrl.signal.aborted) setCarregando(false) })
    }, 220)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [busca, aberto, natureza])

  // fechar ao clicar fora
  useEffect(() => {
    if (!aberto) return
    const fora = (ev: MouseEvent) => { if (caixa.current && !caixa.current.contains(ev.target as Node)) setAberto(false) }
    document.addEventListener("mousedown", fora)
    return () => document.removeEventListener("mousedown", fora)
  }, [aberto])

  useEffect(() => { if (aberto) campo.current?.focus() }, [aberto])

  const grupos = useMemo(() => agruparPorCategoria(itens ?? []), [itens])
  const achatada = useMemo(() => grupos.flatMap((g) => g.itens), [grupos])

  const escolher = (i: ItemCatalogoOpcao) => { onSelecionar(i); setAberto(false); setBusca("") }

  const teclado = (ev: React.KeyboardEvent) => {
    if (ev.key === "ArrowDown") { ev.preventDefault(); setAtivo((a) => Math.min(a + 1, achatada.length - 1)) }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setAtivo((a) => Math.max(a - 1, 0)) }
    else if (ev.key === "Enter") { ev.preventDefault(); const i = achatada[ativo]; if (i) escolher(i) }
    else if (ev.key === "Escape") { ev.preventDefault(); setAberto(false) }
    else if (ev.key === "Home") { ev.preventDefault(); setAtivo(0) }
    else if (ev.key === "End") { ev.preventDefault(); setAtivo(Math.max(0, achatada.length - 1)) }
  }

  const borda = invalido ? "var(--danger)" : "var(--border-default)"

  return (
    <div ref={caixa} className="relative">
      {/* Gatilho — mostra o item escolhido com seus sinais, ou o convite à busca. */}
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-controls={listaId}
        aria-describedby={descrevePor}
        autoFocus={autoFocus}
        className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] border bg-[var(--surface-input)] px-3 py-2 text-left text-sm text-[var(--text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
        style={{ borderColor: borda }}
      >
        {valor ? (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate">{valor.name}</span>
            <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{valor.code}</span>
          </span>
        ) : (
          <span className="flex items-center gap-2 text-[var(--text-muted)]"><Search className="h-4 w-4" /> Buscar item do catálogo…</span>
        )}
        <span className="flex shrink-0 items-center gap-1">
          {valor && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Limpar item selecionado"
              onClick={(e) => { e.stopPropagation(); onSelecionar(null) }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); onSelecionar(null) } }}
              className="rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            ><X className="h-3.5 w-3.5" /></span>
          )}
          <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
        </span>
      </button>

      {/* Sinais do item escolhido — a origem de cada dado fica explícita. */}
      {valor && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {valor.categoria && <Sinal icone={<Tag className="h-3 w-3" />}>{valor.categoria}</Sinal>}
          {valor.moeda && <Sinal>{valor.moeda}</Sinal>}
          {valor.fornecedorPadraoNome && <Sinal icone={<Truck className="h-3 w-3" />}>{valor.fornecedorPadraoNome}</Sinal>}
          {valor.temPreco && <Sinal tom="ok" icone={<Check className="h-3 w-3" />}>Valor configurado</Sinal>}
          {!valor.temConfig && <Sinal tom="alerta" icone={<AlertTriangle className="h-3 w-3" />}>Sem configuração financeira</Sinal>}
        </div>
      )}

      {aberto && (
        <div
          className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-popover)] shadow-[var(--elev-2)]"
        >
          <div className="flex items-center gap-2 border-b border-[var(--border-default)] px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
            <input
              ref={campo}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={teclado}
              placeholder="Nome, código, categoria…"
              aria-label="Buscar item do catálogo"
              aria-controls={listaId}
              className="w-full bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
          </div>

          <div id={listaId} role="listbox" className="max-h-72 overflow-y-auto">
            {carregando && itens == null && <Skeleton />}
            {itens != null && achatada.length === 0 && (
              <div className="px-3 py-6 text-center">
                <div className="text-sm text-[var(--text-secondary)]">Nenhum item encontrado</div>
                <div className="mt-1 text-xs text-[var(--text-muted)]">
                  {busca.trim()
                    ? <>Nada corresponde a “{busca.trim()}”. Tente outro termo ou cadastre o item em Gerenciamento › Catálogo.</>
                    : <>Nenhum item ativo disponível{natureza === "RECEITA" ? " com configuração que permita receita" : ""}.</>}
                </div>
              </div>
            )}
            {grupos.map((g) => (
              <div key={g.categoria}>
                <div className="sticky top-0 bg-[var(--surface-secondary)] px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                  {g.categoria}
                </div>
                {g.itens.map((i) => {
                  const idx = achatada.findIndex((x) => x.id === i.id)
                  const sel = idx === ativo
                  return (
                    <div
                      key={i.id}
                      role="option"
                      aria-selected={valor?.id === i.id}
                      onMouseEnter={() => setAtivo(idx)}
                      onClick={() => escolher(i)}
                      className="cursor-pointer px-3 py-2"
                      style={{ background: sel ? "var(--surface-hover)" : "transparent" }}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm text-[var(--text-primary)]">{i.name}</span>
                        <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{i.code}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        {i.moeda && <Sinal>{i.moeda}</Sinal>}
                        {i.temPreco && <Sinal tom="ok">valor configurado</Sinal>}
                        {i.fornecedorPadraoNome && <Sinal icone={<Truck className="h-3 w-3" />}>{i.fornecedorPadraoNome}</Sinal>}
                        {!i.temConfig && <Sinal tom="alerta" icone={<AlertTriangle className="h-3 w-3" />}>sem configuração</Sinal>}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
            {truncado && (
              <div className="border-t border-[var(--border-default)] px-3 py-2 text-xs text-[var(--text-muted)]">
                Mostrando os primeiros resultados — refine a busca para ver os demais.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Sinal({ children, tom, icone }: { children: React.ReactNode; tom?: "ok" | "alerta"; icone?: React.ReactNode }) {
  const cor = tom === "ok" ? "var(--success)" : tom === "alerta" ? "var(--accent-primary)" : "var(--text-muted)"
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-[10px]"
      style={{ borderColor: `color-mix(in srgb, ${cor} 30%, transparent)`, color: cor, background: `color-mix(in srgb, ${cor} 8%, transparent)` }}
    >{icone}{children}</span>
  )
}

function Skeleton() {
  return (
    <div className="space-y-2 p-3" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="animate-pulse">
          <div className="h-3 w-1/2 rounded bg-[var(--surface-hover)]" />
          <div className="mt-1.5 h-2 w-1/3 rounded bg-[var(--surface-hover)]" />
        </div>
      ))}
    </div>
  )
}

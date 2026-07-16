"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Search, Loader2, FolderOpen, Users, User, Building2 } from "lucide-react"
import { buscarGlobal } from "@/src/components/home/use-home"
import type { SearchResult } from "@/src/app/api/home/search/route"

const ICONE: Record<SearchResult["tipo"], React.ComponentType<{ className?: string }>> = {
  processo: FolderOpen,
  familia: Users,
  requerente: User,
  cliente: Building2,
}
const ROTULO: Record<SearchResult["tipo"], string> = {
  processo: "Processo",
  familia: "Família",
  requerente: "Requerente",
  cliente: "Cliente",
}

/**
 * Busca global integrada (família, requerente, código/nome do processo, cliente).
 * Debounce + navegação por teclado + acessível (combobox/listbox).
 */
export function GlobalSearch({ autoFocusRef }: { autoFocusRef?: React.RefObject<HTMLInputElement | null> }) {
  const router = useRouter()
  const [q, setQ] = React.useState("")
  const [resultados, setResultados] = React.useState<SearchResult[]>([])
  const [aberto, setAberto] = React.useState(false)
  const [carregando, setCarregando] = React.useState(false)
  const [ativo, setAtivo] = React.useState(-1)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const internalRef = React.useRef<HTMLInputElement>(null)
  const inputRef = autoFocusRef ?? internalRef
  const reqId = React.useRef(0)

  // Debounce da busca
  React.useEffect(() => {
    const termo = q.trim()
    if (termo.length < 2) {
      setResultados([])
      setCarregando(false)
      return
    }
    setCarregando(true)
    const id = ++reqId.current
    const timer = setTimeout(async () => {
      try {
        const res = await buscarGlobal(termo)
        if (id === reqId.current) {
          setResultados(res)
          setAberto(true)
          setAtivo(-1)
        }
      } catch {
        if (id === reqId.current) setResultados([])
      } finally {
        if (id === reqId.current) setCarregando(false)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [q])

  // Fecha ao clicar fora
  React.useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  function irPara(r: SearchResult) {
    setAberto(false)
    setQ("")
    setResultados([])
    router.push(r.href)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!aberto && (e.key === "ArrowDown" || e.key === "ArrowUp") && resultados.length) {
      setAberto(true)
      return
    }
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setAtivo((i) => Math.min(i + 1, resultados.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setAtivo((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      if (ativo >= 0 && resultados[ativo]) {
        e.preventDefault()
        irPara(resultados[ativo])
      }
    } else if (e.key === "Escape") {
      setAberto(false)
    }
  }

  const mostrarDropdown = aberto && q.trim().length >= 2

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={mostrarDropdown}
          aria-controls="busca-global-lista"
          aria-autocomplete="list"
          aria-label="Buscar família, requerente, processo ou cliente"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => resultados.length && setAberto(true)}
          onKeyDown={onKeyDown}
          placeholder="Buscar família, requerente, processo ou cliente…"
          className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
        />
        {carregando && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />}
      </div>

      {mostrarDropdown && (
        <ul
          id="busca-global-lista"
          role="listbox"
          className="absolute z-50 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {resultados.length === 0 && !carregando && (
            <li className="px-3 py-3 text-sm text-slate-500">Nenhum resultado para “{q}”.</li>
          )}
          {resultados.map((r, i) => {
            const Icon = ICONE[r.tipo]
            return (
              <li
                key={`${r.tipo}-${r.id}-${r.processoId}`}
                role="option"
                aria-selected={i === ativo}
                onMouseEnter={() => setAtivo(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  irPara(r)
                }}
                className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 ${i === ativo ? "bg-sky-50" : ""}`}
              >
                <Icon className="h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{r.label}</p>
                  {r.sub && <p className="truncate text-xs text-slate-500">{r.sub}</p>}
                </div>
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  {ROTULO[r.tipo]}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

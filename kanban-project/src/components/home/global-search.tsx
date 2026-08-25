"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Search, Loader2, FolderOpen, Users, User, Building2 } from "lucide-react"
import { buscarGlobal } from "@/src/components/home/use-home"
import { useConsulta } from "@/src/lib/dados"
import { useDebounce } from "@/src/hooks/use-debounce"
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
const SEM_RESULTADOS: SearchResult[] = []

export function GlobalSearch({ autoFocusRef }: { autoFocusRef?: React.RefObject<HTMLInputElement | null> }) {
  const router = useRouter()
  const [q, setQ] = React.useState("")
  // "Aberto" é o inverso de "dispensado PARA ESTE TERMO": digitar outra coisa reabre a
  // lista sozinho — que era o efeito de `setAberto(true)` quando os resultados
  // chegavam. Fechar (Esc, clique fora, navegar) marca o termo atual como dispensado.
  const [dispensado, setDispensado] = React.useState<string | null>(null)
  // Idem para o item destacado pelo teclado: ele pertence ao termo em que foi
  // escolhido, então trocar o termo volta a -1 sem efeito nenhum.
  const [destaque, setDestaque] = React.useState<{ termo: string; i: number } | null>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const internalRef = React.useRef<HTMLInputElement>(null)
  const inputRef = autoFocusRef ?? internalRef

  // Termo curto não busca — e, principalmente, não mostra resultado velho. Isso é
  // DERIVAÇÃO, não estado: limpar por efeito (`setResultados([])`) fazia a lista
  // antiga aparecer por um render antes de sumir.
  const termo = q.trim()
  const buscavel = termo.length >= 2
  const aberto = buscavel && dispensado !== termo
  const setAberto = (v: boolean) => setDispensado(v ? null : termo)
  const ativo = destaque?.termo === termo ? destaque.i : -1
  const setAtivo = (proximo: number | ((anterior: number) => number)) => {
    const i = typeof proximo === 'function' ? proximo(ativo) : proximo
    setDestaque({ termo, i })
  }
  // A busca é uma CONSULTA com o termo na chave, não um efeito com cronômetro e
  // contador de requisição. O `reqId` que existia aqui — para descartar a resposta de
  // um termo já superado — deixa de ser necessário: uma resposta antiga pertence a
  // outra chave e não tem onde ser aplicada. E digitar de novo o mesmo termo vem do
  // cache, sem ir à rede.
  const termoBuscado = useDebounce(termo, 250)
  const consulta = useConsulta<SearchResult[]>(
    termoBuscado.length >= 2 ? `busca-global:${termoBuscado}` : null,
    () => buscarGlobal(termoBuscado),
    { keepPreviousData: true },
  )
  const resultados = consulta.dados ?? SEM_RESULTADOS
  const carregando = consulta.carregando
  // Termo curto não mostra resultado velho: com `keepPreviousData`, a lista anterior
  // continua no cache de propósito (não pisca entre teclas), então quem decide o que
  // aparece é esta derivação.
  const resultadosVisiveis = buscavel ? resultados : SEM_RESULTADOS
  const carregandoVisivel = buscavel && carregando

  // Fecha ao clicar fora. `dispensar` é a única coisa de que este efeito depende, e
  // depende MESMO: fechar carimba o termo atual como dispensado.
  const dispensar = React.useCallback(() => setDispensado(termo), [termo])
  React.useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) dispensar()
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [dispensar])

  function irPara(r: SearchResult) {
    // Limpar o termo já esconde a lista (`buscavel` fica falso) — não há estado de
    // resultado para zerar.
    setAberto(false)
    setQ("")
    router.push(r.href)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!aberto && (e.key === "ArrowDown" || e.key === "ArrowUp") && resultadosVisiveis.length) {
      setAberto(true)
      return
    }
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setAtivo((i) => Math.min(i + 1, resultadosVisiveis.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setAtivo((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      if (ativo >= 0 && resultadosVisiveis[ativo]) {
        e.preventDefault()
        irPara(resultadosVisiveis[ativo])
      }
    } else if (e.key === "Escape") {
      setAberto(false)
    }
  }

  const mostrarDropdown = aberto && q.trim().length >= 2

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
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
          onFocus={() => resultadosVisiveis.length && setAberto(true)}
          onKeyDown={onKeyDown}
          placeholder="Buscar família, requerente, processo ou cliente…"
          className="h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] pl-9 pr-9 text-sm text-white backdrop-blur-md placeholder:text-[var(--text-muted)] focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/15"
        />
        {carregandoVisivel && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[var(--text-muted)]" />}
      </div>

      {mostrarDropdown && (
        <ul
          id="busca-global-lista"
          role="listbox"
          className="absolute z-50 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] py-1 shadow-2xl backdrop-blur-xl"
        >
          {resultadosVisiveis.length === 0 && !carregandoVisivel && (
            <li className="px-3 py-3 text-sm text-[var(--text-secondary)]">Nenhum resultado para “{q}”.</li>
          )}
          {resultadosVisiveis.map((r, i) => {
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
                className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 ${i === ativo ? "bg-[var(--surface-primary)]" : ""}`}
              >
                <Icon className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{r.label}</p>
                  {r.sub && <p className="truncate text-xs text-[var(--text-secondary)]">{r.sub}</p>}
                </div>
                <span className="shrink-0 rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/60">
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

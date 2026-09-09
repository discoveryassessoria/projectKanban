"use client"

// ============================================================================
// FILA AGRUPADA — lista de itens de UMA fila (drill-down da Central
// Operacional), agrupada por família/processo, com filtros reais.
// ----------------------------------------------------------------------------
// Achado real: a fila listava um item POR DOCUMENTO, sem agrupar e sem
// filtro nenhum — 28 itens de 4 famílias diferentes numa lista só, sem jeito
// de achar "só a família X" ou "só o que já está atrasado". Mesmo padrão já
// usado no sino de notificações (BlocoNotificacoes, header-bar.tsx): família
// com 1 item mostra ele direto; 2+ itens colapsam sob um cabeçalho com nome
// e contagem, que expande ao clicar.
//
// Compartilhado por TODAS as filas (/dashboard/fila/[key]) — corrigir aqui
// corrige a experiência de toda fila do app, não só "Prazos vencendo".
// ============================================================================

import { useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ChevronRight, ChevronDown, Search, X, Calendar } from "lucide-react"
import type { FilaItem } from "@/src/types/home"
import { formatarPrazo } from "./home-primitives"

const BANDEIRA: Record<string, string> = {
  ALEMANHA: "🇩🇪",
  ESPANHA: "🇪🇸",
  ITALIA: "🇮🇹",
  PORTUGAL: "🇵🇹",
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
const chaveGrupoDe = (it: FilaItem) => it.processoNome ?? it.processoCodigo ?? "Sem processo"

type AbaStatus = "todas" | "atrasadas" | "hoje" | "futuro"
const ABAS_STATUS: Array<[AbaStatus, string]> = [
  ["todas", "Todas"],
  ["atrasadas", "Atrasadas"],
  ["hoje", "Vencem hoje"],
  ["futuro", "A vencer"],
]
/** aceita tanto o nome novo da aba quanto os alias que os links antigos usavam (?janela=vencendo). */
const ALIAS_JANELA: Record<string, AbaStatus> = { vencendo: "futuro", vencidas: "atrasadas" }

function inicioDoDiaLocal(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function fimDoDiaLocal(d: Date) {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}
function statusDoItem(it: FilaItem, agora: Date): AbaStatus {
  if (!it.prazo) return "todas"
  if (it.atrasado) return "atrasadas"
  const p = new Date(it.prazo)
  if (p >= inicioDoDiaLocal(agora) && p <= fimDoDiaLocal(agora)) return "hoje"
  return "futuro"
}
export function FilaAgrupada({ itens }: { itens: FilaItem[] }) {
  const params = useSearchParams()
  const janelaInicial = (() => {
    const j = params.get("janela")
    if (!j) return "todas"
    return (ALIAS_JANELA[j] ?? j) as AbaStatus
  })()

  const [busca, setBusca] = useState("")
  const [processo, setProcesso] = useState("todos")
  const [pais, setPais] = useState("todos")
  const [abaStatus, setAbaStatus] = useState<AbaStatus>(janelaInicial)
  const [dataDe, setDataDe] = useState(params.get("de") ?? "")
  const [dataAte, setDataAte] = useState(params.get("ate") ?? "")
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())
  const agora = useMemo(() => new Date(), [])

  const temPrazo = useMemo(() => itens.some((it) => it.prazo), [itens])

  const contagemPorAba = useMemo(() => {
    const c: Record<AbaStatus, number> = { todas: itens.length, atrasadas: 0, hoje: 0, futuro: 0 }
    for (const it of itens) {
      const s = statusDoItem(it, agora)
      if (s !== "todas") c[s]++
    }
    return c
  }, [itens, agora])

  const processos = useMemo(() => {
    const contagem = new Map<string, number>()
    for (const it of itens) {
      const k = chaveGrupoDe(it)
      contagem.set(k, (contagem.get(k) ?? 0) + 1)
    }
    return [...contagem.entries()].sort((a, b) => b[1] - a[1])
  }, [itens])

  const paises = useMemo(() => {
    const set = new Set<string>()
    for (const it of itens) if (it.pais) set.add(it.pais)
    return [...set].sort()
  }, [itens])

  const filtrados = useMemo(() => {
    const termo = semAcento(busca.trim())
    const de = dataDe ? inicioDoDiaLocal(new Date(`${dataDe}T00:00:00`)) : null
    const ate = dataAte ? fimDoDiaLocal(new Date(`${dataAte}T00:00:00`)) : null
    return itens.filter((it) => {
      const nomeProcesso = chaveGrupoDe(it)
      if (processo !== "todos" && nomeProcesso !== processo) return false
      if (pais !== "todos" && it.pais !== pais) return false
      if (abaStatus !== "todas" && statusDoItem(it, agora) !== abaStatus) return false
      if ((de || ate) && it.prazo) {
        const p = new Date(it.prazo)
        if (de && p < de) return false
        if (ate && p > ate) return false
      } else if (de || ate) {
        return false // filtro de data ativo, item sem prazo não entra
      }
      if (termo) {
        const alvo = semAcento(`${it.titulo} ${it.subtitulo ?? ""} ${nomeProcesso}`)
        if (!alvo.includes(termo)) return false
      }
      return true
    })
  }, [itens, busca, processo, pais, abaStatus, dataDe, dataAte, agora])

  const grupos = useMemo(() => {
    const mapa = new Map<string, FilaItem[]>()
    for (const it of filtrados) {
      const chave = chaveGrupoDe(it)
      const arr = mapa.get(chave) ?? []
      arr.push(it)
      mapa.set(chave, arr)
    }
    return [...mapa.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [filtrados])

  const alternar = (chave: string) =>
    setExpandidos((prev) => {
      const next = new Set(prev)
      if (next.has(chave)) next.delete(chave)
      else next.add(chave)
      return next
    })

  const filtroAtivo =
    busca !== "" || processo !== "todos" || pais !== "todos" || abaStatus !== "todas" || dataDe !== "" || dataAte !== ""
  const limparFiltros = () => {
    setBusca("")
    setProcesso("todos")
    setPais("todos")
    setAbaStatus("todas")
    setDataDe("")
    setDataAte("")
  }

  return (
    <div className="space-y-3">
      {temPrazo && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border-default)] pb-2.5">
          {ABAS_STATUS.map(([valor, rotulo]) => (
            <button
              key={valor}
              onClick={() => setAbaStatus(valor)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                abaStatus === valor
                  ? "bg-[var(--action-primary)] text-[var(--action-primary-ink)]"
                  : "bg-[var(--surface-secondary)] text-[var(--text-secondary)] hover:text-white"
              }`}
            >
              {rotulo}
              {contagemPorAba[valor] > 0 && valor !== "todas" && (
                <span className="ml-1.5 tabular-nums opacity-80">{contagemPorAba[valor]}</span>
              )}
            </button>
          ))}

          <span className="mx-1 hidden h-4 w-px bg-[var(--border-default)] sm:block" />

          <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <Calendar className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            <input
              type="date"
              value={dataDe}
              max={dataAte || undefined}
              onChange={(e) => setDataDe(e.target.value)}
              className="rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1 text-xs text-white focus:outline-none focus:ring-2 focus:ring-white/20"
              aria-label="Prazo a partir de"
            />
            <span>até</span>
            <input
              type="date"
              value={dataAte}
              min={dataDe || undefined}
              onChange={(e) => setDataAte(e.target.value)}
              className="rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1 text-xs text-white focus:outline-none focus:ring-2 focus:ring-white/20"
              aria-label="Prazo até"
            />
            {(dataDe || dataAte) && (
              <button
                onClick={() => {
                  setDataDe("")
                  setDataAte("")
                }}
                className="text-[var(--text-muted)] hover:text-white"
                title="Limpar período"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por pessoa, documento ou família..."
            className="w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] py-1.5 pl-8 pr-3 text-xs text-white placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-white/20"
          />
        </div>

        <select
          value={processo}
          onChange={(e) => setProcesso(e.target.value)}
          className="rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-white/20"
        >
          <option value="todos">Todas as famílias ({processos.length})</option>
          {processos.map(([nome, qtd]) => (
            <option key={nome} value={nome}>
              {nome} ({qtd})
            </option>
          ))}
        </select>

        {paises.length > 1 && (
          <select
            value={pais}
            onChange={(e) => setPais(e.target.value)}
            className="rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-white/20"
          >
            <option value="todos">Todos os países</option>
            {paises.map((p) => (
              <option key={p} value={p}>
                {BANDEIRA[p] ?? "🏳️"} {p}
              </option>
            ))}
          </select>
        )}

        {filtroAtivo && (
          <button
            onClick={limparFiltros}
            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-text)] hover:underline"
          >
            <X className="h-3 w-3" /> Limpar filtros
          </button>
        )}

        <span className="ml-auto whitespace-nowrap text-xs text-[var(--text-muted)]">
          {filtrados.length} de {itens.length}
        </span>
      </div>

      {filtrados.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-default)] p-6 text-center text-xs text-[var(--text-muted)]">
          Nenhum item bate com esse filtro.
        </div>
      ) : (
        <div className="space-y-3">
          {grupos.map(([chaveGrupo, itensDoGrupo]) => {
            const temGrupo = itensDoGrupo.length > 1
            const aberto = !temGrupo || expandidos.has(chaveGrupo)
            return (
              <div key={chaveGrupo}>
                {temGrupo && (
                  <button
                    onClick={() => alternar(chaveGrupo)}
                    className="mb-1.5 flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-2 text-left transition hover:border-[var(--border-strong)]"
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold text-white">
                      {itensDoGrupo[0].pais && <span aria-hidden>{BANDEIRA[itensDoGrupo[0].pais] ?? "🏳️"}</span>}
                      {chaveGrupo}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                      {itensDoGrupo.length} {itensDoGrupo.length === 1 ? "item" : "itens"}
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${aberto ? "rotate-180" : ""}`} />
                    </span>
                  </button>
                )}
                {aberto && (
                  <ul className="space-y-1.5">
                    {itensDoGrupo.map((item) => (
                      <li key={item.id}>
                        <Link
                          href={item.href}
                          className={`group flex items-center gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2.5 transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-primary)] focus:outline-none focus:ring-2 focus:ring-white/20 ${temGrupo ? "ml-4" : ""}`}
                        >
                          <span className="w-6 shrink-0 text-center text-base">
                            {item.pais ? (BANDEIRA[item.pais] ?? "🏳️") : "•"}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-white">{item.titulo}</p>
                            <p className="truncate text-xs text-[var(--text-secondary)]">
                              {[item.processoCodigo ?? item.processoNome, item.subtitulo].filter(Boolean).join(" · ")}
                            </p>
                          </div>
                          {item.prazo && (
                            <span
                              className={`hidden shrink-0 text-xs font-medium sm:inline ${
                                item.atrasado ? "text-red-700" : "text-[var(--text-secondary)]"
                              }`}
                            >
                              {formatarPrazo(item.prazo)}
                            </span>
                          )}
                          <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

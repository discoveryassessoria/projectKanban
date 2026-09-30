"use client"

// ============================================================================
// CÂMBIO (discreto) — fork de `cambio-mini.tsx` para o cabeçalho das telas do
// aplicativo (mandato "modernização visual", 19/09/2026). O Kanban continua
// renderizando o `CambioMini` original, sem nenhuma edição — este componente
// existe só para não misturar a mudança de comportamento de carregamento com
// o arquivo que o Kanban usa.
//
// O QUE MUDOU: "EUR — USD — —" aparecia toda vez que a navegação trocava de
// página, porque `HeaderBar` (e portanto `CambioMini`) é remontado a cada
// rota — sem um cabeçalho persistente entre páginas, o SWR sempre recomeçava
// do zero. Este fork guarda o ÚLTIMO valor válido em `localStorage` (só client-
// side, só como valor inicial — nunca como fonte de verdade) e:
//   • no primeiro carregamento REAL (nunca viu câmbio antes): skeleton, não "—";
//   • com um valor conhecido: mostra ele já na primeira pintura, enquanto o
//     SWR revalida por trás — nunca pisca "—" para quem já tinha o dado;
//   • numa falha temporária com valor conhecido: mantém o último valor válido
//     (com o aviso de defasado), nunca apaga silenciosamente pelo traço.
// ============================================================================

import * as React from "react"
import Link from "next/link"
import useSWR from "swr"
import { AlertTriangle } from "lucide-react"
import { fetcherComAuth } from "@/src/components/home/use-home"
import { useLocalStorage } from "@/src/lib/cliente"
import { FUSO_OPERACIONAL } from "@/lib/operacional/tempo-operacional"

type MoedaSnap = {
  moeda: "EUR" | "USD"
  valor: number | null
  consultadoEm: string | null
  estado: "ATUALIZADO" | "SEM_NOVA_PUBLICACAO" | "DESATUALIZADO" | "INDISPONIVEL" | "CONFIGURACAO_PENDENTE"
}

const CHAVE_CACHE = "discovery:cambio:ultimo-snapshot"

const fmt = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })

/** Interpreta o texto cru do cache — nunca lança (cache corrompido = sem cache). */
export function interpretarCacheCambio(bruto: string | null): { moedas: MoedaSnap[] } | undefined {
  if (!bruto) return undefined
  try {
    return JSON.parse(bruto)
  } catch {
    return undefined
  }
}

function gravarCacheLocal(dados: { moedas: MoedaSnap[] } | undefined) {
  if (typeof window === "undefined" || !dados) return
  try {
    window.localStorage.setItem(CHAVE_CACHE, JSON.stringify(dados))
  } catch {
    /* localStorage indisponível (aba privada etc.) — só perde o cache, não quebra a tela */
  }
}

export function CambioMiniApp() {
  // `fallbackData` vem do cache local por `useSyncExternalStore` (`useLocalStorage`): no SERVIDOR e no
  // primeiro render da HIDRATAÇÃO o snapshot é `null` (igual nos dois lados, o skeleton); logo depois do
  // mount o React relê o storage e o último valor válido aparece. Achado real (30/09/2026): ler o
  // localStorage num `useState(() => ...)` fazia o cliente hidratar com o valor e o servidor ter
  // renderizado o skeleton → React #418 em TODA tela com o cabeçalho, para quem já tinha cache.
  const brutoCache = useLocalStorage(CHAVE_CACHE)
  const fallback = React.useMemo(() => interpretarCacheCambio(brutoCache), [brutoCache])

  const { data, isLoading, error } = useSWR<{ moedas: MoedaSnap[] }>("/api/cambio/snapshot", fetcherComAuth, {
    revalidateOnFocus: false,
    dedupingInterval: 300_000,
    refreshInterval: 900_000,
    errorRetryCount: 1,
    fallbackData: fallback,
  })

  React.useEffect(() => {
    if (data) gravarCacheLocal(data)
  }, [data])

  // SKELETON só quando não há NENHUM dado ainda (nem fresco, nem em cache) —
  // é o único caso em que "carregando" é honesto; com cache, o valor conhecido
  // já aparece.
  if (isLoading && !data) {
    return (
      <div
        className="hidden items-center gap-3 rounded-full border border-[var(--border-strong)] px-3 py-1.5 xl:inline-flex"
        aria-label="Carregando cotações"
      >
        <div className="h-3 w-24 animate-pulse rounded bg-white/15" />
        <span className="h-3 w-px bg-[var(--surface-secondary)]" />
        <div className="h-3 w-16 animate-pulse rounded bg-white/15" />
      </div>
    )
  }

  const moedas = data?.moedas ?? []
  const eur = moedas.find((m) => m.moeda === "EUR")
  const usd = moedas.find((m) => m.moeda === "USD")
  // Falha SEM nunca ter tido valor: mostra o alerta, sem inventar número.
  // Falha COM valor conhecido: `data` já é o fallback (SWR mantém o último
  // dado bom em erro) — o traço nunca substitui silenciosamente o que já
  // se sabia.
  const falhouSemDadoAlgum = !!error && moedas.length === 0
  const defasado = falhouSemDadoAlgum || moedas.some((m) => m.estado !== "ATUALIZADO")
  const atualizacao = [eur?.consultadoEm, usd?.consultadoEm].filter(Boolean).sort().reverse()[0] ?? null

  return (
    <Link
      href="/cambio"
      title={falhouSemDadoAlgum ? "Cotações indisponíveis no momento · ver histórico" : "Cotações do dia · ver histórico"}
      className="hidden items-center gap-3 rounded-full border border-[var(--border-strong)] px-3 py-1.5 text-white transition hover:bg-[var(--surface-hover)] xl:inline-flex"
    >
      <span className="flex items-center gap-1.5 text-[11px]">
        <span className="text-[var(--text-secondary)]">EUR</span>
        <span className="font-semibold tabular-nums">{fmt(eur?.valor ?? null)}</span>
      </span>
      <span className="h-3 w-px bg-[var(--surface-secondary)]" />
      <span className="flex items-center gap-1.5 text-[11px]">
        <span className="text-[var(--text-secondary)]">USD</span>
        <span className="font-semibold tabular-nums">{fmt(usd?.valor ?? null)}</span>
      </span>
      <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
        {defasado && <AlertTriangle className="h-3 w-3 text-amber-800" aria-hidden="true" />}
        {atualizacao
          ? new Date(atualizacao).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: FUSO_OPERACIONAL })
          : "—"}
      </span>
    </Link>
  )
}

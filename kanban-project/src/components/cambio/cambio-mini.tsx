"use client"

// ============================================================================
// CÂMBIO (discreto) — componente da barra superior, presente em TODAS as telas
// ----------------------------------------------------------------------------
// Mostra só o essencial: EUR/BRL, USD/BRL e a última atualização. Não é card,
// não é KPI, não ocupa espaço da operação. LÊ SÓ O BANCO (/api/cambio/snapshot)
// — nunca consulta a Confidence daqui — e clica para o histórico (/cambio).
// ============================================================================

import * as React from "react"
import Link from "next/link"
import useSWR from "swr"
import { AlertTriangle } from "lucide-react"
import { fetcherComAuth } from "@/src/components/home/use-home"

type MoedaSnap = {
  moeda: "EUR" | "USD"
  valor: number | null
  consultadoEm: string | null
  estado: "ATUALIZADO" | "SEM_NOVA_PUBLICACAO" | "DESATUALIZADO" | "INDISPONIVEL" | "CONFIGURACAO_PENDENTE"
}

const fmt = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })

export function CambioMini() {
  // Câmbio muda no máximo uma vez por dia: revalidação folgada, sem retry ruidoso.
  const { data } = useSWR<{ moedas: MoedaSnap[] }>("/api/cambio/snapshot", fetcherComAuth, {
    revalidateOnFocus: false,
    dedupingInterval: 300_000,
    refreshInterval: 900_000,
    errorRetryCount: 1,
  })

  const moedas = data?.moedas ?? []
  const eur = moedas.find((m) => m.moeda === "EUR")
  const usd = moedas.find((m) => m.moeda === "USD")
  const defasado = moedas.some((m) => m.estado !== "ATUALIZADO")
  const atualizacao = [eur?.consultadoEm, usd?.consultadoEm].filter(Boolean).sort().reverse()[0] ?? null

  return (
    <Link
      href="/cambio"
      title="Cotações do dia · ver histórico"
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
        {defasado && <AlertTriangle className="h-3 w-3 text-amber-800" />}
        {atualizacao
          ? new Date(atualizacao).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
          : "—"}
      </span>
    </Link>
  )
}

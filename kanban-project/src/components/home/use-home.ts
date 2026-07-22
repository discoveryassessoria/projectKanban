"use client"

import useSWR from "swr"
import type { FilaDetalhe, HomeData } from "@/src/types/home"
import type { SearchResult } from "@/src/app/api/home/search/route"

// Fetcher autenticado — mesma convenção do restante do app (Authorization: Bearer
// a partir do authToken em localStorage). Os handlers leem o Bearer header.
export async function fetcherComAuth(url: string) {
  const token = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const err = new Error("Falha ao carregar") as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return res.json()
}

/** Centro Operacional (uma chamada agregadora, revalidada a cada minuto). */
export function useHomeData() {
  const { data, error, isLoading, mutate } = useSWR<HomeData>("/api/home", fetcherComAuth, {
    revalidateOnFocus: true,
    refreshInterval: 60_000,
    dedupingInterval: 20_000,
    keepPreviousData: true,
    errorRetryCount: 2,
  })
  return { data, error, isLoading, recarregar: mutate }
}

/** Drill-down: os itens exatos de uma fila da Central Operacional. */
export function useFila(key: string) {
  const { data, error, isLoading, mutate } = useSWR<FilaDetalhe>(
    key ? `/api/home/fila/${key}` : null,
    fetcherComAuth,
    { revalidateOnFocus: true, dedupingInterval: 20_000, errorRetryCount: 2 },
  )
  return { data, error, isLoading, recarregar: mutate }
}

export async function buscarGlobal(q: string): Promise<SearchResult[]> {
  if (q.trim().length < 2) return []
  const json = await fetcherComAuth(`/api/home/search?q=${encodeURIComponent(q)}`)
  return (json?.resultados ?? []) as SearchResult[]
}

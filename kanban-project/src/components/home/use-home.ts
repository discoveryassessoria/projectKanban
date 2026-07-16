"use client"

import useSWR from "swr"
import type { HomeData } from "@/src/types/home"
import type { SearchResult } from "@/src/app/api/home/search/route"

// Fetcher autenticado — mesma convenção do restante do app (Authorization: Bearer
// a partir do authToken em localStorage). O handler /api/home lê o Bearer header.
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

export function useHomeData() {
  const { data, error, isLoading, mutate } = useSWR<HomeData>("/api/home", fetcherComAuth, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
    errorRetryCount: 2,
  })
  return { data, error, isLoading, recarregar: mutate }
}

export async function buscarGlobal(q: string): Promise<SearchResult[]> {
  if (q.trim().length < 2) return []
  const json = await fetcherComAuth(`/api/home/search?q=${encodeURIComponent(q)}`)
  return (json?.resultados ?? []) as SearchResult[]
}

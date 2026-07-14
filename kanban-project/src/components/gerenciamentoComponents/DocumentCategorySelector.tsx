"use client"

// LOTE A — Seletor reutilizável de Categoria Documental (retorna categoryId).
// Lista ativas por padrão; mantém visível a categoria já vinculada mesmo inativa.
// NÃO permite criação inline. Loading/vazio/erro tratados.

import { useEffect, useState } from "react"

interface Cat { id: number; code: string; name: string; ativo: boolean }

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { Authorization: `Bearer ${t}` } : {}
}

export default function DocumentCategorySelector({
  value,
  onChange,
  currentInactive,
  className,
}: {
  value: number | null
  onChange: (id: number | null) => void
  /** categoria já vinculada que pode estar inativa (mantida visível no select) */
  currentInactive?: { id: number; name: string } | null
  className?: string
}) {
  const [cats, setCats] = useState<Cat[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState("")

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch("/api/gerenciamento/categorias-documentais?status=ativas", { headers: authHeaders() })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const j = await res.json()
        if (alive) setCats(j.categorias || [])
      } catch {
        if (alive) setErro("Falha ao carregar categorias.")
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  if (loading) return <div className={className}>Carregando categorias…</div>
  if (erro) return <div className={`${className ?? ""} text-red-300`}>{erro}</div>

  const valorNaLista = value != null && cats.some((c) => c.id === value)
  const extra = currentInactive && value != null && !valorNaLista ? [currentInactive] : []

  return (
    <select
      className={className}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      aria-label="Categoria documental"
    >
      <option value="">— sem categoria —</option>
      {cats.length === 0 && extra.length === 0 ? (
        <option value="" disabled>(nenhuma categoria ativa)</option>
      ) : null}
      {cats.map((c) => (
        <option key={c.id} value={c.id} className="bg-zinc-900">{c.name}</option>
      ))}
      {extra.map((c) => (
        <option key={c.id} value={c.id} className="bg-zinc-900">{c.name} (inativa)</option>
      ))}
    </select>
  )
}

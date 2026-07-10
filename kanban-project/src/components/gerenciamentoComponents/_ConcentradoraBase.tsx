'use client'
// src/components/gerenciamentoComponents/_ConcentradoraBase.tsx
// LOTE D · Opção B — base reutilizável de TELA CONCENTRADORA com abas internas.
// Reusa componentes existentes; abas sem componente mostram "Em breve" (fiéis ao
// desenho do Marco). Persiste a aba na URL (?tab=). Abas NÃO viram item lateral.
import { useState, useEffect, useCallback, Suspense } from 'react'

export type AbaDef = { key: string; label: string; Comp: React.ComponentType | null }

export function EmBreveAba({ titulo }: { titulo: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <div className="text-3xl">🚧</div>
      <div className="text-base font-medium text-white/80">{titulo}</div>
      <div className="max-w-md text-sm text-white/40">Esta aba faz parte da estrutura planejada e ainda não foi construída.</div>
    </div>
  )
}

export function Concentradora({ titulo, subtitulo, abas }: { titulo: string; subtitulo: string; abas: AbaDef[] }) {
  const primeira = abas[0]?.key || ''
  const [aba, setAba] = useState<string>(primeira)

  const lerURL = useCallback(() => {
    if (typeof window === 'undefined') return primeira
    const p = new URLSearchParams(window.location.search).get('tab')
    return abas.some(a => a.key === p) ? (p as string) : primeira
  }, [abas, primeira])

  useEffect(() => { setAba(lerURL()) }, [lerURL])

  const trocar = useCallback((key: string) => {
    setAba(key)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('tab', key)
      window.history.replaceState({}, '', url.toString())
    }
  }, [])

  const atual = abas.find(a => a.key === aba) || abas[0]
  const Atual = atual?.Comp

  return (
    <div className="text-white">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">{titulo}</h2>
        <p className="text-sm text-white/50">{subtitulo}</p>
      </div>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-white/10">
        {abas.map(a => (
          <button key={a.key} onClick={() => trocar(a.key)}
            className={`rounded-t-lg px-3 py-2 text-sm transition ${aba === a.key ? 'bg-white/10 font-medium text-white' : 'text-white/50 hover:text-white/80'}`}>
            {a.label}{a.Comp === null && <span className="ml-1 text-[9px] text-amber-400/60">soon</span>}
          </button>
        ))}
      </div>
      <Suspense fallback={<div className="py-10 text-center text-white/40">Carregando…</div>}>
        {Atual ? <Atual /> : <EmBreveAba titulo={atual?.label || ''} />}
      </Suspense>
    </div>
  )
}
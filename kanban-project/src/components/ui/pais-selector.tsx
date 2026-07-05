// ESTE ARQUIVO VAI EM: src/components/ui/pais-selector.tsx
//
// Tabs de países do kanban — agora DINÂMICAS: a lista vem do
// /api/kanban-config (CatalogoPais ativos), via props. Nada fixo no código.

"use client"

import type { PaisKanban } from "@/src/types/kanban"

interface PaisTabsProps {
  paises: PaisKanban[]
  paisSelecionado: string | null            // countryKey
  onSelect: (countryKey: string) => void
}

export function PaisTabs({ paises, paisSelecionado, onSelect }: PaisTabsProps) {
  if (!paises.length) return null
  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {paises.map((p) => {
        const ativo = p.countryKey === paisSelecionado
        return (
          <button
            key={p.countryKey}
            onClick={() => onSelect(p.countryKey)}
            className={`
              flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200
              ${ativo ? "bg-white text-gray-900 shadow" : "text-white/70 hover:text-white hover:bg-white/10"}
            `}
          >
            {p.flag && <span>{p.flag}</span>}
            {p.countryLabel}
          </button>
        )
      })}
    </div>
  )
}

// Versão dropdown (para telas menores ou formulários)
interface PaisSelectorProps {
  paises: PaisKanban[]
  paisSelecionado: string | null
  onSelect: (countryKey: string) => void
  className?: string
}

export function PaisSelector({ paises, paisSelecionado, onSelect, className = "" }: PaisSelectorProps) {
  return (
    <select
      value={paisSelecionado ?? ""}
      onChange={(e) => e.target.value && onSelect(e.target.value)}
      className={`rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-white/20 ${className}`}
    >
      <option value="" className="bg-zinc-900">— selecione o país —</option>
      {paises.map((p) => (
        <option key={p.countryKey} value={p.countryKey} className="bg-zinc-900">
          {p.flag ? `${p.flag} ` : ""}{p.countryLabel}
        </option>
      ))}
    </select>
  )
}
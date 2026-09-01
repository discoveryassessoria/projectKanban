"use client"

// src/components/ui/select-pais-canonico.tsx
//
// SELETOR DE PAÍS GEOGRÁFICO — pesquisável, alimentado pelo Cadastro Mestre.
//
// ─── POR QUE ELE EXISTE ─────────────────────────────────────────────────────
// O país de um órgão era um campo de texto livre. Texto livre não é identidade:
// "Itália", "Italia" e "ITÁLIA" viravam três países, e a anti-duplicidade do
// cadastro — que é "mesmo nome no mesmo país" — não enxergava a repetição.
// Aqui o operador escolhe uma LINHA do cadastro, e o que trafega é o `id`.
//
// ─── A FONTE É GEOGRAFIA, NÃO OFERTA ────────────────────────────────────────
// Este seletor lê `/api/gerenciamento/paises` (o registro geográfico), NUNCA a
// lista de nacionalidades ofertadas. O Consolato d'Italia em Miami fica nos
// Estados Unidos: o país do órgão e a cidadania que ele atende são dimensões
// diferentes. Por isso o Brasil aparece aqui e continua não sendo uma cidadania
// que a empresa vende.
//
// ─── ESTADOS ────────────────────────────────────────────────────────────────
// Carregando, vazio e erro são visíveis e não travam o formulário: sem a lista,
// o campo fica desabilitado com o motivo à mostra e um "Tentar novamente" —
// nunca um select vazio que o operador não sabe interpretar.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

export interface PaisCanonico {
  id: number
  countryKey: string
  countryLabel: string
  flag?: string | null
  ativo?: boolean
}

/** Normaliza para busca: sem acento, minúsculo. "espanha" acha "Espanha". */
const chave = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

interface Props {
  /** Identidade selecionada. `null` = país não informado. */
  valor: number | null
  onChange: (paisId: number | null) => void
  /** Lista já carregada pela tela. Se vier, o componente não busca sozinho. */
  paises?: PaisCanonico[]
  carregando?: boolean
  erro?: string | null
  onRecarregar?: () => void
  className?: string
  /** Só quando o modelo exigir país; hoje o órgão aceita ficar sem. */
  obrigatorio?: boolean
  placeholder?: string
}

export function SelectPaisCanonico({
  valor, onChange, paises, carregando = false, erro = null, onRecarregar,
  className = "", obrigatorio = false, placeholder = "— selecione o país —",
}: Props) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState("")
  const caixaRef = useRef<HTMLDivElement | null>(null)

  const lista = useMemo(() => {
    const ativos = (paises ?? []).filter((p) => p.ativo !== false)
    // O país já escolhido continua visível mesmo se for inativado depois — senão
    // abrir a ficha de um órgão antigo mostraria o campo vazio.
    const selecionado = (paises ?? []).find((p) => p.id === valor)
    const base = selecionado && !ativos.some((p) => p.id === valor) ? [selecionado, ...ativos] : ativos
    return [...base].sort((a, b) => a.countryLabel.localeCompare(b.countryLabel, "pt-BR"))
  }, [paises, valor])

  const filtrados = useMemo(() => {
    const q = chave(busca.trim())
    if (!q) return lista
    return lista.filter((p) => chave(p.countryLabel).includes(q) || chave(p.countryKey).includes(q))
  }, [lista, busca])

  const atual = useMemo(() => lista.find((p) => p.id === valor) ?? null, [lista, valor])

  // Fecha ao clicar fora — o padrão da casa para popovers desta tela.
  const fechar = useCallback(() => { setAberto(false); setBusca("") }, [])
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (caixaRef.current && !caixaRef.current.contains(e.target as Node)) fechar()
    }
    document.addEventListener("mousedown", fora)
    return () => document.removeEventListener("mousedown", fora)
  }, [aberto, fechar])

  const base = className ||
    "w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"

  if (erro) {
    return (
      <div className={`${base} flex items-center justify-between gap-2 text-white/60`}>
        <span className="truncate text-xs">Não foi possível carregar os países.</span>
        {onRecarregar && (
          <button type="button" onClick={onRecarregar} className="shrink-0 text-xs underline">
            Tentar novamente
          </button>
        )}
      </div>
    )
  }

  if (carregando) {
    return <div className={`${base} text-white/40`}>Carregando países…</div>
  }

  if (lista.length === 0) {
    return (
      <div className={`${base} text-xs text-white/50`}>
        Nenhum país no Cadastro Mestre. Cadastre em Gerenciamento › Países.
      </div>
    )
  }

  return (
    <div ref={caixaRef} className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className={`${base} flex items-center justify-between gap-2 text-left`}
      >
        <span className={atual ? "" : "text-white/30"}>
          {atual ? `${atual.flag ? `${atual.flag} ` : ""}${atual.countryLabel}` : placeholder}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {atual && !obrigatorio && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Limpar país"
              onClick={(e) => { e.stopPropagation(); onChange(null) }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onChange(null) } }}
              className="cursor-pointer text-white/40 hover:text-white/70"
            >
              ×
            </span>
          )}
          <span className="text-white/40">▾</span>
        </span>
      </button>

      {aberto && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] shadow-lg">
          <input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar país…"
            className="w-full border-b border-[var(--border-subtle)] bg-transparent px-3 py-2 text-sm text-white placeholder-white/30 outline-none"
          />
          <div className="max-h-56 overflow-auto">
            {filtrados.length === 0 ? (
              <div className="px-3 py-2 text-xs text-white/50">Nenhum país com esse nome.</div>
            ) : (
              filtrados.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { onChange(p.id); fechar() }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-[var(--surface-hover)] ${
                    p.id === valor ? "text-white" : "text-white/80"
                  }`}
                >
                  {p.flag && <span>{p.flag}</span>}
                  {p.countryLabel}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default SelectPaisCanonico

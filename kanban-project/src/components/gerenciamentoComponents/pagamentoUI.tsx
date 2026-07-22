'use client'
// ============================================================================
// Primitivos premium compartilhados dos cadastros de pagamento (identidade
// Financeiro: dark glass + OURO). Usados por Taxa e Condição de Pagamento —
// "shell compartilhado" da arquitetura. Sem lógica de domínio aqui.
// ============================================================================
import * as React from 'react'
import { Check, ChevronDown, X } from 'lucide-react'

export const OURO = '#D2A948'
export const GLASS = 'rounded-xl border border-white/10 bg-white/[0.05] backdrop-blur-md'
export const INPUT = 'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30'

export async function jf(url: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
  const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as any)?.error || `Erro ${res.status}`)
  return data
}

export function toggleArr<T>(arr: T[], v: T): T[] { return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v] }

export function Secao({ icon: Ic, titulo, dica, children }: { icon?: any; titulo: string; dica?: string; children: React.ReactNode }) {
  return (
    <div className={`${GLASS} p-4`}>
      <div className="mb-1 flex items-center gap-2">{Ic && <Ic className="h-4 w-4" style={{ color: OURO }} />}<h4 className="text-sm font-semibold text-white">{titulo}</h4></div>
      {dica && <p className="mb-3 text-[11px] text-white/40">{dica}</p>}
      <div className={dica ? '' : 'mt-2'}>{children}</div>
    </div>
  )
}

export function Campo({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <div className={wide ? 'sm:col-span-2' : ''}><label className="mb-1 block text-xs text-white/60">{label}</label>{children}</div>
}

export function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={INPUT}>
      {options.map(([v, l]) => <option key={v} value={v} className="bg-zinc-900">{l}</option>)}
    </select>
  )
}

export function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="flex items-center gap-2 text-left text-sm text-white/80">
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? '' : 'bg-white/15'}`} style={on ? { background: OURO } : undefined}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      {label}
    </button>
  )
}

export function ChipsMulti({ items, selecionados, onToggle }: { items: { id: string | number; label: string }[]; selecionados: (string | number)[]; onToggle: (id: string | number) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => {
        const on = selecionados.includes(it.id)
        return (
          <button key={String(it.id)} type="button" onClick={() => onToggle(it.id)} className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs transition ${on ? 'text-[#1b1508]' : 'border-white/15 text-white/60 hover:text-white'}`} style={on ? { background: OURO, borderColor: OURO } : undefined}>
            {on && <Check className="h-3 w-3" />}{it.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Seleção múltipla APENAS SELECIONÁVEL ────────────────────────────────────
// Contrato desta primitiva (é o que a etapa de Aplicabilidade exige):
//   • não existe input de texto — nada é digitado, nada é pesquisável;
//   • só se escolhe entre opções vindas do cadastro real;
//   • valor selecionado vira chip removível;
//   • não duplica (a lista é um conjunto por construção);
//   • fecha ao clicar fora e no Escape;
//   • navegável por teclado (setas, Enter/Espaço, Home/End, Escape);
//   • vazio = sem restrição (a semântica é do chamador; aqui é só o `dicaVazio`).
export interface OpcaoMulti { id: number; label: string; hint?: string }

export function MultiSelect({
  opcoes, selecionados, onChange, placeholder = 'Selecionar…', dicaVazio, vazioMsg = 'Nenhum registro cadastrado.', id,
}: {
  opcoes: OpcaoMulti[]
  selecionados: number[]
  onChange: (ids: number[]) => void
  placeholder?: string
  dicaVazio?: string
  vazioMsg?: string
  id?: string
}) {
  const [aberto, setAberto] = React.useState(false)
  const [foco, setFoco] = React.useState(0)
  const raiz = React.useRef<HTMLDivElement>(null)
  const listaRef = React.useRef<HTMLUListElement>(null)

  const porId = React.useMemo(() => new Map(opcoes.map((o) => [o.id, o])), [opcoes])
  // Só ids que existem no cadastro chegam a ser exibidos como chip.
  const escolhidos = React.useMemo(
    () => selecionados.filter((sid) => porId.has(sid)).map((sid) => porId.get(sid)!),
    [selecionados, porId],
  )

  // fecha ao clicar fora
  React.useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => { if (raiz.current && !raiz.current.contains(e.target as Node)) setAberto(false) }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [aberto])

  React.useEffect(() => {
    if (!aberto || !listaRef.current) return
    listaRef.current.querySelector<HTMLElement>(`[data-i="${foco}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [foco, aberto])

  // Alterna: já selecionado sai, senão entra. Nunca duplica.
  const alternar = (oid: number) => {
    onChange(selecionados.includes(oid) ? selecionados.filter((x) => x !== oid) : [...selecionados, oid])
  }

  const teclado = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setAberto(false); return }
    if (!aberto && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) { e.preventDefault(); setAberto(true); return }
    if (!aberto || opcoes.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setFoco((f) => (f + 1) % opcoes.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFoco((f) => (f - 1 + opcoes.length) % opcoes.length) }
    else if (e.key === 'Home') { e.preventDefault(); setFoco(0) }
    else if (e.key === 'End') { e.preventDefault(); setFoco(opcoes.length - 1) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const o = opcoes[foco]; if (o) alternar(o.id) }
  }

  return (
    <div ref={raiz} className="relative">
      <button
        type="button" id={id} role="combobox" aria-expanded={aberto} aria-haspopup="listbox"
        onClick={() => setAberto((v) => !v)} onKeyDown={teclado}
        className={`${INPUT} flex items-center justify-between gap-2 text-left`}
      >
        <span className={escolhidos.length ? 'text-white/85' : 'text-white/30'}>
          {escolhidos.length ? `${escolhidos.length} selecionado${escolhidos.length > 1 ? 's' : ''}` : placeholder}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-white/40 transition ${aberto ? 'rotate-180' : ''}`} />
      </button>

      {aberto && (
        <ul
          ref={listaRef} role="listbox" aria-multiselectable tabIndex={-1} onKeyDown={teclado}
          className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-white/15 bg-zinc-900 p-1 shadow-2xl"
        >
          {opcoes.length === 0 ? (
            <li className="px-2 py-2 text-[11px] text-white/35">{vazioMsg}</li>
          ) : opcoes.map((o, i) => {
            const on = selecionados.includes(o.id)
            return (
              <li key={o.id} data-i={i} role="option" aria-selected={on}
                onMouseEnter={() => setFoco(i)} onClick={() => alternar(o.id)}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition ${foco === i ? 'bg-white/10' : ''} ${on ? 'text-white' : 'text-white/70'}`}
              >
                <span className="grid h-4 w-4 shrink-0 place-items-center rounded border" style={on ? { background: OURO, borderColor: OURO } : { borderColor: 'rgba(255,255,255,0.25)' }}>
                  {on && <Check className="h-3 w-3 text-[#1b1508]" />}
                </span>
                <span className="truncate">{o.label}</span>
                {o.hint && <span className="ml-auto shrink-0 text-[10px] text-white/35">{o.hint}</span>}
              </li>
            )
          })}
        </ul>
      )}

      {escolhidos.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {escolhidos.map((o) => (
            <span key={o.id} className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs" style={{ background: `${OURO}1f`, borderColor: `${OURO}55`, color: OURO }}>
              {o.label}
              <button type="button" aria-label={`Remover ${o.label}`} onClick={() => alternar(o.id)} className="opacity-70 transition hover:opacity-100">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : dicaVazio ? (
        <p className="mt-1 text-[11px] text-white/35">{dicaVazio}</p>
      ) : null}
    </div>
  )
}

/** Trilha de passos (stepper) premium. */
export function Stepper({ passos, atual }: { passos: string[]; atual: number }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {passos.map((label, i) => {
        const n = i + 1
        return (
          <div key={label} className={`flex items-center gap-1.5 text-xs ${atual === n ? 'text-white' : atual > n ? 'text-emerald-400' : 'text-white/35'}`}>
            <span className={`grid h-5 w-5 place-items-center rounded-full border text-[10px] ${atual === n ? 'border-white/40' : atual > n ? 'border-emerald-400/40 bg-emerald-400/10' : 'border-white/15'}`}>{atual > n ? <Check className="h-3 w-3" /> : n}</span>
            {label}
          </div>
        )
      })}
    </div>
  )
}

'use client'
// ============================================================================
// Primitivos premium compartilhados dos cadastros de pagamento (identidade
// Financeiro: dark glass + OURO). Usados por Taxa e Condição de Pagamento —
// "shell compartilhado" da arquitetura. Sem lógica de domínio aqui.
// ============================================================================
import * as React from 'react'
import { Check } from 'lucide-react'

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

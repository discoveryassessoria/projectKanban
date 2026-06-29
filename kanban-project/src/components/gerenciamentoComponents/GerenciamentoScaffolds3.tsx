'use client'

// src/components/gerenciamentoComponents/GerenciamentoScaffolds3.tsx
// Lote 3 — Centro do Processo (tema escuro), portado do mockup Operacional v4:
//   - PhaseIWFTab    (phaseiwf)   Workflows Internos das Fases
//   - PhaseModesTab  (phasemodes) Modos Internos das Fases
// SCAFFOLD: descrição + seletores + estado vazio fiéis. Cards de fase/CRUD no wiring.

import { useState } from 'react'

const CARD = 'rounded-xl border border-white/10 bg-white/5 backdrop-blur'
const BTN_GHOST =
  'rounded-lg border border-white/10 px-2.5 py-1 text-[10.5px] text-white/70 transition hover:bg-white/10'
const SELECT =
  'rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white outline-none focus:border-white/20'

function HeaderRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold text-white">{title}</h2>
      <span className="flex flex-wrap items-center gap-1.5">{children}</span>
    </div>
  )
}

/* --------------------- Workflows Internos das Fases (phaseiwf) ---------------- */
export function PhaseIWFTab() {
  const [pt, setPt] = useState('')
  return (
    <div>
      <div className="mb-3 text-xs text-white/50">
        Esta tela mostra os workflows internos aplicados em cada fase do Processo de Nacionalidade
        selecionado. Para criar ou editar modelos reutilizáveis, use{' '}
        <span className="text-blue-300">Modelos de Workflow Interno</span>.
      </div>
      <HeaderRow title="Workflows Internos das Fases">
        <button className={BTN_GHOST}>Abrir biblioteca de modelos</button>
        <select value={pt} onChange={(e) => setPt(e.target.value)} className={SELECT}>
          <option value="" className="bg-zinc-900">— Processo de Nacionalidade —</option>
        </select>
      </HeaderRow>
      <div className={`${CARD} p-5 text-sm text-white/40`}>
        Escolha um Processo de Nacionalidade para ver todos os seus workflows internos por fase.
      </div>
    </div>
  )
}

/* --------------------- Modos Internos das Fases (phasemodes) ------------------ */
export function PhaseModesTab() {
  const [pt, setPt] = useState('')
  const [phase, setPhase] = useState('')
  return (
    <div>
      <div className="mb-3 text-xs text-white/50">
        Esta tela mostra os modos internos aplicados nas fases do Processo de Nacionalidade selecionado.
        Para criar ou editar modelos reutilizáveis, use{' '}
        <span className="text-blue-300">Modelos Internos de Fase</span>.
      </div>
      <HeaderRow title="Modos Internos das Fases">
        <button className={BTN_GHOST}>Abrir biblioteca de modelos</button>
        <select value={pt} onChange={(e) => setPt(e.target.value)} className={SELECT}>
          <option value="" className="bg-zinc-900">— Processo de Nacionalidade —</option>
        </select>
        <select value={phase} onChange={(e) => setPhase(e.target.value)} className={SELECT}>
          <option value="" className="bg-zinc-900">— Fase —</option>
        </select>
      </HeaderRow>
      <div className={`${CARD} p-5 text-sm text-white/40`}>
        Modos internos são variações DENTRO de uma fase (ex.: Judicial/Administrativa na Retificação).
        Escolha Processo e Fase.
      </div>
    </div>
  )
}
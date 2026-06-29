'use client'

// src/components/gerenciamentoComponents/GerenciamentoScaffolds4.tsx
// Lote 4 (final) — tema escuro, portado do mockup Operacional v4:
//   - FinCatalogTab    (catalog)      Catálogo Financeiro
//   - HonorariumsTab   (honorariums)  Honorários
//   - PricingRulesTab  (pricing)      Regras de Preço
//   - PhaseMapTab      (phasemap)     Regras de Disparo por Fase
//   - DiagnosticsTab   (diagnostics)  Diagnóstico do Sistema
// SCAFFOLD: estrutura/colunas/cards fiéis; dados e CRUD ligados no wiring.

import { useState } from 'react'

const CARD = 'rounded-xl border border-white/10 bg-white/5 backdrop-blur'
const BTN_PRIMARY =
  'rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500'

function Section({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-base font-semibold text-white">{title}</h2>
      {action}
    </div>
  )
}

function Table({ headers, empty }: { headers: string[]; empty?: string }) {
  return (
    <div className={`overflow-hidden ${CARD}`}>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="bg-white/5">
            {headers.map((h, i) => (
              <th
                key={i}
                className={`whitespace-nowrap border-b border-white/10 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white/50 ${
                  i === headers.length - 1 ? 'text-right' : 'text-left'
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={headers.length} className="px-3 py-6 text-center text-xs text-white/40">
              {empty || 'Nenhum cadastro. Clique em “+ Novo” para começar.'}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/* ----------------------- Catálogo Financeiro (catalog) ---------------------- */
const CAT_FILTERS = [
  'Todos', 'Honorários', 'Taxas', 'Custos', 'Serviços', 'Reembolsos', 'Impostos', 'Descontos', 'Comissões',
]
export function FinCatalogTab() {
  const [filtro, setFiltro] = useState('Todos')
  return (
    <div>
      <div className="mb-3 text-xs text-white/50">
        Itens financeiros mestres usados em honorários, taxas, custos, receitas, propostas, automações e
        lançamentos. <b className="text-white/70">Fonte única</b> — cada código existe uma só vez.
      </div>
      <Section title="Catálogo Financeiro" action={<button className={BTN_PRIMARY}>+ Novo Item</button>} />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {CAT_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition ${
              filtro === f
                ? 'border-blue-500/60 bg-blue-500/15 text-blue-200'
                : 'border-white/10 text-white/60 hover:bg-white/5'
            }`}
          >
            {f}
          </button>
        ))}
      </div>
      <Table headers={['Código', 'Nome', 'Espécie', 'Natureza', 'Preço base', 'Disparo', 'Status', 'Ações']} />
    </div>
  )
}

/* --------------------------- Honorários (honorariums) ----------------------- */
export function HonorariumsTab() {
  return (
    <div>
      <div className="mb-3 text-xs text-white/50">
        Visão filtrada do Catálogo Financeiro — apenas itens do tipo <b className="text-white/70">Honorário</b>.
        Valor e fase vêm das Regras de Preço e de Disparo.
      </div>
      <Section title="Honorários" action={<button className={BTN_PRIMARY}>+ Novo Honorário</button>} />
      <Table
        headers={['Código', 'Nome', 'Natureza', 'Moeda', 'Preço base', 'Fase de disparo', 'Automático', 'Ações']}
      />
    </div>
  )
}

/* ------------------------- Regras de Preço (pricing) ------------------------ */
export function PricingRulesTab() {
  return (
    <div>
      <div className="mb-3 text-xs text-white/50">
        Quanto custa cada item, para quem e em qual contexto. Não cria item novo — escolhe um do Catálogo
        Financeiro. A proposta do processo tem prioridade sobre estas regras.
      </div>
      <Section title="Regras de Preço" action={<button className={BTN_PRIMARY}>+ Nova Regra de Preço</button>} />
      <Table
        headers={['Item', 'Nome', 'Espécie', 'Nacionalidade', 'Valor', 'Mín / Máx', 'Sobrescreve?', 'Status', 'Ações']}
      />
    </div>
  )
}

/* -------------------- Regras de Disparo por Fase (phasemap) ------------------ */
const FASES = [
  'Genealogia', 'Emissão documental', 'Análise Documental', 'Retificação de registros',
  'Emissão documental retificada', 'Tradução juramentada', 'Apostilamento', 'Aguardando protocolo',
  'Protocolado', 'Finalizado',
]
function PhaseCard({ nome }: { nome: string }) {
  return (
    <div className={`${CARD} p-3.5`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-bold text-white">{nome}</div>
        <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/50">sem regras</span>
      </div>
      <div className="mb-2.5 grid grid-cols-3 gap-1.5 text-center">
        <div><div className="text-lg font-extrabold text-blue-300">0</div><div className="text-[9px] text-white/50">Disparos</div></div>
        <div><div className="text-lg font-extrabold text-violet-300">0</div><div className="text-[9px] text-white/50">Operac.</div></div>
        <div><div className="text-lg font-extrabold text-amber-300">0</div><div className="text-[9px] text-white/50">Alertas</div></div>
      </div>
      <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-white/40">Itens financeiros (disparo)</div>
      <div className="text-[11px] text-white/40">— nenhuma —</div>
      <div className="mb-0.5 mt-2 text-[10px] font-bold uppercase tracking-wide text-white/40">Operacional</div>
      <div className="text-[11px] text-white/40">— nenhuma —</div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <button className="rounded-lg bg-blue-600 px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-blue-500">+ Disparo financeiro</button>
        <button className="rounded-lg border border-white/10 px-2 py-1 text-[10px] text-white/70 transition hover:bg-white/10">Simular fase</button>
      </div>
    </div>
  )
}
export function PhaseMapTab() {
  return (
    <div>
      <div className="mb-3 text-xs text-white/50">
        Regras de disparo por fase — vinculam um item do Catálogo Financeiro a um evento da fase. Não criam
        item duplicado.
      </div>
      <Section
        title="Regras de Disparo por Fase"
        action={<button className={BTN_PRIMARY}>+ Nova Regra de Disparo</button>}
      />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {FASES.map((f) => <PhaseCard key={f} nome={f} />)}
      </div>
    </div>
  )
}

/* ----------------------- Diagnóstico do Sistema (diagnostics) --------------- */
function DiagBlock({ title, tone }: { title: string; tone: 'danger' | 'warn' | 'info' }) {
  const border = tone === 'danger' ? '#ef4444' : tone === 'warn' ? '#f59e0b' : '#2563eb'
  return (
    <div className={`mb-2.5 ${CARD} p-3.5`} style={{ borderLeft: `3px solid ${border}` }}>
      <div className="mb-1.5 text-[11px] font-extrabold uppercase tracking-wide text-white/50">{title} (0)</div>
      <div className="text-[12.5px] text-green-400">✓ Nada a reportar.</div>
    </div>
  )
}
export function DiagnosticsTab() {
  return (
    <div>
      <Section title="Diagnóstico do Sistema" action={<button className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/10">Reexecutar</button>} />
      <div className={`mb-2.5 ${CARD} p-3.5 text-center`}>
        <div className="text-xl font-extrabold text-green-400">Sistema OK</div>
      </div>
      <DiagBlock title="Erros" tone="danger" />
      <DiagBlock title="Avisos" tone="warn" />
      <DiagBlock title="Sugestões" tone="info" />
    </div>
  )
}
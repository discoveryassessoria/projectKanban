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
import { AvisoRascunho, TITULO_RASCUNHO, BTN_RASCUNHO } from './_RascunhoUI'

const CARD = 'rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur'
const BTN_PRIMARY =
  'rounded-lg bg-[var(--text-muted)] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[var(--surface-secondary)]'

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
          <tr className="bg-[var(--surface-primary)]">
            {headers.map((h, i) => (
              <th
                key={i}
                className={`whitespace-nowrap border-b border-[var(--border-default)] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] ${
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
            <td colSpan={headers.length} className="px-3 py-6 text-center text-xs text-[var(--text-muted)]">
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
      <AvisoRascunho />
      <div className="mb-3 text-xs text-[var(--text-secondary)]">
        Itens financeiros mestres usados em honorários, taxas, custos, receitas, propostas, automações e
        lançamentos. <b className="text-white/70">Fonte única</b> — cada código existe uma só vez.
      </div>
      <Section title="Catálogo Financeiro" action={<button disabled title={TITULO_RASCUNHO} className={BTN_RASCUNHO}>+ Novo Item</button>} />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {CAT_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition ${
              filtro === f
                ? 'border-[var(--border-default)] bg-[var(--surface-secondary)] text-[var(--text-secondary)]'
                : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]'
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
      <AvisoRascunho />
      <div className="mb-3 text-xs text-[var(--text-secondary)]">
        Visão filtrada do Catálogo Financeiro — apenas itens do tipo <b className="text-white/70">Honorário</b>.
        Valor e fase vêm das Regras de Preço e de Disparo.
      </div>
      <Section title="Honorários" action={<button disabled title={TITULO_RASCUNHO} className={BTN_RASCUNHO}>+ Novo Honorário</button>} />
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
      <AvisoRascunho />
      <div className="mb-3 text-xs text-[var(--text-secondary)]">
        Quanto custa cada item, para quem e em qual contexto. Não cria item novo — escolhe um do Catálogo
        Financeiro. A proposta do processo tem prioridade sobre estas regras.
      </div>
      <Section title="Regras de Preço" action={<button disabled title={TITULO_RASCUNHO} className={BTN_RASCUNHO}>+ Nova Regra de Preço</button>} />
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
        <span className="rounded-md bg-[var(--surface-primary)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">sem regras</span>
      </div>
      <div className="mb-2.5 grid grid-cols-3 gap-1.5 text-center">
        <div><div className="text-lg font-extrabold text-[var(--text-secondary)]">0</div><div className="text-[9px] text-[var(--text-secondary)]">Disparos</div></div>
        <div><div className="text-lg font-extrabold text-[var(--text-secondary)]">0</div><div className="text-[9px] text-[var(--text-secondary)]">Operac.</div></div>
        <div><div className="text-lg font-extrabold text-amber-800">0</div><div className="text-[9px] text-[var(--text-secondary)]">Alertas</div></div>
      </div>
      <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Itens financeiros (disparo)</div>
      <div className="text-[11px] text-[var(--text-muted)]">— nenhuma —</div>
      <div className="mb-0.5 mt-2 text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Operacional</div>
      <div className="text-[11px] text-[var(--text-muted)]">— nenhuma —</div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <button className="rounded-lg bg-[var(--action-primary)] px-2 py-1 text-[10px] font-semibold text-[var(--action-primary-ink)] transition hover:bg-[var(--action-primary)]">+ Disparo financeiro</button>
        <button className="rounded-lg border border-[var(--border-default)] px-2 py-1 text-[10px] text-white/70 transition hover:bg-[var(--surface-hover)]">Simular fase</button>
      </div>
    </div>
  )
}
export function PhaseMapTab() {
  return (
    <div>
      <AvisoRascunho />
      <div className="mb-3 text-xs text-[var(--text-secondary)]">
        Regras de disparo por fase — vinculam um item do Catálogo Financeiro a um evento da fase. Não criam
        item duplicado.
      </div>
      <Section
        title="Regras de Disparo por Fase"
        action={<button disabled title={TITULO_RASCUNHO} className={BTN_RASCUNHO}>+ Nova Regra de Disparo</button>}
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
      <div className="mb-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--text-secondary)]">{title} (0)</div>
      <div className="text-[12.5px] text-green-800">✓ Nada a reportar.</div>
    </div>
  )
}
export function DiagnosticsTab() {
  return (
    <div>
      <AvisoRascunho />
      <Section title="Diagnóstico do Sistema" action={<button disabled title={TITULO_RASCUNHO} className={BTN_RASCUNHO}>Reexecutar</button>} />
      <div className={`mb-2.5 ${CARD} p-3.5 text-center`}>
        <div className="text-xl font-extrabold text-green-800">Sistema OK</div>
      </div>
      <DiagBlock title="Erros" tone="danger" />
      <DiagBlock title="Avisos" tone="warn" />
      <DiagBlock title="Sugestões" tone="info" />
    </div>
  )
}
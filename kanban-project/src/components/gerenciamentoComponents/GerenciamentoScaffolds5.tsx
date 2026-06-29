'use client'

// src/components/gerenciamentoComponents/GerenciamentoScaffolds5.tsx
// Lote 5 — bibliotecas de modelos do Centro do Processo (tema escuro), portado do mockup v4:
//   - IWTemplatesTab  (iwtemplates)  Modelos de Workflow Interno
//   - IMTemplatesTab  (imtemplates)  Modelos Internos de Fase
//   - AMTemplatesTab  (amtemplates)  Modelos de Automação
// SCAFFOLD: desc + toolbar (busca/filtros) + tabela com colunas fiéis (vazia). CRUD no wiring.

import { useState } from 'react'

const CARD = 'rounded-xl border border-white/10 bg-white/5 backdrop-blur'
const BTN_PRIMARY =
  'rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500'
const INPUT =
  'rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white placeholder:text-white/40 outline-none focus:border-white/20'
const SELECT =
  'rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white outline-none focus:border-white/20'

function Section({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-base font-semibold text-white">{title}</h2>
      {action}
    </div>
  )
}

function Table({ headers, empty }: { headers: string[]; empty: string }) {
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
            <td colSpan={headers.length} className="px-3 py-6 text-center text-xs text-white/40">{empty}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function Opt({ children }: { children: React.ReactNode }) {
  return <option className="bg-zinc-900">{children}</option>
}

/* ------------------- Modelos de Workflow Interno (iwtemplates) -------------- */
export function IWTemplatesTab() {
  const [q, setQ] = useState('')
  return (
    <div>
      <div className="mb-1.5 text-xs text-white/50">
        Biblioteca mestre de modelos de passo a passo operacional. Cadastre aqui os modelos de Workflow
        Interno que depois serão aplicados nas fases dos Processos de Nacionalidade.
      </div>
      <Section
        title="Modelos de Workflow Interno"
        action={<button className={BTN_PRIMARY}>+ Novo modelo de workflow</button>}
      />
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar modelo..." className={`${INPUT} min-w-[160px]`} />
        <select className={SELECT}><Opt>Todas as categorias</Opt></select>
        <select className={SELECT}><Opt>Todos</Opt></select>
      </div>
      <Table
        headers={['Modelo', 'Fases recomendadas', 'Passos', 'Status', 'Usado em', 'Ações']}
        empty={'Nenhum modelo. Clique em “+ Novo modelo de workflow”.'}
      />
    </div>
  )
}

/* ------------------- Modelos Internos de Fase (imtemplates) ----------------- */
export function IMTemplatesTab() {
  const [q, setQ] = useState('')
  return (
    <div>
      <div className="mb-1.5 text-xs text-white/50">
        Biblioteca mestre de modos internos reutilizáveis. Cadastre aqui variações como Judicial,
        Administrativa, Mista ou Não necessária, que depois serão aplicadas dentro das fases dos Processos
        de Nacionalidade.
      </div>
      <Section
        title="Modelos Internos de Fase"
        action={<button className={BTN_PRIMARY}>+ Novo modelo interno</button>}
      />
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar modo..." className={`${INPUT} min-w-[160px]`} />
        <select className={SELECT}><Opt>Todas as categorias</Opt></select>
        <select className={SELECT}><Opt>Todos</Opt></select>
      </div>
      <Table
        headers={['Modelo', 'Chave', 'Fases recomendadas', 'Impacto', 'Status', 'Usado em', 'Ações']}
        empty={'Nenhum modelo. Clique em “+ Novo modelo interno”.'}
      />
    </div>
  )
}

/* --------------------- Modelos de Automação (amtemplates) ------------------- */
export function AMTemplatesTab() {
  const [q, setQ] = useState('')
  return (
    <div>
      <div className="mb-1.5 text-xs text-white/50">
        Biblioteca mestre de modelos de automação reutilizáveis. Cadastre aqui os modelos que depois serão
        aplicados nas fases dos Processos de Nacionalidade.
      </div>
      <Section
        title="Modelos de Automação"
        action={<button className={BTN_PRIMARY}>+ Novo modelo de automação</button>}
      />
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar modelo..." className={`${INPUT} min-w-[150px]`} />
        <select className={SELECT}><Opt>Todos os tipos</Opt></select>
        <select className={SELECT}><Opt>Todas as categorias</Opt></select>
        <select className={SELECT}><Opt>Todos</Opt></select>
      </div>
      <Table
        headers={['Modelo', 'Tipo', 'Fases recomendadas', 'Gatilho', 'Ação', 'Status', 'Usado em', 'Ações']}
        empty={'Nenhum modelo. Clique em “+ Novo modelo de automação”.'}
      />
    </div>
  )
}
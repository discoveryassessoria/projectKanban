'use client'

// src/components/gerenciamentoComponents/GerenciamentoScaffolds2.tsx
// Lote 2 de telas do Gerenciamento (tema escuro), portadas do mockup Operacional v4:
//   - ProcTypesTab    (proctypes)   Processos de Nacionalidade
//   - MacroKanbanTab  (macrokanban) Workflow Macro / Kanban
//   - HealthTab       (health)      Diagnóstico Executivo do Gerenciamento
// SCAFFOLD: estrutura/colunas/KPIs fiéis; dados e CRUD ligados no wiring.

import { useState } from 'react'

const CARD = 'rounded-xl border border-white/10 bg-white/5 backdrop-blur'
const BTN_PRIMARY =
  'rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500'
const SELECT =
  'rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white outline-none focus:border-white/20'

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

/* ------------------- Processos de Nacionalidade (proctypes) ------------------ */
export function ProcTypesTab() {
  return (
    <div>
      <div className="mb-3 text-xs text-white/50">
        A unidade-mestre do sistema. Cada Processo de Nacionalidade tem Workflow Macro próprio, Kanban
        derivado, fases, automações, documentos, financeiro e protocolos. Não se cadastra país + tipo soltos.
      </div>
      <Section
        title="Processos de Nacionalidade"
        action={<button className={BTN_PRIMARY}>+ Novo Processo de Nacionalidade</button>}
      />
      <Table
        headers={[
          'Código', 'Processo de Nacionalidade', 'País', 'Modalidade', 'Workflow Macro',
          'Kanban', 'Fases', 'Docs', 'Financ.', 'Protoc.', 'Saúde', 'Ações',
        ]}
      />
    </div>
  )
}

/* --------------------- Workflow Macro / Kanban (macrokanban) ----------------- */
export function MacroKanbanTab() {
  const [pt, setPt] = useState('')
  return (
    <div>
      <div className="mb-3 text-xs text-white/50">
        O Workflow Macro define a sequência real de fases do Processo de Nacionalidade. O Kanban é derivado
        automaticamente dessa sequência. Não existe cadastro de fases separado.
      </div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-white">Workflow Macro / Kanban</h2>
        <select value={pt} onChange={(e) => setPt(e.target.value)} className={SELECT}>
          <option value="" className="bg-zinc-900">— escolha um Processo de Nacionalidade —</option>
        </select>
      </div>
      <div className={`${CARD} p-5 text-sm text-white/40`}>
        Escolha um Processo de Nacionalidade para configurar seu Workflow Macro. O Kanban é derivado
        automaticamente.
      </div>
    </div>
  )
}

/* ------------------- Diagnóstico Executivo (health) ------------------------- */
function Kpi({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div className={`${CARD} p-3 text-center`}>
      <div className="text-2xl font-bold" style={{ color: color || '#e8ebf2' }}>
        {value}
      </div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-white/50">{label}</div>
    </div>
  )
}
export function HealthTab() {
  return (
    <div>
      <div className="mb-3 text-xs text-white/50">
        Auditoria executiva do Gerenciamento: Processo de Nacionalidade, Workflow Macro, Kanban derivado,
        Workflow Interno, automações e taxonomia.
      </div>
      <Section
        title="Diagnóstico Executivo do Gerenciamento"
        action={<button className={BTN_PRIMARY}>Rodar Auditoria</button>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi value="—" label="Score" />
        <Kpi value="0" label="Erros críticos" color="#4ade80" />
        <Kpi value="0" label="Alertas" color="#fbbf24" />
        <Kpi value="—" label="Pronto" />
      </div>
      <div className={`${CARD} p-5 text-sm font-medium text-green-300`}>
        ✅ Nenhum problema estrutural no Gerenciamento.
      </div>
    </div>
  )
}
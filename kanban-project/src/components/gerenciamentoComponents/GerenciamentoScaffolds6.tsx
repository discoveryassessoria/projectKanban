'use client'

// src/components/gerenciamentoComponents/GerenciamentoScaffolds6.tsx
// Lote 6 — telas que faltavam vs mockup v4 (tema escuro):
//   Cadastros do Motor: RoleCatalogTab(rolecat), PermProfilesTab(permprofiles),
//     PricingTableTab(pricingtable), DocMatrixTab(docmatrix),
//     ConfigVersionsTab(cfgversions), ConfigDiagnosisTab(cfgdiagnosis)
//   Saúde do Sistema: ExecMatrixTab(execmatrix), SystemHealthTab(syshealth)
// SCAFFOLD: estrutura/colunas/KPIs fiéis; dados e CRUD no wiring.

import { useState } from 'react'

const CARD = 'rounded-xl border border-white/10 bg-white/5 backdrop-blur'
const BTN_PRIMARY =
  'rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500'
const BTN_GHOST =
  'rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/10'
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
              <th key={i} className={`whitespace-nowrap border-b border-white/10 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white/50 ${i === headers.length - 1 ? 'text-right' : 'text-left'}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr><td colSpan={headers.length} className="px-3 py-6 text-center text-xs text-white/40">{empty}</td></tr>
        </tbody>
      </table>
    </div>
  )
}
function PickProcess({ title, desc, empty }: { title: string; desc: string; empty: string }) {
  const [pt, setPt] = useState('')
  return (
    <div>
      <div className="mb-3 text-xs text-white/50">{desc}</div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-white">{title}</h2>
        <select value={pt} onChange={(e) => setPt(e.target.value)} className={SELECT}>
          <option value="" className="bg-zinc-900">— Processo de Nacionalidade —</option>
        </select>
      </div>
      <div className={`${CARD} p-5 text-sm text-white/40`}>{empty}</div>
    </div>
  )
}
function Kpi({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div className={`${CARD} p-3 text-center`}>
      <div className="text-2xl font-bold" style={{ color: color || '#e8ebf2' }}>{value}</div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-white/50">{label}</div>
    </div>
  )
}

/* -------- Painel Executivo de Configuração (execmatrix) -------- */
export function ExecMatrixTab() {
  return (
    <div>
      <div className="mb-3 text-xs text-white/50">
        Cada tipo real de processo e o status de sua configuração (workflow, kanban, documentos, protocolos,
        financeiro, tarefas, automações, SLA). Retificação não aparece aqui — é fase.
      </div>
      <Section title="Painel Executivo de Configuração" action={<button className={BTN_PRIMARY}>Rodar Auditoria</button>} />
      <Table
        headers={['Nacionalidade', 'Tipo', 'Workflow', 'Kanban', 'Docs', 'Protoc.', 'Financ.', 'Tarefas', 'Autom.', 'SLA', 'Status', 'Ações']}
        empty="Nenhum tipo de processo configurado ainda."
      />
    </div>
  )
}

/* -------- Saúde do Sistema / Taxonomia (syshealth) -------- */
export function SystemHealthTab() {
  return (
    <div>
      <div className="mb-3 text-xs text-white/50">
        Auditoria executiva de classificação, contexto, workflows, kanbans, documentos, protocolos,
        financeiro e retificação.
      </div>
      <Section title="Saúde do Sistema" action={<button className={BTN_PRIMARY}>Rodar Auditoria Executiva</button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi value="—" label="Score geral" />
        <Kpi value="0" label="Erros críticos" color="#4ade80" />
        <Kpi value="0" label="Alertas" color="#fbbf24" />
        <Kpi value="0/0" label="Tipos prontos" color="#60a5fa" />
        <Kpi value="0" label="Tipos incompletos" color="#4ade80" />
        <Kpi value="0" label="Regras sem contexto" color="#4ade80" />
        <Kpi value="0" label="Recomendações" />
        <Kpi value="—" label="Pronto p/ protótipo" />
      </div>
      <div className={`${CARD} p-5 text-sm font-medium text-green-300`}>✅ Nenhum problema estrutural detectado.</div>
    </div>
  )
}

/* -------- Tabela de Valores (pricingtable) -------- */
export function PricingTableTab() {
  return (
    <div>
      <div className="mb-1.5 text-xs text-white/50">
        Parametrize valores por Processo de Nacionalidade, fase, produto/serviço, país, modalidade e
        fornecedor. As automações financeiras puxam o valor daqui em vez de usar número fixo.
      </div>
      <Section title="Tabela de Valores" action={<button className={BTN_PRIMARY}>+ Novo valor</button>} />
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <input placeholder="Buscar regra..." className={`${INPUT} min-w-[160px]`} readOnly />
        <select className={SELECT}><option className="bg-zinc-900">Todos</option></select>
      </div>
      <Table
        headers={['Regra de valor', 'Produto/Serviço', 'Fase', 'Valor', 'Status', 'Usado em', 'Ações']}
        empty={'Nenhuma regra de valor. Clique em “+ Novo valor”.'}
      />
    </div>
  )
}

/* -------- Papéis e Responsáveis (rolecat) -------- */
export function RoleCatalogTab() {
  const [q, setQ] = useState('')
  return (
    <div>
      <div className="mb-1.5 text-xs text-white/50">
        Papéis operacionais usados em tarefas, workflows, automações, SLAs e notificações. As automações de
        tarefa puxam o responsável daqui.
      </div>
      <Section title="Papéis e Responsáveis" action={<button className={BTN_PRIMARY}>+ Novo papel</button>} />
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar papel..." className={`${INPUT} min-w-[160px]`} />
        <select className={SELECT}><option className="bg-zinc-900">Todos</option></select>
      </div>
      <Table
        headers={['Papel', 'Chave', 'Área', 'Status', 'Usado em', 'Ações']}
        empty={'Nenhum papel. Clique em “+ Novo papel”.'}
      />
    </div>
  )
}

/* -------- Usuários e Permissões (permprofiles) -------- */
export function PermProfilesTab() {
  return (
    <div>
      <div className="mb-1.5 text-xs text-white/50">
        Perfis de permissão para ações críticas do Gerenciamento. Marque por checkbox o que cada perfil pode fazer.
      </div>
      <Section title="Usuários e Permissões" action={<button className={BTN_PRIMARY}>+ Novo perfil</button>} />
      <Table
        headers={['Perfil', 'Permissões', 'Status', 'Usado em', 'Ações']}
        empty="Nenhum perfil cadastrado."
      />
    </div>
  )
}

/* -------- Matriz Documental (docmatrix) -------- */
export function DocMatrixTab() {
  return (
    <PickProcess
      title="Matriz Documental"
      desc="Configure quais documentos são exigidos por processo, fase, alvo (linha reta, requerente, cônjuge…) e regra de geração. Define se cria tarefa/custo/receita e se bloqueia a conclusão da fase."
      empty="Escolha um Processo de Nacionalidade para configurar a matriz documental."
    />
  )
}

/* -------- Versionamento e Publicação (cfgversions) -------- */
export function ConfigVersionsTab() {
  return (
    <PickProcess
      title="Versionamento e Publicação"
      desc="Controle de versões da configuração. Impede que rascunhos sejam usados por processos reais: processo novo só usa configuração publicada; processo antigo mantém o snapshot da versão que usou."
      empty="Escolha um Processo de Nacionalidade para ver e publicar versões da configuração."
    />
  )
}

/* -------- Diagnóstico de Configuração (cfgdiagnosis) -------- */
export function ConfigDiagnosisTab() {
  return (
    <PickProcess
      title="Diagnóstico de Configuração"
      desc="Mostra se um Processo de Nacionalidade está pronto para uso: workflow, fases, automações, cadastros de apoio e configuração publicada."
      empty="Escolha um Processo de Nacionalidade para diagnosticar a configuração."
    />
  )
}
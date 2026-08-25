'use client'

// src/components/gerenciamentoComponents/GerenciamentoScaffolds.tsx
// 12 telas "bespoke" do Gerenciamento, portadas do mockup Operacional (tema escuro).
// SCAFFOLD: cabeçalho, colunas e formulários fiéis ao mockup; a LISTAGEM (dados) e o
// CRIAR/EDITAR serão ligados ao banco na etapa de wiring (tabelas abrem vazias).
//
// Cada componente é exportado nomeado e registrado no mapa TELAS da page.tsx.

import { useState } from 'react'
import { Inbox } from 'lucide-react'
import { AvisoRascunho, TITULO_RASCUNHO, BTN_RASCUNHO } from './_RascunhoUI'

/* ----------------------------- helpers de UI ----------------------------- */

const CARD = 'rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur'
const BTN_PRIMARY =
  'rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500'
const BTN_GHOST =
  'rounded-lg border border-[var(--border-default)] px-3 py-1.5 text-xs font-medium text-white/70 transition hover:bg-[var(--surface-hover)] hover:text-white'
const INPUT =
  'w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-[13px] text-white outline-none focus:border-white/20'

function Section({
  title,
  desc,
  action,
}: {
  title: string
  desc?: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-3">
      {desc && <div className="mb-3 text-xs text-[var(--text-secondary)]">{desc}</div>}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-white">{title}</h2>
        {action}
      </div>
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
                className={`border-b border-[var(--border-default)] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] ${
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
            <td colSpan={headers.length} className="px-4 py-10">
              <div className="mx-auto flex max-w-sm flex-col items-center text-center">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--surface-primary)]">
                  <Inbox className="h-5 w-5 text-[var(--text-secondary)]" />
                </div>
                <div className="text-sm font-semibold text-white/85">Nenhum item cadastrado</div>
                <div className="mt-1 text-[13px] text-[var(--text-secondary)]">
                  {empty || 'Cadastre o primeiro item para começar — use “+ Novo” acima.'}
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------ 1. Equipes ------------------------------- */
export function TeamsTab() {
  return (
    <div>
      <AvisoRascunho />
      <Section title="Equipes" action={<button disabled title={TITULO_RASCUNHO} className={BTN_RASCUNHO}>+ Nova Equipe</button>} />
      <Table headers={['Equipe', 'Membros', 'Status', 'Ações']} />
    </div>
  )
}

/* ----------------------- 2. Automações Financeiras ----------------------- */
export function FinAutomationsTab() {
  return (
    <div>
      <AvisoRascunho />
      <Section
        title="Automações Financeiras"
        action={<button disabled title={TITULO_RASCUNHO} className={BTN_RASCUNHO}>+ Nova Automação</button>}
      />
      <Table headers={['Nome', 'Gatilho', 'Fase', 'Valor', 'Ação', 'Status', 'Última exec.', 'Ações']} />
    </div>
  )
}

/* ---------------------- 3. Automações Operacionais ----------------------- */
export function OpAutomationsTab() {
  return (
    <div>
      <AvisoRascunho />
      <Section
        title="Automações Operacionais"
        action={<button disabled title={TITULO_RASCUNHO} className={BTN_RASCUNHO}>+ Nova Automação</button>}
      />
      <Table headers={['Nome', 'Gatilho', 'Ação', 'Status', 'Última exec.', 'Ações']} />
    </div>
  )
}

/* ------------------------- 4. Produtos e Serviços ------------------------ */
export function ProductsTab() {
  return (
    <div>
      <AvisoRascunho />
      <Section title="Produtos e Serviços" action={<button disabled title={TITULO_RASCUNHO} className={BTN_RASCUNHO}>+ Novo Serviço</button>} />
      <Table headers={['Código', 'Nome', 'Categoria', 'Nacionalidade', 'Status', 'Ações']} />
    </div>
  )
}

/* --------------------- 5. (vago) --------------------------------------------
   O rascunho "Regras de Protocolo por Nacionalidade" foi ELIMINADO em 02/08/2026:
   protocolo não é cadastro nem regra global — é uma OCORRÊNCIA operacional
   registrada dentro do Processo (aba Protocolos), que alimenta a Timeline e o
   Histórico. Os órgãos que recebem protocolo vivem em Órgãos e Organizações.
   -------------------------------------------------------------------------- */

/* ----------------------------- 6. SLA e Prazos --------------------------- */
export function SLATab() {
  return (
    <div>
      <AvisoRascunho />
      <Section title="SLA e Prazos" action={<button disabled title={TITULO_RASCUNHO} className={BTN_RASCUNHO}>+ Nova Regra</button>} />
      <Table headers={['Nome', 'Entidade', 'Gatilho', 'Prazo', 'Alertar antes', 'Severidade', 'Ações']} />
    </div>
  )
}

/* ------------------------------- 7. Modelos ------------------------------ */
export function TemplatesTab() {
  return (
    <div>
      <AvisoRascunho />
      <Section title="Modelos" action={<button disabled title={TITULO_RASCUNHO} className={BTN_RASCUNHO}>+ Novo Modelo</button>} />
      <Table headers={['Nome', 'Tipo', 'Categoria', 'Variáveis', 'Status', 'Ações']} />
    </div>
  )
}

/* ----------------------------- 8. Notificações --------------------------- */
export function NotificationsTab() {
  return (
    <div>
      <AvisoRascunho />
      <Section title="Notificações" action={<button disabled title={TITULO_RASCUNHO} className={BTN_RASCUNHO}>+ Nova Notificação</button>} />
      <Table headers={['Nome', 'Gatilho', 'Entidade', 'Canais', 'Destinatários', 'Status', 'Ações']} />
    </div>
  )
}

/* --------------------------- 9. Auditoria Global ------------------------- */
export function AuditTab() {
  return (
    <div>
      <AvisoRascunho />
      <Section title="Auditoria Global" action={<button disabled title={TITULO_RASCUNHO} className={BTN_RASCUNHO}>Exportar CSV</button>} />
      <Table headers={['Data', 'Usuário', 'Módulo', 'Entidade', 'Ação', 'Detalhes']} empty="Nenhum registro de auditoria." />
    </div>
  )
}

/* ----------------------- 10. Importação / Exportação --------------------- */
const EXPORT_SCOPES = [
  'Tudo', 'Usuários', 'Papéis', 'Tabela de Valores', 'Honorários',
  'Autom. Financeiras', 'Autom. Operacionais', 'Workflows', 'Modelos',
]
export function ImportExportTab() {
  const [json, setJson] = useState('')
  return (
    <div>
      <AvisoRascunho />
      <Section title="Importação / Exportação" />
      <div className={`mb-3 ${CARD} p-4`}>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">Exportar (JSON)</div>
        <div className="flex flex-wrap gap-2">
          {EXPORT_SCOPES.map((s) => (
            <button key={s} disabled title={TITULO_RASCUNHO} className={BTN_RASCUNHO}>{s}</button>
          ))}
        </div>
      </div>
      <div className={`${CARD} p-4`}>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">Importar (JSON)</div>
        <textarea
          rows={6}
          value={json}
          onChange={(e) => setJson(e.target.value)}
          placeholder="Cole o JSON de configurações..."
          className={`${INPUT} font-mono`}
        />
        <div className="mt-3">
          <button disabled title={TITULO_RASCUNHO} className={BTN_RASCUNHO}>Validar e importar</button>
        </div>
      </div>
    </div>
  )
}

/* --------------------------- 11. Backup / Restore ------------------------ */
export function BackupTab() {
  const [json, setJson] = useState('')
  return (
    <div>
      <AvisoRascunho />
      <Section title="Backup / Restauração" action={<button disabled title={TITULO_RASCUNHO} className={BTN_RASCUNHO}>Baixar Backup Completo</button>} />
      <div className={`mb-3 ${CARD} p-4 text-xs text-[var(--text-secondary)]`}>
        O backup inclui processos, pessoas, financeiro, protocolos, gerenciamento e configurações. Antes de
        restaurar, um backup automático é criado.
      </div>
      <div className={`mb-3 ${CARD} p-4`}>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">Restaurar</div>
        <textarea
          rows={5}
          value={json}
          onChange={(e) => setJson(e.target.value)}
          placeholder="Cole o JSON do backup..."
          className={`${INPUT} font-mono`}
        />
        <div className="mt-3">
          <button disabled title={TITULO_RASCUNHO} className={BTN_RASCUNHO}>Validar e restaurar</button>
        </div>
      </div>
      <Section title="Histórico de backups" />
      <Table headers={['Data', 'Tamanho']} empty="Nenhum backup ainda." />
    </div>
  )
}

/* ------------------------- 12. Configurações Gerais ---------------------- */
const TOGGLES: [string, string][] = [
  ['audit', 'Auditoria ativa'],
  ['notifications', 'Notificações ativas'],
  ['finAuto', 'Automação financeira ativa'],
  ['opAuto', 'Automação operacional ativa'],
  ['strictPhase', 'Bloqueio estrito de fases'],
]
export function SettingsTab() {
  const [cfg, setCfg] = useState<Record<string, any>>({
    company: '', currency: 'EUR', lang: 'pt-BR', tz: '',
    audit: true, notifications: true, finAuto: true, opAuto: true, strictPhase: false,
  })
  const set = (k: string, v: any) => setCfg((c) => ({ ...c, [k]: v }))
  return (
    <div>
      <AvisoRascunho />
      <Section title="Configurações Gerais" action={<button disabled title={TITULO_RASCUNHO} className={BTN_RASCUNHO}>Salvar</button>} />
      <div className={`${CARD} grid grid-cols-1 gap-3 p-4 sm:grid-cols-2`}>
        <div>
          <label className="mb-1 block text-[11px] text-[var(--text-secondary)]">Empresa</label>
          <input className={INPUT} value={cfg.company} onChange={(e) => set('company', e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-[var(--text-secondary)]">Moeda padrão</label>
          <select className={INPUT} value={cfg.currency} onChange={(e) => set('currency', e.target.value)}>
            {['EUR', 'BRL', 'USD'].map((x) => (
              <option key={x} value={x} className="bg-zinc-900">{x}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-[var(--text-secondary)]">Idioma</label>
          <input className={INPUT} value={cfg.lang} onChange={(e) => set('lang', e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-[var(--text-secondary)]">Fuso</label>
          <input className={INPUT} value={cfg.tz} onChange={(e) => set('tz', e.target.value)} />
        </div>
        <div className="border-t border-[var(--border-default)] pt-3 sm:col-span-2">
          {TOGGLES.map(([k, label]) => (
            <label key={k} className="flex cursor-pointer items-center gap-2 py-1.5 text-[12.5px] text-white/80">
              <input type="checkbox" checked={!!cfg[k]} onChange={(e) => set(k, e.target.checked)} className="h-3.5 w-3.5 accent-blue-500" />
              {label}
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}
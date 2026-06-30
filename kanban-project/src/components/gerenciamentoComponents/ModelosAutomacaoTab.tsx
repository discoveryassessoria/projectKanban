'use client'

// src/components/gerenciamentoComponents/ModelosAutomacaoTab.tsx
// FASE 2C do Motor — Biblioteca "Modelos de Automação" (amtemplates).
// É a "semente" do motor executor (Fase 4). Tabela única; cada automação tem
// tipo, gatilho (quando), ação (o quê), condições (só do seed, não editável aqui) e parâmetros.
// Backend: /api/gerenciamento/modelos-automacao (GET/POST) + /[id] (PUT/DELETE)
// ⚠ "Aplicar em fase" é placeholder (vira real na Fase 3).
// Visual segue o padrão do app (TipoProcessoTab): modal bg-zinc-900/95, options bg-zinc-900.

import { useState, useEffect, useMemo, useCallback } from 'react'

type Fase = { phaseKey: string; label: string }

type Modelo = {
  id: number
  name: string
  description: string | null
  type: string
  category: string | null
  recommendedPhases: string[] | null
  scope: string
  trigger: string | null
  action: string | null
  conditions: any
  defaultParams: any
  idempotencyPattern: string
  isSystemTemplate: boolean
  usedByCount: number
  arquivado: boolean
}

const TYPE_LABELS: Record<string, string> = {
  task: 'Tarefa automática',
  financial: 'Financeiro automático',
  document: 'Documento',
  event: 'Evento / Agenda',
  protocol: 'Protocolo',
  phase_transition: 'Avanço de fase',
  alert: 'Alerta',
}

const TRIGGER_LABELS: Record<string, string> = {
  phase_entered: 'Quando a fase iniciar',
  phase_exited: 'Quando a fase terminar',
  step_completed: 'Quando um passo for concluído',
  document_validated: 'Quando um documento for validado',
  divergence_detected: 'Quando uma divergência for detectada',
  rectification_marked: 'Quando a retificação for marcada',
  protocol_created: 'Quando o protocolo for criado',
  deadline_due: 'Quando um prazo vencer',
  person_added: 'Quando uma pessoa for adicionada',
  manual: 'Manualmente',
  line_person_created: 'Quando pessoa da linha reta for criada',
  document_marked_required: 'Quando documento for marcado como necessário',
  document_marked_not_required: 'Quando documento for marcado como desnecessário',
  all_required_documents_located: 'Quando todos os documentos necessários forem localizados',
  certificate_requested: 'Quando uma certidão for solicitada',
  certificate_received: 'Quando uma certidão for recebida',
  all_certificates_validated: 'Quando todas as certidões forem validadas',
  analysis_requires_rectification: 'Quando a análise concluir que precisa de retificação',
  analysis_no_rectification_required: 'Quando a análise concluir que não precisa de retificação',
  rectification_mode_selected: 'Quando o modo de retificação for escolhido',
  rectification_completed: 'Quando a retificação for concluída',
  rectified_certificate_received: 'Quando a certidão retificada for recebida',
  all_rectified_certificates_validated: 'Quando todas as certidões retificadas forem validadas',
  translation_package_ready: 'Quando o pacote de tradução estiver pronto',
  translation_received: 'Quando a tradução for recebida',
  all_translations_validated: 'Quando todas as traduções forem validadas',
  apostille_package_ready: 'Quando o pacote de apostilamento estiver pronto',
  apostille_received: 'Quando as apostilas forem recebidas',
  all_apostilles_validated: 'Quando o apostilamento for validado',
  protocol_window_expected: 'Quando houver janela/agendamento de protocolo',
  requirement_received: 'Quando uma exigência for recebida',
  requirement_deadline_set: 'Quando um prazo de exigência for definido',
  final_decision_registered: 'Quando a decisão final for registrada',
  process_closure_validated: 'Quando o encerramento for validado',
}

const ACTION_LABELS: Record<string, string> = {
  create_document_tasks: 'Criar tarefas documentais',
  create_or_reactivate_document_search_task: 'Criar/reativar tarefa de busca',
  suspend_document_task: 'Suspender tarefa do documento',
  unlock_next_phase: 'Liberar próxima fase',
  create_issuance_tasks_for_required_documents: 'Criar tarefas de emissão',
  create_registry_follow_up: 'Criar acompanhamento de cartório',
  create_certificate_review_task: 'Criar tarefa de conferência',
  create_document_analysis_task: 'Criar tarefa de análise',
  create_divergence_issue: 'Criar ocorrência de divergência',
  unlock_rectification_phase: 'Liberar Retificação',
  skip_rectification_and_rectified_issuance: 'Pular Retificação',
  create_tasks_by_rectification_mode: 'Criar tarefas pelo modo de retificação',
  create_legal_task: 'Criar tarefa jurídica',
  create_registry_rectification_task: 'Criar tarefa de cartório',
  skip_phase: 'Pular fase',
  unlock_rectified_issuance_phase: 'Liberar Emissão Retificada',
  create_rectified_issuance_tasks: 'Criar tarefas de emissão retificada',
  create_rectified_certificate_review_task: 'Criar conferência da certidão retificada',
  create_translation_package_task: 'Criar tarefa de pacote de tradução',
  create_send_to_translator_task: 'Criar tarefa de envio ao tradutor',
  create_translation_review_task: 'Criar conferência de tradução',
  unlock_apostille_phase: 'Liberar Apostilamento',
  create_apostille_package_task: 'Criar tarefa de pacote de apostilamento',
  create_send_to_apostille_task: 'Criar tarefa de envio para apostilamento',
  create_apostille_review_task: 'Criar conferência de apostilas',
  unlock_protocol_phase: 'Liberar Protocolo',
  create_dossier_review_task: 'Criar tarefa de revisar dossiê',
  create_protocol_window_alert: 'Criar alerta de janela/agendamento',
  unlock_protocolled_phase: 'Liberar Protocolado',
  create_protocol_follow_up: 'Criar acompanhamento de protocolo',
  create_requirement_response_task: 'Criar tarefa de resposta a exigência',
  create_deadline_alert: 'Criar alerta de prazo',
  unlock_finished_phase: 'Liberar Finalizado',
  create_closing_task: 'Criar tarefa de encerramento',
  create_financial_pending_review_task: 'Criar conferência de pendências financeiras',
  archive_completed_process: 'Arquivar processo concluído',
  create_issuance_revenue: 'Criar receita',
  create_cost: 'Criar custo',
  create_revenue: 'Criar receita',
}

async function jsonFetch(url: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as any)?.error || `Erro ${res.status}`)
  return data
}

const BASE = '/api/gerenciamento/modelos-automacao'

function novoForm() {
  return {
    name: '',
    description: '',
    type: 'task',
    category: '',
    recommendedPhases: [] as string[],
    trigger: 'phase_entered',
    action: '',
    priority: 'medium',
    slaDays: 3,
    status: 'active' as 'active' | 'archived',
    scope: 'phase',
    idempotencyPattern: 'processId+phaseKey',
    responsibleRole: '',
    financialType: '',
  }
}

// Ícones compactos (SVG inline, sem dependência) para os botões de ação da tabela
const icoCls = 'h-4 w-4'
const IcoEdit = () => (
  <svg className={icoCls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
)
const IcoCopy = () => (
  <svg className={icoCls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
)
const IcoApply = () => (
  <svg className={icoCls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>
)
const IcoArchive = () => (
  <svg className={icoCls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="5" rx="1" /><path d="M4 8v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8" /><path d="M10 12h4" /></svg>
)
const IcoRestore = () => (
  <svg className={icoCls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6" /><path d="M3 13a9 9 0 1 0 3-7.7L3 8" /></svg>
)
const IcoTrash = () => (
  <svg className={icoCls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
)

export default function ModelosAutomacaoTab() {
  const [modelos, setModelos] = useState<Modelo[]>([])
  const [fases, setFases] = useState<Fase[]>([])
  const [loading, setLoading] = useState(true)
  const [erroCarregar, setErroCarregar] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState('')
  const [info, setInfo] = useState('')

  const [busca, setBusca] = useState('')
  const [fType, setFType] = useState('')
  const [fCat, setFCat] = useState('')
  const [fStatus, setFStatus] = useState<'' | 'active' | 'archived'>('')

  const [modalAberto, setModalAberto] = useState(false)
  const [editModelo, setEditModelo] = useState<Modelo | null>(null)
  const [form, setForm] = useState(novoForm())
  const [erroModal, setErroModal] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    setLoading(true)
    setErroCarregar(null)
    try {
      const d = await jsonFetch(BASE, { cache: 'no-store' })
      setModelos((d as any).modelos || [])
      setFases((d as any).catalogoFases || [])
    } catch (e: any) {
      setErroCarregar(e.message || 'Não foi possível carregar os modelos de automação.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  function flashSucesso(msg: string) {
    setSucesso(msg)
    setInfo('')
    setTimeout(() => setSucesso(''), 3500)
  }
  function flashInfo(msg: string) {
    setInfo(msg)
    setSucesso('')
    setTimeout(() => setInfo(''), 4000)
  }

  const faseLabel = useCallback((key: string) => fases.find((f) => f.phaseKey === key)?.label || key, [fases])

  const filtrados = useMemo(() => {
    let arr = modelos
    if (fStatus === 'active') arr = arr.filter((m) => !m.arquivado)
    else if (fStatus === 'archived') arr = arr.filter((m) => m.arquivado)
    if (fType) arr = arr.filter((m) => m.type === fType)
    if (fCat) arr = arr.filter((m) => m.category === fCat || (m.recommendedPhases || []).includes(fCat))
    const q = busca.trim().toLowerCase()
    if (q) arr = arr.filter((m) => ((m.name || '') + ' ' + (m.description || '')).toLowerCase().includes(q))
    return arr
  }, [modelos, fStatus, fType, fCat, busca])

  function abrirNovo() {
    setEditModelo(null)
    setForm(novoForm())
    setErroModal(null)
    setModalAberto(true)
  }
  function abrirEditar(m: Modelo) {
    setEditModelo(m)
    const dp = m.defaultParams || {}
    setForm({
      name: m.name,
      description: m.description || '',
      type: m.type || 'task',
      category: m.category || '',
      recommendedPhases: m.recommendedPhases || [],
      trigger: m.trigger || 'phase_entered',
      action: m.action || '',
      priority: dp.priority || 'medium',
      slaDays: typeof dp.slaDays === 'number' ? dp.slaDays : 3,
      status: m.arquivado ? 'archived' : 'active',
      scope: m.scope || 'phase',
      idempotencyPattern: m.idempotencyPattern || 'processId+phaseKey',
      responsibleRole: dp.responsibleRole || '',
      financialType: dp.financialType || '',
    })
    setErroModal(null)
    setModalAberto(true)
  }
  function fecharModal() {
    setModalAberto(false)
  }
  function toggleRec(key: string) {
    setForm((f) => ({
      ...f,
      recommendedPhases: f.recommendedPhases.includes(key)
        ? f.recommendedPhases.filter((k) => k !== key)
        : [...f.recommendedPhases, key],
    }))
  }

  async function salvar() {
    if (!form.name.trim()) {
      setErroModal('Dê um nome ao modelo.')
      return
    }
    setSalvando(true)
    setErroModal(null)
    try {
      // preserva checklist e outros params extras do modelo em edição
      const baseParams = (editModelo?.defaultParams && typeof editModelo.defaultParams === 'object') ? editModelo.defaultParams : {}
      const defaultParams: Record<string, any> = {
        ...baseParams,
        responsibleRole: form.responsibleRole,
        priority: form.priority,
        slaDays: Number(form.slaDays) || 0,
      }
      if (form.financialType.trim()) defaultParams.financialType = form.financialType.trim()
      else delete defaultParams.financialType

      const payload = {
        name: form.name.trim(),
        description: form.description || null,
        type: form.type,
        category: form.category || null,
        recommendedPhases: form.recommendedPhases,
        scope: form.scope || 'phase',
        trigger: form.trigger || null,
        action: form.action || null,
        idempotencyPattern: form.idempotencyPattern || 'processId+phaseKey',
        defaultParams,
        arquivado: form.status === 'archived',
      }
      if (editModelo == null) {
        await jsonFetch(BASE, { method: 'POST', body: JSON.stringify(payload) })
      } else {
        await jsonFetch(`${BASE}/${editModelo.id}`, { method: 'PUT', body: JSON.stringify(payload) })
      }
      setModalAberto(false)
      await carregar()
      flashSucesso(editModelo == null ? 'Modelo criado.' : 'Modelo atualizado.')
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function duplicar(m: Modelo) {
    try {
      const dp = (m.defaultParams && typeof m.defaultParams === 'object') ? m.defaultParams : {}
      const payload = {
        name: `${m.name} (cópia)`,
        description: m.description || null,
        type: m.type,
        category: m.category || null,
        recommendedPhases: m.recommendedPhases || [],
        scope: m.scope || 'phase',
        trigger: m.trigger || null,
        action: m.action || null,
        conditions: Array.isArray(m.conditions) ? m.conditions : [],
        idempotencyPattern: m.idempotencyPattern || 'processId+phaseKey',
        defaultParams: dp,
        arquivado: false,
      }
      await jsonFetch(BASE, { method: 'POST', body: JSON.stringify(payload) })
      await carregar()
      flashSucesso('Modelo duplicado.')
    } catch (e: any) {
      alert(e.message || 'Não foi possível duplicar.')
    }
  }

  async function alternarArquivo(m: Modelo) {
    if (!m.arquivado && !confirm('Arquivar este modelo? Ele não poderá ser aplicado em novas fases, mas as automações já aplicadas continuam.')) return
    try {
      await jsonFetch(`${BASE}/${m.id}`, { method: 'PUT', body: JSON.stringify({ arquivado: !m.arquivado }) })
      await carregar()
    } catch (e: any) {
      alert(e.message || 'Não foi possível alterar o status.')
    }
  }

  async function excluir(m: Modelo) {
    if (!confirm(`Excluir definitivamente o modelo "${m.name}"?`)) return
    try {
      await jsonFetch(`${BASE}/${m.id}`, { method: 'DELETE' })
      await carregar()
      flashSucesso('Modelo excluído.')
    } catch (e: any) {
      alert(e.message || 'Não foi possível excluir.')
    }
  }

  function aplicarEmFase() {
    flashInfo('“Aplicar em fase” fica disponível na Fase 3 (aplicação de modelos por fase do processo).')
  }

  const inputCls =
    'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20'
  const labelCls = 'mb-1 block text-xs text-white/60'

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Modelos de Automação</h2>
          <p className="max-w-2xl text-sm text-white/50">
            Biblioteca mestre de modelos de automação reutilizáveis. Cadastre aqui os modelos que depois
            serão aplicados nas fases dos Processos de Nacionalidade.
          </p>
        </div>
        <button
          onClick={abrirNovo}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
        >
          + Novo modelo de automação
        </button>
      </div>

      {/* Banners */}
      {sucesso && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-200">{sucesso}</div>
      )}
      {info && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-200">{info}</div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar modelo..."
          className="min-w-[180px] flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder-white/30 outline-none backdrop-blur focus:border-white/20"
        />
        <select
          value={fType}
          onChange={(e) => setFType(e.target.value)}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-white/20"
        >
          <option value="" className="bg-zinc-900">Todos os tipos</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k} className="bg-zinc-900">{v}</option>
          ))}
        </select>
        <select
          value={fCat}
          onChange={(e) => setFCat(e.target.value)}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-white/20"
        >
          <option value="" className="bg-zinc-900">Todas as fases</option>
          {fases.map((f) => (
            <option key={f.phaseKey} value={f.phaseKey} className="bg-zinc-900">{f.label}</option>
          ))}
        </select>
        <select
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value as any)}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-white/20"
        >
          <option value="" className="bg-zinc-900">Todos</option>
          <option value="active" className="bg-zinc-900">Ativos</option>
          <option value="archived" className="bg-zinc-900">Arquivados</option>
        </select>
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="py-12 text-center text-sm text-white/40">Carregando...</div>
      ) : erroCarregar ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {erroCarregar}
          <button onClick={carregar} className="ml-3 underline hover:text-white">Tentar de novo</button>
        </div>
      ) : filtrados.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 py-12 text-center text-sm text-white/40 backdrop-blur">
          {busca || fType || fCat || fStatus ? 'Nenhum modelo encontrado.' : 'Nenhum modelo ainda. Clique em “+ Novo modelo de automação”.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/5 backdrop-blur">
          <table className="w-full min-w-[940px] text-[13px]">
            <thead>
              <tr className="bg-white/5">
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Modelo</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Tipo</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Fases recomendadas</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Gatilho</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Ação</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Status</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-white/50">Usado em</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((m) => {
                const podeExcluir = (m.usedByCount || 0) === 0
                const phs = (m.recommendedPhases || []).map(faseLabel).join(', ') || (m.category ? faseLabel(m.category) : '—')
                return (
                  <tr key={m.id} className="border-b border-white/5 align-top last:border-0 hover:bg-white/[0.03]">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-white">{m.name}</span>
                        {m.isSystemTemplate && (
                          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/60">padrão</span>
                        )}
                      </div>
                      {m.description && <div className="text-[11px] text-white/40">{m.description}</div>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-md bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-300">{TYPE_LABELS[m.type] || m.type}</span>
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-white/70">{phs}</td>
                    <td className="px-4 py-2.5 text-[11px] text-white/50">{m.trigger ? (TRIGGER_LABELS[m.trigger] || m.trigger) : '—'}</td>
                    <td className="px-4 py-2.5 text-[11px] text-white/50">{m.action ? (ACTION_LABELS[m.action] || m.action) : '—'}</td>
                    <td className="px-4 py-2.5">
                      {m.arquivado ? (
                        <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/50">arquivado</span>
                      ) : (
                        <span className="rounded-md bg-green-500/15 px-2 py-0.5 text-[11px] font-medium text-green-300">ativo</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center text-[12px] text-white/70">{m.usedByCount || 0}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center gap-1">
                          <button onClick={() => abrirEditar(m)} title="Editar" aria-label="Editar" className="rounded-md border border-white/10 p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"><IcoEdit /></button>
                          <button onClick={() => duplicar(m)} title="Duplicar" aria-label="Duplicar" className="rounded-md border border-white/10 p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"><IcoCopy /></button>
                          <button onClick={aplicarEmFase} title="Aplicar em fase (disponível na Fase 3)" aria-label="Aplicar em fase" className="rounded-md border border-white/10 p-1.5 text-white/35 transition hover:bg-white/10 hover:text-white/60"><IcoApply /></button>
                        </div>
                        <div className="flex items-center gap-1">
                          {m.arquivado ? (
                            <button onClick={() => alternarArquivo(m)} title="Reativar" aria-label="Reativar" className="rounded-md border border-white/10 p-1.5 text-green-300/70 transition hover:bg-white/10 hover:text-green-200"><IcoRestore /></button>
                          ) : (
                            <button onClick={() => alternarArquivo(m)} title="Arquivar" aria-label="Arquivar" className="rounded-md border border-white/10 p-1.5 text-amber-300/70 transition hover:bg-white/10 hover:text-amber-200"><IcoArchive /></button>
                          )}
                          {podeExcluir && (
                            <button onClick={() => excluir(m)} title="Excluir" aria-label="Excluir" className="rounded-md border border-red-500/20 p-1.5 text-red-300/70 transition hover:bg-red-500/10 hover:text-red-200"><IcoTrash /></button>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ===== Modal ===== */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <h3 className="text-lg font-semibold text-white">
                {editModelo == null ? 'Novo' : 'Editar'} modelo de automação
              </h3>
              <button onClick={fecharModal} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            <div className="space-y-4 px-6 py-4">
              {erroModal && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{erroModal}</div>
              )}

              <div>
                <label className={labelCls}>Nome do modelo *</label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} />
              </div>

              <div>
                <label className={labelCls}>Descrição</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className={inputCls + ' min-h-[42px]'}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Tipo do modelo</label>
                  <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className={inputCls}>
                    {Object.entries(TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k} className="bg-zinc-900">{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Categoria (fase principal)</label>
                  <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className={inputCls}>
                    <option value="" className="bg-zinc-900">— selecione —</option>
                    {fases.map((f) => (
                      <option key={f.phaseKey} value={f.phaseKey} className="bg-zinc-900">{f.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className={labelCls}>Fases recomendadas</label>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-lg border border-white/10 bg-white/5 p-3">
                  {fases.map((f) => (
                    <label key={f.phaseKey} className="inline-flex items-center gap-1.5 text-[12px] text-white/80">
                      <input
                        type="checkbox"
                        checked={form.recommendedPhases.includes(f.phaseKey)}
                        onChange={() => toggleRec(f.phaseKey)}
                        className="h-3.5 w-3.5 accent-blue-500"
                      />
                      {f.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Quando acontece (gatilho)</label>
                  <select value={form.trigger} onChange={(e) => setForm((f) => ({ ...f, trigger: e.target.value }))} className={inputCls}>
                    {Object.entries(TRIGGER_LABELS).map(([k, v]) => (
                      <option key={k} value={k} className="bg-zinc-900">{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>O que o sistema faz (ação)</label>
                  <select value={form.action} onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))} className={inputCls}>
                    <option value="" className="bg-zinc-900">— selecione —</option>
                    {Object.entries(ACTION_LABELS).map(([k, v]) => (
                      <option key={k} value={k} className="bg-zinc-900">{v}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className={labelCls}>Prioridade padrão</label>
                  <select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} className={inputCls}>
                    <option value="low" className="bg-zinc-900">baixa</option>
                    <option value="medium" className="bg-zinc-900">média</option>
                    <option value="high" className="bg-zinc-900">alta</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>SLA padrão (dias)</label>
                  <input type="number" value={form.slaDays} onChange={(e) => setForm((f) => ({ ...f, slaDays: Number(e.target.value) }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Status</label>
                  <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as 'active' | 'archived' }))} className={inputCls}>
                    <option value="active" className="bg-zinc-900">ativo</option>
                    <option value="archived" className="bg-zinc-900">arquivado</option>
                  </select>
                </div>
              </div>

              <details className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                <summary className="cursor-pointer text-xs text-white/60">Configurações avançadas (escopo, idempotência)</summary>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>Escopo técnico</label>
                    <input value={form.scope} onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Padrão de idempotência</label>
                    <input value={form.idempotencyPattern} onChange={(e) => setForm((f) => ({ ...f, idempotencyPattern: e.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Responsável padrão</label>
                    <input value={form.responsibleRole} onChange={(e) => setForm((f) => ({ ...f, responsibleRole: e.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Tipo financeiro (se financeiro)</label>
                    <input value={form.financialType} onChange={(e) => setForm((f) => ({ ...f, financialType: e.target.value }))} placeholder="revenue / cost" className={inputCls} />
                  </div>
                </div>
              </details>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-white/10 px-6 py-4">
              <button onClick={fecharModal} className="rounded-lg px-4 py-2 text-sm text-white/60 transition hover:text-white">Cancelar</button>
              <button
                onClick={salvar}
                disabled={salvando}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
              >
                {salvando ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
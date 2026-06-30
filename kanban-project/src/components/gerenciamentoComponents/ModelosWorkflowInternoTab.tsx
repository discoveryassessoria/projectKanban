'use client'

// src/components/gerenciamentoComponents/ModelosWorkflowInternoTab.tsx
// FASE 2B do Motor — Biblioteca "Modelos de Workflow Interno" (iwtemplates).
// Template (pai) + passos (filhos). Cada passo gera tarefa, tem responsável,
// prioridade, SLA, condição de conclusão e checklist.
// Backend: /api/gerenciamento/modelos-workflow-interno (GET/POST) + /[id] (PUT/DELETE)
// ⚠ "Aplicar em fase" é placeholder (vira real na Fase 3).
// Visual segue o padrão do app (TipoProcessoTab): modal bg-zinc-900/95, options bg-zinc-900.

import { useState, useEffect, useMemo, useCallback } from 'react'

type Fase = { phaseKey: string; label: string }
type Prioridade = 'low' | 'medium' | 'high'

type Passo = {
  name: string
  description: string
  generatesTask: boolean
  required: boolean
  defaultResponsibleRole: string
  defaultPriority: Prioridade
  defaultSlaDays: number
  completionCondition: string
  checklist: string[]
}

type Modelo = {
  id: number
  name: string
  description: string | null
  category: string | null
  recommendedPhases: string[] | null
  isSystemTemplate: boolean
  usedByCount: number
  arquivado: boolean
  passos: (Passo & { id: number; ordem: number })[]
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

const BASE = '/api/gerenciamento/modelos-workflow-interno'
const PRIO_LABEL: Record<Prioridade, string> = { low: 'baixa', medium: 'média', high: 'alta' }

function passoVazio(): Passo {
  return {
    name: 'Novo passo',
    description: '',
    generatesTask: true,
    required: true,
    defaultResponsibleRole: '',
    defaultPriority: 'medium',
    defaultSlaDays: 3,
    completionCondition: '',
    checklist: [],
  }
}

export default function ModelosWorkflowInternoTab() {
  const [modelos, setModelos] = useState<Modelo[]>([])
  const [fases, setFases] = useState<Fase[]>([])
  const [loading, setLoading] = useState(true)
  const [erroCarregar, setErroCarregar] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState('')
  const [info, setInfo] = useState('')

  const [busca, setBusca] = useState('')
  const [fCat, setFCat] = useState('')
  const [fStatus, setFStatus] = useState<'' | 'active' | 'archived'>('')

  // modal do template
  const [modalAberto, setModalAberto] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({
    name: '',
    description: '',
    category: '',
    status: 'active' as 'active' | 'archived',
    recommendedPhases: [] as string[],
  })
  const [draftSteps, setDraftSteps] = useState<Passo[]>([])
  const [erroModal, setErroModal] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // modal do passo (sobre o do template)
  const [passoModalAberto, setPassoModalAberto] = useState(false)
  const [passoIdx, setPassoIdx] = useState<number | null>(null)
  const [passoForm, setPassoForm] = useState<Passo & { checklistText: string }>({
    ...passoVazio(),
    checklistText: '',
  })

  const carregar = useCallback(async () => {
    setLoading(true)
    setErroCarregar(null)
    try {
      const d = await jsonFetch(BASE, { cache: 'no-store' })
      setModelos((d as any).modelos || [])
      setFases((d as any).catalogoFases || [])
    } catch (e: any) {
      setErroCarregar(e.message || 'Não foi possível carregar os modelos de workflow interno.')
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

  const faseLabel = useCallback(
    (key: string) => fases.find((f) => f.phaseKey === key)?.label || key,
    [fases],
  )

  const filtrados = useMemo(() => {
    let arr = modelos
    if (fStatus === 'active') arr = arr.filter((m) => !m.arquivado)
    else if (fStatus === 'archived') arr = arr.filter((m) => m.arquivado)
    if (fCat) arr = arr.filter((m) => m.category === fCat || (m.recommendedPhases || []).includes(fCat))
    const q = busca.trim().toLowerCase()
    if (q) arr = arr.filter((m) => ((m.name || '') + ' ' + (m.description || '')).toLowerCase().includes(q))
    return arr
  }, [modelos, fStatus, fCat, busca])

  // ---- template modal ----
  function abrirNovo() {
    setEditId(null)
    setForm({ name: '', description: '', category: '', status: 'active', recommendedPhases: [] })
    setDraftSteps([])
    setErroModal(null)
    setModalAberto(true)
  }
  function abrirEditar(m: Modelo) {
    setEditId(m.id)
    setForm({
      name: m.name,
      description: m.description || '',
      category: m.category || '',
      status: m.arquivado ? 'archived' : 'active',
      recommendedPhases: m.recommendedPhases || [],
    })
    setDraftSteps(
      (m.passos || []).map((p) => ({
        name: p.name,
        description: p.description || '',
        generatesTask: p.generatesTask !== false,
        required: p.required !== false,
        defaultResponsibleRole: p.defaultResponsibleRole || '',
        defaultPriority: (p.defaultPriority as Prioridade) || 'medium',
        defaultSlaDays: p.defaultSlaDays || 0,
        completionCondition: p.completionCondition || '',
        checklist: Array.isArray(p.checklist) ? p.checklist : [],
      })),
    )
    setErroModal(null)
    setModalAberto(true)
  }
  function fecharModal() {
    setModalAberto(false)
    setPassoModalAberto(false)
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
      const payload = {
        name: form.name.trim(),
        description: form.description || null,
        category: form.category || null,
        recommendedPhases: form.recommendedPhases,
        arquivado: form.status === 'archived',
        steps: draftSteps,
      }
      if (editId == null) {
        await jsonFetch(BASE, { method: 'POST', body: JSON.stringify(payload) })
      } else {
        await jsonFetch(`${BASE}/${editId}`, { method: 'PUT', body: JSON.stringify(payload) })
      }
      setModalAberto(false)
      await carregar()
      flashSucesso(editId == null ? 'Modelo criado.' : 'Modelo atualizado.')
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function duplicar(m: Modelo) {
    try {
      const payload = {
        name: `${m.name} (cópia)`,
        description: m.description || null,
        category: m.category || null,
        recommendedPhases: m.recommendedPhases || [],
        arquivado: false,
        steps: (m.passos || []).map((p) => ({
          name: p.name,
          description: p.description || '',
          generatesTask: p.generatesTask !== false,
          required: p.required !== false,
          defaultResponsibleRole: p.defaultResponsibleRole || '',
          defaultPriority: p.defaultPriority || 'medium',
          defaultSlaDays: p.defaultSlaDays || 0,
          completionCondition: p.completionCondition || '',
          checklist: Array.isArray(p.checklist) ? p.checklist : [],
        })),
      }
      await jsonFetch(BASE, { method: 'POST', body: JSON.stringify(payload) })
      await carregar()
      flashSucesso('Modelo duplicado.')
    } catch (e: any) {
      alert(e.message || 'Não foi possível duplicar.')
    }
  }

  async function alternarArquivo(m: Modelo) {
    if (!m.arquivado && !confirm('Arquivar este modelo? Ele não poderá ser aplicado em novas fases, mas as aplicações existentes continuam.')) return
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

  // ---- step modal ----
  function abrirNovoPasso() {
    const novo = passoVazio()
    const novos = [...draftSteps, novo]
    setDraftSteps(novos)
    abrirEditarPasso(novos.length - 1, novos)
  }
  function abrirEditarPasso(i: number, base?: Passo[]) {
    const arr = base || draftSteps
    const st = arr[i]
    if (!st) return
    setPassoIdx(i)
    setPassoForm({ ...st, checklistText: (st.checklist || []).join('\n') })
    setPassoModalAberto(true)
  }
  function fecharPasso() {
    setPassoModalAberto(false)
    setPassoIdx(null)
  }
  function salvarPasso() {
    if (passoIdx == null) return
    const checklist = passoForm.checklistText
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
    const novo: Passo = {
      name: passoForm.name.trim() || 'Passo',
      description: passoForm.description,
      generatesTask: passoForm.generatesTask,
      required: passoForm.required,
      defaultResponsibleRole: passoForm.defaultResponsibleRole,
      defaultPriority: passoForm.defaultPriority,
      defaultSlaDays: Number(passoForm.defaultSlaDays) || 0,
      completionCondition: passoForm.completionCondition,
      checklist,
    }
    setDraftSteps((arr) => arr.map((s, idx) => (idx === passoIdx ? novo : s)))
    fecharPasso()
  }
  function moverPasso(i: number, dir: -1 | 1) {
    setDraftSteps((arr) => {
      const j = i + dir
      if (j < 0 || j >= arr.length) return arr
      const cp = [...arr]
      ;[cp[i], cp[j]] = [cp[j], cp[i]]
      return cp
    })
  }
  function duplicarPasso(i: number) {
    setDraftSteps((arr) => {
      const c = { ...arr[i], name: `${arr[i].name || 'Passo'} (cópia)`, checklist: [...(arr[i].checklist || [])] }
      const cp = [...arr]
      cp.splice(i + 1, 0, c)
      return cp
    })
  }
  function removerPasso(i: number) {
    setDraftSteps((arr) => arr.filter((_, idx) => idx !== i))
  }

  // ---- estilos compartilhados (padrão TipoProcessoTab) ----
  const inputCls =
    'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20'
  const labelCls = 'mb-1 block text-xs text-white/60'

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Modelos de Workflow Interno</h2>
          <p className="max-w-2xl text-sm text-white/50">
            Biblioteca mestre de modelos de passo a passo operacional. Cadastre aqui os modelos de
            Workflow Interno que depois serão aplicados nas fases dos Processos de Nacionalidade.
          </p>
        </div>
        <button
          onClick={abrirNovo}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
        >
          + Novo modelo de workflow
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
          className="min-w-[200px] flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder-white/30 outline-none backdrop-blur focus:border-white/20"
        />
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
          {busca || fCat || fStatus ? 'Nenhum modelo encontrado.' : 'Nenhum modelo ainda. Clique em “+ Novo modelo de workflow”.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-white/5">
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Modelo</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Fases recomendadas</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-white/50">Passos</th>
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
                    <td className="px-4 py-2.5 text-[12px] text-white/70">{phs}</td>
                    <td className="px-4 py-2.5 text-center text-[12px] text-white/80">{(m.passos || []).length}</td>
                    <td className="px-4 py-2.5">
                      {m.arquivado ? (
                        <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/50">arquivado</span>
                      ) : (
                        <span className="rounded-md bg-green-500/15 px-2 py-0.5 text-[11px] font-medium text-green-300">ativo</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center text-[12px] text-white/70">{m.usedByCount || 0}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <button onClick={() => abrirEditar(m)} className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white">Editar</button>
                        <button onClick={() => duplicar(m)} className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white">Duplicar</button>
                        <button onClick={aplicarEmFase} title="Disponível na Fase 3" className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/40 transition hover:bg-white/10 hover:text-white/70">Aplicar em fase</button>
                        {m.arquivado ? (
                          <button onClick={() => alternarArquivo(m)} className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-green-300/80 transition hover:bg-white/10">Reativar</button>
                        ) : (
                          <button onClick={() => alternarArquivo(m)} className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-amber-300/80 transition hover:bg-white/10">Arquivar</button>
                        )}
                        {podeExcluir && (
                          <button onClick={() => excluir(m)} className="rounded-md border border-red-500/20 px-2.5 py-1 text-xs text-red-300/80 transition hover:bg-red-500/10 hover:text-red-200">Excluir</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ===== Modal do template ===== */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <h3 className="text-lg font-semibold text-white">
                {editId == null ? 'Novo' : 'Editar'} modelo de workflow interno
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
                  className={inputCls + ' min-h-[44px]'}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Categoria (fase principal)</label>
                  <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className={inputCls}>
                    <option value="" className="bg-zinc-900">— selecione —</option>
                    {fases.map((f) => (
                      <option key={f.phaseKey} value={f.phaseKey} className="bg-zinc-900">{f.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as 'active' | 'archived' }))}
                    className={inputCls}
                  >
                    <option value="active" className="bg-zinc-900">ativo</option>
                    <option value="archived" className="bg-zinc-900">arquivado</option>
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

              {/* Editor de passos */}
              <div>
                <label className={labelCls}>Passos do modelo</label>
                <div className="space-y-1.5">
                  {draftSteps.length === 0 && (
                    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-[12px] text-white/40">
                      Nenhum passo ainda. Clique em “+ Adicionar passo”.
                    </div>
                  )}
                  {draftSteps.map((st, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                      <div className="min-w-0 text-[12px]">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-white">{i + 1}. {st.name || '(sem nome)'}</span>
                          {st.generatesTask !== false && (
                            <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] text-green-300">gera tarefa</span>
                          )}
                          {st.required === false && (
                            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/50">opcional</span>
                          )}
                          {!!st.defaultSlaDays && <span className="text-[10px] text-white/40">SLA {st.defaultSlaDays}d</span>}
                        </div>
                        {st.description && <div className="truncate text-[11px] text-white/40">{st.description}</div>}
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button onClick={() => moverPasso(i, -1)} disabled={i === 0} title="Mover para cima" className="rounded border border-white/10 px-2 py-1 text-xs text-white/70 hover:bg-white/10 disabled:opacity-25">▲</button>
                        <button onClick={() => moverPasso(i, 1)} disabled={i === draftSteps.length - 1} title="Mover para baixo" className="rounded border border-white/10 px-2 py-1 text-xs text-white/70 hover:bg-white/10 disabled:opacity-25">▼</button>
                        <button onClick={() => abrirEditarPasso(i)} className="rounded px-2 py-1 text-[11px] text-white/70 hover:bg-white/10 hover:text-white">Editar</button>
                        <button onClick={() => duplicarPasso(i)} className="rounded px-2 py-1 text-[11px] text-white/70 hover:bg-white/10 hover:text-white">Dup</button>
                        <button onClick={() => removerPasso(i)} className="rounded px-2 py-1 text-[11px] text-red-300/80 hover:bg-red-500/10">×</button>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={abrirNovoPasso}
                  className="mt-2 rounded-lg border border-white/10 px-3 py-1.5 text-[12px] text-white/70 transition hover:bg-white/10 hover:text-white"
                >
                  + Adicionar passo
                </button>
              </div>
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

      {/* ===== Modal do passo (sobre o do template) ===== */}
      {passoModalAberto && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <h3 className="text-base font-semibold text-white">Editar passo</h3>
              <button onClick={fecharPasso} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            <div className="space-y-4 px-6 py-4">
              <div>
                <label className={labelCls}>Nome do passo *</label>
                <input value={passoForm.name} onChange={(e) => setPassoForm((p) => ({ ...p, name: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Descrição</label>
                <input value={passoForm.description} onChange={(e) => setPassoForm((p) => ({ ...p, description: e.target.value }))} className={inputCls} />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Gera tarefa</label>
                  <select
                    value={passoForm.generatesTask ? 'true' : 'false'}
                    onChange={(e) => setPassoForm((p) => ({ ...p, generatesTask: e.target.value === 'true' }))}
                    className={inputCls}
                  >
                    <option value="true" className="bg-zinc-900">sim</option>
                    <option value="false" className="bg-zinc-900">não</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Obrigatório</label>
                  <select
                    value={passoForm.required ? 'true' : 'false'}
                    onChange={(e) => setPassoForm((p) => ({ ...p, required: e.target.value === 'true' }))}
                    className={inputCls}
                  >
                    <option value="true" className="bg-zinc-900">sim</option>
                    <option value="false" className="bg-zinc-900">não</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Responsável padrão</label>
                  <input value={passoForm.defaultResponsibleRole} onChange={(e) => setPassoForm((p) => ({ ...p, defaultResponsibleRole: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Prioridade</label>
                  <select
                    value={passoForm.defaultPriority}
                    onChange={(e) => setPassoForm((p) => ({ ...p, defaultPriority: e.target.value as Prioridade }))}
                    className={inputCls}
                  >
                    <option value="low" className="bg-zinc-900">baixa</option>
                    <option value="medium" className="bg-zinc-900">média</option>
                    <option value="high" className="bg-zinc-900">alta</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>SLA (dias)</label>
                  <input
                    type="number"
                    value={passoForm.defaultSlaDays}
                    onChange={(e) => setPassoForm((p) => ({ ...p, defaultSlaDays: Number(e.target.value) }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Condição de conclusão</label>
                  <input value={passoForm.completionCondition} onChange={(e) => setPassoForm((p) => ({ ...p, completionCondition: e.target.value }))} className={inputCls} />
                </div>
              </div>

              <div>
                <label className={labelCls}>Checklist (um item por linha)</label>
                <textarea
                  value={passoForm.checklistText}
                  onChange={(e) => setPassoForm((p) => ({ ...p, checklistText: e.target.value }))}
                  className={inputCls + ' min-h-[60px]'}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-white/10 px-6 py-4">
              <button onClick={fecharPasso} className="rounded-lg px-4 py-2 text-sm text-white/60 transition hover:text-white">Cancelar</button>
              <button onClick={salvarPasso} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
                Salvar passo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
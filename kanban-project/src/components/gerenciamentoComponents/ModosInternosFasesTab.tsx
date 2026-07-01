'use client'

// src/components/gerenciamentoComponents/ModosInternosFasesTab.tsx
// FASE 3A do Motor — "Modos Internos das Fases" (phasemodes).
// APLICA os modelos da biblioteca 2A (Modelos Internos de Fase) num Processo + Fase.
// Cada modo aplicado é uma CÓPIA (snapshot) do modelo; pode ser editado sem mexer no modelo.
// Backend: /api/gerenciamento/modos-fase (GET/POST) + /[id] (PUT/DELETE)
// Visual segue o padrão do app (tema escuro/glass, modal bg-zinc-900/95, options bg-zinc-900).

import { useState, useEffect, useMemo, useCallback } from 'react'

type Fase = { phaseKey: string; label: string; ordem: number }
type TipoProcesso = { id: number; name: string; fases: Fase[] }

type Modo = {
  id: number
  templateId: number | null
  tipoProcessoId: number | null
  phaseKey: string
  key: string
  label: string
  description: string | null
  condition: string | null
  impactOperational: string | null
  impactDocument: string | null
  impactFinancial: string | null
  impactProtocol: string | null
  active: boolean
  arquivado: boolean
}

type ModeloInterno = {
  id: number
  name: string
  modeKey: string
  category: string | null
  recommendedPhases: string[] | null
  description: string | null
  isSystemTemplate: boolean
}

const icoCls = 'h-4 w-4'
const IcoEdit = () => (<svg className={icoCls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>)
const IcoCopy = () => (<svg className={icoCls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>)
const IcoArchive = () => (<svg className={icoCls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="5" rx="1" /><path d="M4 8v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8" /><path d="M10 12h4" /></svg>)
const IcoRestore = () => (<svg className={icoCls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6" /><path d="M3 13a9 9 0 1 0 3-7.7L3 8" /></svg>)
const IcoTrash = () => (<svg className={icoCls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>)

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

const BASE = '/api/gerenciamento/modos-fase'

function novoForm() {
  return { label: '', active: true, description: '', condition: '', impactOperational: '', impactDocument: '', impactFinancial: '', impactProtocol: '' }
}

export default function ModosInternosFasesTab() {
  const [tipos, setTipos] = useState<TipoProcesso[]>([])
  const [modos, setModos] = useState<Modo[]>([])
  const [modelos, setModelos] = useState<ModeloInterno[]>([])
  const [loading, setLoading] = useState(true)
  const [erroCarregar, setErroCarregar] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState('')

  const [ptId, setPtId] = useState<number | ''>('')
  const [phaseKey, setPhaseKey] = useState('')

  // modal ad-hoc / editar
  const [modalAberto, setModalAberto] = useState(false)
  const [editModo, setEditModo] = useState<Modo | null>(null)
  const [form, setForm] = useState(novoForm())
  const [erroModal, setErroModal] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // modal aplicar
  const [aplicarAberto, setAplicarAberto] = useState(false)
  const [selecionados, setSelecionados] = useState<number[]>([])
  const [aplicando, setAplicando] = useState(false)

  const carregar = useCallback(async () => {
    setLoading(true)
    setErroCarregar(null)
    try {
      const d = await jsonFetch(BASE, { cache: 'no-store' })
      setTipos((d as any).tiposProcesso || [])
      setModos((d as any).modos || [])
      setModelos((d as any).modelosInternos || [])
    } catch (e: any) {
      setErroCarregar(e.message || 'Não foi possível carregar.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  function flashSucesso(msg: string) {
    setSucesso(msg)
    setTimeout(() => setSucesso(''), 3500)
  }

  const processoAtual = useMemo(() => tipos.find((t) => t.id === ptId) || null, [tipos, ptId])
  const fases = processoAtual?.fases || []

  const modosDaFase = useMemo(() => {
    if (!ptId || !phaseKey) return []
    return modos.filter(
      (m) => m.phaseKey === phaseKey && !m.arquivado && (m.tipoProcessoId === ptId || m.tipoProcessoId === null),
    )
  }, [modos, ptId, phaseKey])

  // modelos ordenados: recomendados p/ a fase primeiro
  const modelosOrdenados = useMemo(() => {
    const recomendado = (m: ModeloInterno) =>
      m.category === phaseKey || (Array.isArray(m.recommendedPhases) && m.recommendedPhases.includes(phaseKey))
    return [...modelos].sort((a, b) => Number(recomendado(b)) - Number(recomendado(a)) || a.name.localeCompare(b.name))
  }, [modelos, phaseKey])

  function trocarProcesso(v: string) {
    setPtId(v ? Number(v) : '')
    setPhaseKey('')
  }

  // ----- ad-hoc / editar -----
  function abrirNovo() {
    setEditModo(null)
    setForm(novoForm())
    setErroModal(null)
    setModalAberto(true)
  }
  function abrirEditar(m: Modo) {
    setEditModo(m)
    setForm({
      label: m.label,
      active: m.active,
      description: m.description || '',
      condition: m.condition || '',
      impactOperational: m.impactOperational || '',
      impactDocument: m.impactDocument || '',
      impactFinancial: m.impactFinancial || '',
      impactProtocol: m.impactProtocol || '',
    })
    setErroModal(null)
    setModalAberto(true)
  }

  async function salvar() {
    if (!form.label.trim()) {
      setErroModal('Informe o nome do modo.')
      return
    }
    setSalvando(true)
    setErroModal(null)
    try {
      if (editModo == null) {
        await jsonFetch(BASE, {
          method: 'POST',
          body: JSON.stringify({ tipoProcessoId: ptId, phaseKey, ...form }),
        })
      } else {
        await jsonFetch(`${BASE}/${editModo.id}`, { method: 'PUT', body: JSON.stringify(form) })
      }
      setModalAberto(false)
      await carregar()
      flashSucesso(editModo == null ? 'Modo criado.' : 'Modo atualizado.')
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function duplicar(m: Modo) {
    try {
      await jsonFetch(BASE, {
        method: 'POST',
        body: JSON.stringify({
          tipoProcessoId: ptId,
          phaseKey,
          label: `${m.label} (cópia)`,
          description: m.description,
          condition: m.condition,
          impactOperational: m.impactOperational,
          impactDocument: m.impactDocument,
          impactFinancial: m.impactFinancial,
          impactProtocol: m.impactProtocol,
          active: m.active,
        }),
      })
      await carregar()
      flashSucesso('Modo duplicado.')
    } catch (e: any) {
      alert(e.message || 'Não foi possível duplicar.')
    }
  }

  async function alternarArquivo(m: Modo) {
    if (!m.arquivado && !confirm('Arquivar este modo?')) return
    try {
      await jsonFetch(`${BASE}/${m.id}`, { method: 'PUT', body: JSON.stringify({ arquivado: !m.arquivado }) })
      await carregar()
    } catch (e: any) {
      alert(e.message || 'Não foi possível alterar.')
    }
  }

  async function excluir(m: Modo) {
    if (!confirm(`Excluir o modo "${m.label}" desta fase?`)) return
    try {
      await jsonFetch(`${BASE}/${m.id}`, { method: 'DELETE' })
      await carregar()
      flashSucesso('Modo excluído.')
    } catch (e: any) {
      alert(e.message || 'Não foi possível excluir.')
    }
  }

  // ----- aplicar modelos -----
  function abrirAplicar() {
    setSelecionados([])
    setAplicarAberto(true)
  }
  function toggleSel(id: number) {
    setSelecionados((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }
  async function aplicarSelecionados() {
    if (!selecionados.length) return
    setAplicando(true)
    try {
      const r = await jsonFetch(BASE, {
        method: 'POST',
        body: JSON.stringify({ aplicar: true, tipoProcessoId: ptId, phaseKey, templateIds: selecionados }),
      })
      setAplicarAberto(false)
      await carregar()
      const ap = (r as any).aplicados || 0
      const ja = (r as any).jaExistiam || 0
      flashSucesso(`${ap} modelo(s) aplicado(s)${ja ? `, ${ja} já estava(m) na fase` : ''}.`)
    } catch (e: any) {
      alert(e.message || 'Não foi possível aplicar.')
    } finally {
      setAplicando(false)
    }
  }

  const inputCls = 'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20'
  const labelCls = 'mb-1 block text-xs text-white/60'
  const selCls = 'rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-white/20'
  const btnIco = 'rounded-md border border-white/10 p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white'

  function impactos(m: Modo) {
    return [
      m.impactOperational ? `op: ${m.impactOperational}` : '',
      m.impactDocument ? `doc: ${m.impactDocument}` : '',
      m.impactFinancial ? `fin: ${m.impactFinancial}` : '',
      m.impactProtocol ? `prot: ${m.impactProtocol}` : '',
    ].filter(Boolean).join(' · ')
  }

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div>
        <h2 className="text-xl font-semibold text-white">Modos Internos das Fases</h2>
        <p className="max-w-3xl text-sm text-white/50">
          Modos internos são variações <b>dentro</b> de uma fase (ex.: Judicial/Administrativa na Retificação).
          Escolha o Processo e a Fase para ver e aplicar os modos. Para os modelos reutilizáveis, use a{' '}
          <span className="text-blue-300">biblioteca “Modelos Internos de Fase”</span>.
        </p>
      </div>

      {sucesso && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-200">{sucesso}</div>
      )}

      {/* Seletores */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3 backdrop-blur">
        <select value={ptId} onChange={(e) => trocarProcesso(e.target.value)} className={selCls}>
          <option value="" className="bg-zinc-900">— Processo de Nacionalidade —</option>
          {tipos.map((t) => (
            <option key={t.id} value={t.id} className="bg-zinc-900">{t.name}</option>
          ))}
        </select>
        <select value={phaseKey} onChange={(e) => setPhaseKey(e.target.value)} disabled={!ptId} className={selCls + ' disabled:opacity-40'}>
          <option value="" className="bg-zinc-900">{ptId ? '— Fase —' : 'selecione o processo primeiro'}</option>
          {fases.map((f) => (
            <option key={f.phaseKey} value={f.phaseKey} className="bg-zinc-900">[{f.ordem}] {f.label}</option>
          ))}
        </select>
      </div>

      {/* Corpo */}
      {loading ? (
        <div className="py-12 text-center text-sm text-white/40">Carregando...</div>
      ) : erroCarregar ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {erroCarregar}
          <button onClick={carregar} className="ml-3 underline hover:text-white">Tentar de novo</button>
        </div>
      ) : !ptId ? (
        <div className="rounded-xl border border-white/10 bg-white/5 py-12 text-center text-sm text-white/40 backdrop-blur">
          Escolha um Processo de Nacionalidade para começar.
        </div>
      ) : !phaseKey ? (
        <div className="rounded-xl border border-white/10 bg-white/5 py-12 text-center text-sm text-white/40 backdrop-blur">
          Escolha a fase para ver seus modos internos.
        </div>
      ) : (
        <div className="space-y-3">
          {modosDaFase.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/5 py-10 text-center text-sm text-white/40 backdrop-blur">
              Nenhum modo para esta fase ainda.
            </div>
          ) : (
            modosDaFase.map((m) => {
              const imp = impactos(m)
              return (
                <div key={m.id} className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-white">{m.label}</span>
                        <span className="text-xs text-white/40">({m.key})</span>
                        {m.tipoProcessoId === null && (
                          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/50">global</span>
                        )}
                        {m.templateId != null && (
                          <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300">de modelo</span>
                        )}
                        {!m.active && (
                          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/50">inativo</span>
                        )}
                      </div>
                      {m.description && <div className="mt-1 text-[13px] text-white/60">{m.description}</div>}
                      {m.condition && <div className="mt-1 text-[11px] text-white/40">Condição: {m.condition}</div>}
                      {imp && <div className="mt-1 text-[11px] text-white/40">{imp}</div>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button onClick={() => abrirEditar(m)} title="Editar" aria-label="Editar" className={btnIco}><IcoEdit /></button>
                      <button onClick={() => duplicar(m)} title="Duplicar" aria-label="Duplicar" className={btnIco}><IcoCopy /></button>
                      {m.arquivado ? (
                        <button onClick={() => alternarArquivo(m)} title="Reativar" aria-label="Reativar" className="rounded-md border border-white/10 p-1.5 text-green-300/70 transition hover:bg-white/10 hover:text-green-200"><IcoRestore /></button>
                      ) : (
                        <button onClick={() => alternarArquivo(m)} title="Arquivar" aria-label="Arquivar" className="rounded-md border border-white/10 p-1.5 text-amber-300/70 transition hover:bg-white/10 hover:text-amber-200"><IcoArchive /></button>
                      )}
                      <button onClick={() => excluir(m)} title="Excluir" aria-label="Excluir" className="rounded-md border border-red-500/20 p-1.5 text-red-300/70 transition hover:bg-red-500/10 hover:text-red-200"><IcoTrash /></button>
                    </div>
                  </div>
                </div>
              )
            })
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button onClick={abrirNovo} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">+ Novo modo</button>
            <button onClick={abrirAplicar} className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:bg-white/10">+ Aplicar modelo interno</button>
          </div>
        </div>
      )}

      {/* ===== Modal ad-hoc / editar ===== */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <h3 className="text-lg font-semibold text-white">{editModo == null ? 'Novo' : 'Editar'} modo interno</h3>
              <button onClick={() => setModalAberto(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>
            <div className="space-y-4 px-6 py-4">
              {erroModal && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{erroModal}</div>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Nome *</label>
                  <input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} className={inputCls} />
                  {editModo && <p className="mt-1 text-[11px] text-white/30">A chave ({editModo.key}) não muda ao renomear.</p>}
                </div>
                <div>
                  <label className={labelCls}>Status</label>
                  <select value={form.active ? 'true' : 'false'} onChange={(e) => setForm((f) => ({ ...f, active: e.target.value === 'true' }))} className={inputCls}>
                    <option value="true" className="bg-zinc-900">Ativo</option>
                    <option value="false" className="bg-zinc-900">Inativo</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={labelCls}>Descrição</label>
                <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Condição de uso</label>
                <input value={form.condition} onChange={(e) => setForm((f) => ({ ...f, condition: e.target.value }))} className={inputCls} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Impacto operacional</label>
                  <input value={form.impactOperational} onChange={(e) => setForm((f) => ({ ...f, impactOperational: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Impacto documental</label>
                  <input value={form.impactDocument} onChange={(e) => setForm((f) => ({ ...f, impactDocument: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Impacto financeiro</label>
                  <input value={form.impactFinancial} onChange={(e) => setForm((f) => ({ ...f, impactFinancial: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Impacto de protocolo</label>
                  <input value={form.impactProtocol} onChange={(e) => setForm((f) => ({ ...f, impactProtocol: e.target.value }))} className={inputCls} />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-white/10 px-6 py-4">
              <button onClick={() => setModalAberto(false)} className="rounded-lg px-4 py-2 text-sm text-white/60 transition hover:text-white">Cancelar</button>
              <button onClick={salvar} disabled={salvando} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50">
                {salvando ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Modal aplicar modelos ===== */}
      {aplicarAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <h3 className="text-lg font-semibold text-white">Aplicar modelos internos nesta fase</h3>
              <button onClick={() => setAplicarAberto(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>
            <div className="space-y-2 px-6 py-4">
              {modelosOrdenados.length === 0 ? (
                <p className="py-6 text-center text-sm text-white/40">Nenhum modelo na biblioteca. Cadastre em “Modelos Internos de Fase”.</p>
              ) : (
                modelosOrdenados.map((m) => {
                  const rec = m.category === phaseKey || (Array.isArray(m.recommendedPhases) && m.recommendedPhases.includes(phaseKey))
                  const on = selecionados.includes(m.id)
                  return (
                    <label key={m.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${on ? 'border-blue-500/40 bg-blue-500/10' : 'border-white/10 bg-white/5 hover:bg-white/[0.07]'}`}>
                      <input type="checkbox" checked={on} onChange={() => toggleSel(m.id)} className="mt-0.5 h-4 w-4 accent-blue-500" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-white">{m.name}</span>
                          <span className="text-[11px] text-white/40">({m.modeKey})</span>
                          {rec && <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] text-green-300">recomendado</span>}
                        </div>
                        {m.description && <div className="mt-0.5 text-[12px] text-white/50">{m.description}</div>}
                      </div>
                    </label>
                  )
                })
              )}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-white/10 px-6 py-4">
              <span className="text-xs text-white/40">{selecionados.length} selecionado(s)</span>
              <div className="flex gap-2">
                <button onClick={() => setAplicarAberto(false)} className="rounded-lg px-4 py-2 text-sm text-white/60 transition hover:text-white">Cancelar</button>
                <button onClick={aplicarSelecionados} disabled={aplicando || !selecionados.length} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50">
                  {aplicando ? 'Aplicando...' : 'Aplicar selecionados'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
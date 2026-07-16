'use client'

// src/components/gerenciamentoComponents/MacroKanbanTab.tsx
// FASE 1B do Motor — Workflow Macro + Fases variáveis por Tipo de Processo.
// As fases são a "coluna variável": adiciona, remove, reordena e liga/desliga no kanban.
// Edição local + botão Salvar (PUT manda a lista completa = verdade).
// Backend: /api/gerenciamento/workflow-macro (GET bootstrap, POST criar) + /[tipoProcessoId] (GET, PUT sync, DELETE)

import { useState, useEffect, useMemo, useCallback } from 'react'

type Tipo = { id: number; code: string; name: string; countryKey: string; countryLabel: string; modalityLabel: string; ativo: boolean; temWorkflow: boolean }
type CatFase = { id: number; phaseKey: string; label: string; ordemPadrao: number; requiredPadrao: boolean; conditionalPadrao: boolean; slaDiasPadrao: number }
// exitRule DESCONTINUADO como condição de avanço: a condição de conclusão de fase é do Workflow Interno + BlockingEngine.
// Mantido opcional só p/ LEITURA de legado — o backend não grava mais exitRule novos e a UI não o edita nem o reenvia.
type Fase = { phaseKey: string; label: string; ordem: number; required: boolean; conditional: boolean; entryRule: string; exitRule?: string | null; slaDays: number; showInKanban: boolean }
type MacroWf = { id: number; tipoProcessoId: number; name: string; ativo: boolean; fases: Fase[] }

async function jsonFetch(url: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as any)?.error || `Erro ${res.status}`)
  return data
}

export default function MacroKanbanTab() {
  const [tipos, setTipos] = useState<Tipo[]>([])
  const [catFases, setCatFases] = useState<CatFase[]>([])
  const [paises, setPaises] = useState<{ countryKey: string; flag: string | null }[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [tipoId, setTipoId] = useState<number | null>(null)
  const [wf, setWf] = useState<MacroWf | null>(null)
  const [fases, setFases] = useState<Fase[]>([])
  const [dirty, setDirty] = useState(false)
  const [carregandoWf, setCarregandoWf] = useState(false)
  const [addKey, setAddKey] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [criando, setCriando] = useState(false)
  const [salvoMsg, setSalvoMsg] = useState<string | null>(null)

  const bootstrap = useCallback(async () => {
    setLoading(true); setErro(null)
    try {
      const d = await jsonFetch('/api/gerenciamento/workflow-macro', { cache: 'no-store' })
      setTipos((d as any).tipos || [])
      setCatFases((d as any).catalogoFases || [])
      setPaises((d as any).paises || [])
    } catch (e: any) {
      setErro(e.message || 'Não foi possível carregar.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { bootstrap() }, [bootstrap])

  const carregarWf = useCallback(async (id: number) => {
    setCarregandoWf(true)
    try {
      const d = await jsonFetch(`/api/gerenciamento/workflow-macro/${id}`, { cache: 'no-store' })
      const m = (d as any).macroWorkflow as MacroWf | null
      setWf(m)
      setFases(m ? [...m.fases].sort((a, b) => a.ordem - b.ordem) : [])
      setDirty(false)
    } catch (e: any) {
      alert(e.message || 'Erro ao carregar o workflow.')
    } finally { setCarregandoWf(false) }
  }, [])

  function selecionar(id: number) {
    setTipoId(id); setAddKey('')
    carregarWf(id)
  }

  const tipoSel = useMemo(() => tipos.find((t) => t.id === tipoId) || null, [tipos, tipoId])
  const flagDe = useCallback((ck: string) => paises.find((p) => p.countryKey === ck)?.flag || '', [paises])

  // fases ainda não usadas (p/ o seletor "adicionar fase")
  const fasesDisponiveis = useMemo(() => {
    const usados = new Set(fases.map((f) => f.phaseKey))
    return catFases.filter((c) => !usados.has(c.phaseKey))
  }, [catFases, fases])

  // prévia do kanban (colunas = fases marcadas, na ordem)
  const colunas = useMemo(() => fases.filter((f) => f.showInKanban).map((f) => f.label), [fases])

  async function criarWorkflow(seedDefaults: boolean) {
    if (!tipoId) return
    setCriando(true)
    try {
      await jsonFetch('/api/gerenciamento/workflow-macro', { method: 'POST', body: JSON.stringify({ tipoProcessoId: tipoId, seedDefaults }) })
      await carregarWf(tipoId)
      setTipos((prev) => prev.map((t) => (t.id === tipoId ? { ...t, temWorkflow: true } : t)))
    } catch (e: any) {
      alert(e.message || 'Erro ao criar o workflow.')
    } finally { setCriando(false) }
  }

  function adicionarFase() {
    if (!addKey) return
    const c = catFases.find((x) => x.phaseKey === addKey)
    if (!c) return
    setFases((prev) => [...prev, {
      phaseKey: c.phaseKey, label: c.label, ordem: prev.length + 1,
      required: c.requiredPadrao, conditional: c.conditionalPadrao,
      entryRule: prev.length === 0 ? 'process_created' : 'previous_phase_completed',
      // sem exitRule: a condição de conclusão vem do Workflow Interno, não desta tela.
      slaDays: c.slaDiasPadrao, showInKanban: true,
    }])
    setAddKey(''); setDirty(true)
  }

  function mover(idx: number, dir: -1 | 1) {
    setFases((prev) => {
      const arr = [...prev]
      const j = idx + dir
      if (j < 0 || j >= arr.length) return prev
      ;[arr[idx], arr[j]] = [arr[j], arr[idx]]
      return arr.map((f, i) => ({ ...f, ordem: i + 1 }))
    })
    setDirty(true)
  }
  function remover(idx: number) {
    setFases((prev) => prev.filter((_, i) => i !== idx).map((f, i) => ({ ...f, ordem: i + 1 })))
    setDirty(true)
  }
  function patch(idx: number, campo: Partial<Fase>) {
    setFases((prev) => prev.map((f, i) => (i === idx ? { ...f, ...campo } : f)))
    setDirty(true)
  }

  async function salvar() {
    if (!tipoId) return
    const nome = tipoSel?.name || 'processo'
    setSalvando(true)
    try {
      // Payload NÃO inclui exitRule (descontinuado): só a sequência/estrutura das fases é enviada.
      const fasesPayload = fases.map((f) => ({
        phaseKey: f.phaseKey, label: f.label, ordem: f.ordem,
        required: f.required, conditional: f.conditional,
        entryRule: f.entryRule, slaDays: f.slaDays, showInKanban: f.showInKanban,
      }))
      await jsonFetch(`/api/gerenciamento/workflow-macro/${tipoId}`, { method: 'PUT', body: JSON.stringify({ fases: fasesPayload }) })
      // salvou → fecha o editor e volta pro seletor, com aviso de confirmação
      setTipoId(null); setWf(null); setFases([]); setDirty(false); setAddKey('')
      setSalvoMsg(`Workflow de ${nome} salvo.`)
      setTimeout(() => setSalvoMsg(null), 3500)
    } catch (e: any) {
      alert(e.message || 'Erro ao salvar.')
    } finally { setSalvando(false) }
  }

  async function excluirWorkflow() {
    if (!tipoId) return
    if (!confirm('Excluir o workflow inteiro deste processo? As fases serão perdidas.')) return
    try {
      await jsonFetch(`/api/gerenciamento/workflow-macro/${tipoId}`, { method: 'DELETE' })
      setTipos((prev) => prev.map((t) => (t.id === tipoId ? { ...t, temWorkflow: false } : t)))
      await carregarWf(tipoId)
    } catch (e: any) {
      alert(e.message || 'Erro ao excluir.')
    }
  }

  const selCls = 'rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-white/20'

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-white">Workflow Macro / Kanban</h2>
        <p className="text-sm text-white/50">As fases de cada processo — adicione, remova e reordene. As colunas do kanban saem daqui.</p>
      </div>

      <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2.5 text-sm text-blue-200">
        O Workflow Macro define a <span className="font-medium">SEQUÊNCIA</span> das fases. Os requisitos para <span className="font-medium">CONCLUIR</span> cada fase são definidos no Workflow Interno; o avanço é executado pelo PhaseAdvanceService.
      </div>

      {salvoMsg && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2.5 text-sm text-green-200">
          ✓ {salvoMsg}
        </div>
      )}

      {loading && <div className="py-12 text-center text-sm text-white/40">Carregando...</div>}
      {!loading && erro && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{erro}
          <button onClick={bootstrap} className="ml-3 underline hover:text-white">Tentar de novo</button>
        </div>
      )}

      {!loading && !erro && tipos.length === 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          Nenhum tipo de processo ainda. Crie em <span className="font-medium">Processos de Nacionalidade</span> primeiro.
        </div>
      )}

      {!loading && !erro && tipos.length > 0 && (
        <>
          {/* Seletor de processo */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-white/60">Processo:</label>
            <select value={tipoId ?? ''} onChange={(e) => e.target.value && selecionar(Number(e.target.value))} className={selCls + ' min-w-[260px]'}>
              <option value="" className="bg-zinc-900">— selecione um processo —</option>
              {tipos.map((t) => (
                <option key={t.id} value={t.id} className="bg-zinc-900">
                  {flagDe(t.countryKey)} {t.name} {t.temWorkflow ? '' : '· (sem workflow)'}
                </option>
              ))}
            </select>
          </div>

          {tipoId && carregandoWf && <div className="py-8 text-center text-sm text-white/40">Carregando workflow...</div>}

          {/* Sem workflow ainda → CTA */}
          {tipoId && !carregandoWf && !wf && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center backdrop-blur">
              <p className="text-sm text-white/70">
                <span className="font-medium text-white">{tipoSel?.name}</span> ainda não tem um Workflow Macro.
              </p>
              <p className="mt-1 text-xs text-white/40">Comece pelas 10 fases padrão (recomendado) ou monte do zero.</p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                <button onClick={() => criarWorkflow(true)} disabled={criando} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50">
                  {criando ? 'Criando...' : 'Criar com as 10 fases padrão'}
                </button>
                <button onClick={() => criarWorkflow(false)} disabled={criando} className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:bg-white/10 disabled:opacity-50">
                  Criar vazio
                </button>
              </div>
            </div>
          )}

          {/* Editor de fases */}
          {tipoId && !carregandoWf && wf && (
            <div className="space-y-4">
              {/* Prévia do kanban */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">Prévia do kanban ({colunas.length} colunas)</div>
                {colunas.length === 0 ? (
                  <div className="text-sm text-white/40">Nenhuma coluna — adicione fases ou marque "no kanban".</div>
                ) : (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {colunas.map((c, i) => (
                      <div key={i} className="flex h-16 min-w-[130px] shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] px-3 text-center text-xs font-medium text-white/80">
                        {c}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Lista de fases */}
              <div className="space-y-2">
                {fases.length === 0 && <div className="rounded-lg border border-dashed border-white/15 p-6 text-center text-sm text-white/40">Workflow vazio. Adicione a primeira fase abaixo.</div>}
                {fases.map((f, idx) => (
                  <div key={f.phaseKey} className="rounded-xl border border-white/10 bg-white/5 p-3 backdrop-blur">
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col">
                        <button onClick={() => mover(idx, -1)} disabled={idx === 0} className="text-white/40 transition hover:text-white disabled:opacity-20" title="Subir">▲</button>
                        <button onClick={() => mover(idx, 1)} disabled={idx === fases.length - 1} className="text-white/40 transition hover:text-white disabled:opacity-20" title="Descer">▼</button>
                      </div>
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/10 text-xs font-semibold text-white/70">{f.ordem}</div>
                      <input value={f.label} onChange={(e) => patch(idx, { label: e.target.value })} className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white outline-none focus:border-white/20" />
                      {f.conditional && <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">condicional</span>}
                      <button onClick={() => remover(idx)} className="rounded-md border border-red-500/20 px-2 py-1 text-xs text-red-300/80 transition hover:bg-red-500/10 hover:text-red-200">Remover</button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 pl-[68px] text-xs text-white/60">
                      <label className="flex items-center gap-1.5">
                        <input type="checkbox" checked={f.showInKanban} onChange={(e) => patch(idx, { showInKanban: e.target.checked })} className="h-3.5 w-3.5 accent-blue-500" />
                        No kanban
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input type="checkbox" checked={f.required} onChange={(e) => patch(idx, { required: e.target.checked })} className="h-3.5 w-3.5 accent-blue-500" />
                        Obrigatória
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input type="checkbox" checked={f.conditional} onChange={(e) => patch(idx, { conditional: e.target.checked })} className="h-3.5 w-3.5 accent-blue-500" />
                        Condicional
                      </label>
                      <span className="flex items-center gap-1.5">
                        SLA
                        <input type="number" min="0" value={f.slaDays} onChange={(e) => patch(idx, { slaDays: Number(e.target.value) })} className="w-16 rounded border border-white/10 bg-white/5 px-2 py-1 text-white outline-none focus:border-white/20" />
                        dias
                      </span>
                      {f.exitRule && (
                        <span className="text-[11px] text-white/30" title="Campo descontinuado — somente leitura. A condição de conclusão vem do Workflow Interno.">
                          Regra de saída (legado): {f.exitRule}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Adicionar fase */}
              <div className="flex flex-wrap items-center gap-2">
                <select value={addKey} onChange={(e) => setAddKey(e.target.value)} disabled={fasesDisponiveis.length === 0} className={selCls + (fasesDisponiveis.length === 0 ? ' opacity-50' : '')}>
                  <option value="" className="bg-zinc-900">{fasesDisponiveis.length ? '— escolher fase —' : 'todas as fases já adicionadas'}</option>
                  {fasesDisponiveis.map((c) => <option key={c.phaseKey} value={c.phaseKey} className="bg-zinc-900">{c.label}</option>)}
                </select>
                <button onClick={adicionarFase} disabled={!addKey} className="rounded-lg border border-white/15 px-3 py-2 text-sm text-white/80 transition hover:bg-white/10 disabled:opacity-40">+ Adicionar fase</button>
              </div>

              {/* Barra de ações */}
              <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-4">
                <button onClick={excluirWorkflow} className="text-xs text-red-300/70 transition hover:text-red-200">Excluir workflow</button>
                <div className="flex items-center gap-3">
                  {dirty && <span className="text-xs text-amber-300/80">alterações não salvas</span>}
                  <button onClick={salvar} disabled={salvando || !dirty} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50">
                    {salvando ? 'Salvando...' : 'Salvar workflow'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
// src/components/gerenciamentoComponents/ModelosTarefaTransversalTab.tsx
"use client"

import { useEffect, useState, useCallback, type ReactNode } from "react"

// ---- constantes (do mockup) ----
const TIPOS: Record<string, string> = {
  investigative_certificate: "Emissão investigativa",
  support_certificate: "Certidão de apoio",
  document_complement: "Complemento documental",
  legal_consult: "Consulta jurídica",
  document_correction: "Correção de documento",
  translation_correction: "Correção de tradução",
  reapostille: "Reapostilamento",
  protocol_complement: "Complemento de protocolo",
  custom: "Outro",
}

const FASES: [string, string][] = [
  ["genealogia", "Genealogia"],
  ["emissao_documental", "Emissão Documental"],
  ["analise_documental", "Análise Documental"],
  ["retificacao", "Retificação de Registros"],
  ["emissao_documental_retificada", "Emissão Documental Retificada"],
  ["traducao", "Tradução Juramentada"],
  ["apostilamento", "Apostilamento"],
  ["aguardando_protocolo", "Aguardando Protocolo"],
  ["protocolado", "Protocolado"],
  ["finalizado", "Finalizado"],
]
const faseLabel = (k: string | null) => (k ? FASES.find(f => f[0] === k)?.[1] || k : "—")

const WF_SOURCES: [string, string][] = [
  ["applied_phase_workflow", "Workflow aplicado da fase operacional"],
  ["internal_template", "Modelo de workflow interno"],
  ["minimal_custom", "Workflow customizado mínimo"],
]
const LINK_TYPES: [string, string][] = [
  ["document", "documento"], ["person", "pessoa"], ["requirement", "requisito"],
  ["divergence", "divergência"], ["protocol_requirement", "exigência de protocolo"],
  ["global_pendency", "pendência global"], ["task", "tarefa"],
  ["workflow_step", "passo de workflow"], ["custom", "custom"],
]
const DUP_MODES: [string, string][] = [
  ["block", "bloquear"], ["warn", "avisar"], ["allow_with_justification", "permitir com justificativa"],
]

interface Modelo {
  id: number
  templateKey: string
  name: string
  type: string
  description: string | null
  defaultOriginPhase: string | null
  defaultOperationalPhase: string
  defaultMandatory: boolean
  recommendedForOriginPhases: string[] | null
  operationalWorkflow: any
  originLinkConfig: any
  defaultEffects: any
  duplicatePolicy: any
  isSystemTemplate: boolean
  usedByCount: number
  arquivado: boolean
}
interface WfModel { id: number; name: string }

function novoForm(): any {
  return {
    id: null,
    name: "",
    type: "custom",
    description: "",
    defaultOperationalPhase: "emissao_documental",
    defaultMandatory: true,
    recommendedForOriginPhases: [] as string[],
    operationalWorkflow: { source: "applied_phase_workflow", templateId: null, allowChangeOnCreate: true, instantiateStepsAutomatically: true, requireRequiredStepsBeforeApply: true },
    originLinkConfig: { defaultType: "document", requireOriginLink: true, captureSnapshot: true, blockWithoutOriginLink: false },
    defaultEffects: { createsDocument: false, createsCost: false, createsRevenue: false, createsEvent: false, createsAlert: false, createsProtocol: false, document: { docType: "" }, protocol: { organ: "" } },
    duplicatePolicy: { mode: "warn", allowDuplicateWithJustification: true },
    arquivado: false,
  }
}

const inputCls = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-white/60"

function authHeaders(): Record<string, string> {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}

export default function ModelosTarefaTransversalTab() {
  const [modelos, setModelos] = useState<Modelo[]>([])
  const [wfModels, setWfModels] = useState<WfModel[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState("")
  const [filtro, setFiltro] = useState<"" | "active" | "archived">("")
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<any>(novoForm())
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/gerenciamento/modelos-tarefa-transversal")
      if (r.ok) setModelos((await r.json()).modelos || [])
    } catch { /* silencioso */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    carregar()
    fetch("/api/gerenciamento/modelos-workflow-interno")
      .then(r => (r.ok ? r.json() : { modelos: [] }))
      .then(d => setWfModels(d.modelos || d.templates || []))
      .catch(() => {})
  }, [carregar])

  function abrirNovo() { setForm(novoForm()); setModalOpen(true) }
  function abrirEditar(m: Modelo) {
    const base = novoForm()
    setForm({
      ...base,
      id: m.id,
      name: m.name,
      type: m.type,
      description: m.description || "",
      defaultOperationalPhase: m.defaultOperationalPhase,
      defaultMandatory: m.defaultMandatory,
      recommendedForOriginPhases: m.recommendedForOriginPhases || [],
      operationalWorkflow: { ...base.operationalWorkflow, ...(m.operationalWorkflow || {}) },
      originLinkConfig: { ...base.originLinkConfig, ...(m.originLinkConfig || {}) },
      defaultEffects: {
        ...base.defaultEffects,
        ...(m.defaultEffects || {}),
        document: { ...base.defaultEffects.document, ...((m.defaultEffects && m.defaultEffects.document) || {}) },
        protocol: { ...base.defaultEffects.protocol, ...((m.defaultEffects && m.defaultEffects.protocol) || {}) },
      },
      duplicatePolicy: { ...base.duplicatePolicy, ...(m.duplicatePolicy || {}) },
      arquivado: m.arquivado,
    })
    setModalOpen(true)
  }

  async function salvar() {
    if (!form.name.trim()) { alert("Dê um nome ao modelo."); return }
    if (!form.defaultOperationalPhase) { alert("Escolha a operação usada."); return }
    setSalvando(true)
    const body: any = {
      name: form.name.trim(),
      type: form.type,
      description: form.description || null,
      defaultOperationalPhase: form.defaultOperationalPhase,
      defaultMandatory: form.defaultMandatory,
      recommendedForOriginPhases: form.recommendedForOriginPhases,
      operationalWorkflow: form.operationalWorkflow,
      originLinkConfig: form.originLinkConfig,
      defaultEffects: form.defaultEffects,
      duplicatePolicy: form.duplicatePolicy,
      arquivado: form.arquivado,
    }
    try {
      let r: Response
      if (form.id) {
        r = await fetch(`/api/gerenciamento/modelos-tarefa-transversal/${form.id}`, { method: "PUT", headers: authHeaders(), body: JSON.stringify(body) })
      } else {
        body.templateKey = "cross_tpl_custom_" + Math.random().toString(36).slice(2, 9)
        r = await fetch("/api/gerenciamento/modelos-tarefa-transversal", { method: "POST", headers: authHeaders(), body: JSON.stringify(body) })
      }
      if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || "Erro ao salvar."); return }
      setModalOpen(false)
      await carregar()
    } catch { alert("Erro ao salvar.") }
    finally { setSalvando(false) }
  }

  async function duplicar(m: Modelo) {
    const body: any = {
      templateKey: "cross_tpl_custom_" + Math.random().toString(36).slice(2, 9),
      name: m.name + " (cópia)",
      type: m.type,
      description: m.description,
      defaultOperationalPhase: m.defaultOperationalPhase,
      defaultMandatory: m.defaultMandatory,
      recommendedForOriginPhases: m.recommendedForOriginPhases,
      operationalWorkflow: m.operationalWorkflow,
      originLinkConfig: m.originLinkConfig,
      defaultEffects: m.defaultEffects,
      duplicatePolicy: m.duplicatePolicy,
    }
    const r = await fetch("/api/gerenciamento/modelos-tarefa-transversal", { method: "POST", headers: authHeaders(), body: JSON.stringify(body) })
    if (r.ok) carregar(); else alert("Erro ao duplicar.")
  }

  async function toggleArquivo(m: Modelo) {
    const r = await fetch(`/api/gerenciamento/modelos-tarefa-transversal/${m.id}`, { method: "PUT", headers: authHeaders(), body: JSON.stringify({ arquivado: !m.arquivado }) })
    if (r.ok) carregar()
  }

  async function excluir(m: Modelo) {
    if (!confirm(`Excluir o modelo "${m.name}"?`)) return
    const r = await fetch(`/api/gerenciamento/modelos-tarefa-transversal/${m.id}`, { method: "DELETE", headers: authHeaders() })
    if (r.ok) { carregar(); return }
    const e = await r.json().catch(() => ({}))
    alert(e.error || "Não foi possível excluir.")
  }

  let lista = modelos
  if (filtro === "active") lista = lista.filter(m => !m.arquivado)
  else if (filtro === "archived") lista = lista.filter(m => m.arquivado)
  if (busca.trim()) {
    const q = busca.toLowerCase()
    lista = lista.filter(m => (m.name + " " + (m.description || "")).toLowerCase().includes(q))
  }

  const setF = (patch: any) => setForm((f: any) => ({ ...f, ...patch }))
  const setWF = (patch: any) => setForm((f: any) => ({ ...f, operationalWorkflow: { ...f.operationalWorkflow, ...patch } }))
  const setOL = (patch: any) => setForm((f: any) => ({ ...f, originLinkConfig: { ...f.originLinkConfig, ...patch } }))
  const setEF = (patch: any) => setForm((f: any) => ({ ...f, defaultEffects: { ...f.defaultEffects, ...patch } }))
  const setDP = (patch: any) => setForm((f: any) => ({ ...f, duplicatePolicy: { ...f.duplicatePolicy, ...patch } }))
  const toggleRec = (k: string) => setForm((f: any) => {
    const has = f.recommendedForOriginPhases.includes(k)
    return { ...f, recommendedForOriginPhases: has ? f.recommendedForOriginPhases.filter((x: string) => x !== k) : [...f.recommendedForOriginPhases, k] }
  })

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-white">Modelos de Tarefa Transversal</h2>
        <p className="mt-1 text-sm text-white/60">
          Modelos reutilizáveis de tarefa transversal — executar uma operação típica de outra fase sem mudar a fase oficial do processo.
          Ex.: usar Emissão Documental para solicitar certidão investigativa durante a Genealogia.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar modelo…" className={`${inputCls} max-w-xs`} />
        <select value={filtro} onChange={e => setFiltro(e.target.value as any)} className={`${inputCls} w-auto`}>
          <option value="" className="bg-zinc-900">Todos</option>
          <option value="active" className="bg-zinc-900">Ativos</option>
          <option value="archived" className="bg-zinc-900">Arquivados</option>
        </select>
        <button onClick={abrirNovo} className="ml-auto rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">
          + Novo modelo
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs text-white/50">
              <th className="px-3 py-2 font-medium">Modelo</th>
              <th className="px-3 py-2 font-medium">Tipo</th>
              <th className="px-3 py-2 font-medium">Operação padrão</th>
              <th className="px-3 py-2 font-medium">Origens recomendadas</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 text-center font-medium">Usado em</th>
              <th className="px-3 py-2 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-white/40">Carregando…</td></tr>
            ) : lista.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-white/40">Nenhum modelo. Clique em “+ Novo modelo”.</td></tr>
            ) : lista.map(m => (
              <tr key={m.id} className="border-b border-white/5 last:border-0">
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">{m.name}</span>
                    {m.isSystemTemplate && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">padrão</span>}
                  </div>
                  {m.description && <div className="text-xs text-white/40">{m.description}</div>}
                </td>
                <td className="px-3 py-2.5 text-white/70">{TIPOS[m.type] || m.type}</td>
                <td className="px-3 py-2.5 text-white/70">{faseLabel(m.defaultOperationalPhase)}</td>
                <td className="px-3 py-2.5 text-xs text-white/50">{(m.recommendedForOriginPhases || []).map(faseLabel).join(", ") || "—"}</td>
                <td className="px-3 py-2.5">
                  {m.arquivado
                    ? <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">arquivado</span>
                    : <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] text-green-300">ativo</span>}
                </td>
                <td className="px-3 py-2.5 text-center text-white/60">{m.usedByCount || 0}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    <IconBtn title="Editar" onClick={() => abrirEditar(m)}><PencilIcon /></IconBtn>
                    <IconBtn title="Duplicar" onClick={() => duplicar(m)}><CopyIcon /></IconBtn>
                    <IconBtn title={m.arquivado ? "Reativar" : "Arquivar"} onClick={() => toggleArquivo(m)}>{m.arquivado ? <RotateIcon /> : <ArchiveIcon />}</IconBtn>
                    {(m.usedByCount || 0) === 0 && <IconBtn title="Excluir" danger onClick={() => excluir(m)}><TrashIcon /></IconBtn>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setModalOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="border-b border-white/10 px-5 py-4">
              <h3 className="text-base font-semibold text-white">{form.id ? "Editar" : "Novo"} modelo de tarefa transversal</h3>
            </div>

            <div className="grid grid-cols-2 gap-3 p-5">
              <div className="col-span-2">
                <label className={labelCls}>Nome *</label>
                <input value={form.name} onChange={e => setF({ name: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Tipo *</label>
                <select value={form.type} onChange={e => setF({ type: e.target.value })} className={inputCls}>
                  {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k} className="bg-zinc-900">{v}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Operação usada (padrão) *</label>
                <select value={form.defaultOperationalPhase} onChange={e => setF({ defaultOperationalPhase: e.target.value })} className={inputCls}>
                  {FASES.map(([k, v]) => <option key={k} value={k} className="bg-zinc-900">{v}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Obrigatória por padrão?</label>
                <select value={form.defaultMandatory ? "1" : "0"} onChange={e => setF({ defaultMandatory: e.target.value === "1" })} className={inputCls}>
                  <option value="1" className="bg-zinc-900">Sim</option>
                  <option value="0" className="bg-zinc-900">Não</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Status</label>
                <select value={form.arquivado ? "archived" : "active"} onChange={e => setF({ arquivado: e.target.value === "archived" })} className={inputCls}>
                  <option value="active" className="bg-zinc-900">ativo</option>
                  <option value="archived" className="bg-zinc-900">arquivado</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Descrição</label>
                <input value={form.description} onChange={e => setF({ description: e.target.value })} className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Origens recomendadas</label>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-lg border border-white/10 bg-white/5 p-3">
                  {FASES.map(([k, v]) => (
                    <label key={k} className="flex items-center gap-1.5 text-xs text-white/70">
                      <input type="checkbox" checked={form.recommendedForOriginPhases.includes(k)} onChange={() => toggleRec(k)} />
                      {v}
                    </label>
                  ))}
                </div>
              </div>

              <Secao titulo="Workflow operacional" />
              <div>
                <label className={labelCls}>Fonte do workflow</label>
                <select value={form.operationalWorkflow.source} onChange={e => setWF({ source: e.target.value })} className={inputCls}>
                  {WF_SOURCES.map(([k, v]) => <option key={k} value={k} className="bg-zinc-900">{v}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Modelo de workflow interno</label>
                <select value={form.operationalWorkflow.templateId ?? ""} onChange={e => setWF({ templateId: e.target.value ? parseInt(e.target.value) : null })} className={inputCls}>
                  <option value="" className="bg-zinc-900">—</option>
                  {wfModels.map(w => <option key={w.id} value={w.id} className="bg-zinc-900">{w.name}</option>)}
                </select>
              </div>
              <div className="col-span-2 flex flex-wrap gap-x-4 gap-y-1.5">
                <Chk label="Permitir trocar workflow na criação" checked={form.operationalWorkflow.allowChangeOnCreate} onChange={v => setWF({ allowChangeOnCreate: v })} />
                <Chk label="Instanciar passos automaticamente" checked={form.operationalWorkflow.instantiateStepsAutomatically} onChange={v => setWF({ instantiateStepsAutomatically: v })} />
                <Chk label="Exigir passos obrigatórios antes de aplicar" checked={form.operationalWorkflow.requireRequiredStepsBeforeApply} onChange={v => setWF({ requireRequiredStepsBeforeApply: v })} />
              </div>

              <Secao titulo="Vínculo de origem" />
              <div>
                <label className={labelCls}>Tipo de vínculo padrão</label>
                <select value={form.originLinkConfig.defaultType} onChange={e => setOL({ defaultType: e.target.value })} className={inputCls}>
                  {LINK_TYPES.map(([k, v]) => <option key={k} value={k} className="bg-zinc-900">{v}</option>)}
                </select>
              </div>
              <div className="flex items-end">
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 pb-2">
                  <Chk label="Exigir vínculo" checked={form.originLinkConfig.requireOriginLink} onChange={v => setOL({ requireOriginLink: v })} />
                  <Chk label="Capturar snapshot" checked={form.originLinkConfig.captureSnapshot} onChange={v => setOL({ captureSnapshot: v })} />
                  <Chk label="Bloquear sem vínculo" checked={form.originLinkConfig.blockWithoutOriginLink} onChange={v => setOL({ blockWithoutOriginLink: v })} />
                </div>
              </div>

              <Secao titulo="Efeitos padrão" />
              <div className="col-span-2 flex flex-wrap gap-x-4 gap-y-1.5">
                <Chk label="Gera documento" checked={form.defaultEffects.createsDocument} onChange={v => setEF({ createsDocument: v })} />
                <Chk label="Gera custo" checked={form.defaultEffects.createsCost} onChange={v => setEF({ createsCost: v })} />
                <Chk label="Gera receita" checked={form.defaultEffects.createsRevenue} onChange={v => setEF({ createsRevenue: v })} />
                <Chk label="Cria evento" checked={form.defaultEffects.createsEvent} onChange={v => setEF({ createsEvent: v })} />
                <Chk label="Cria alerta" checked={form.defaultEffects.createsAlert} onChange={v => setEF({ createsAlert: v })} />
                <Chk label="Cria protocolo" checked={form.defaultEffects.createsProtocol} onChange={v => setEF({ createsProtocol: v })} />
              </div>
              <div>
                <label className={labelCls}>Tipo documental (se gera doc)</label>
                <input value={form.defaultEffects.document?.docType || ""} onChange={e => setEF({ document: { ...form.defaultEffects.document, docType: e.target.value } })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Órgão (se gera protocolo)</label>
                <input value={form.defaultEffects.protocol?.organ || ""} onChange={e => setEF({ protocol: { ...form.defaultEffects.protocol, organ: e.target.value } })} className={inputCls} />
              </div>

              <Secao titulo="Duplicidade" />
              <div>
                <label className={labelCls}>Política de duplicidade</label>
                <select value={form.duplicatePolicy.mode} onChange={e => setDP({ mode: e.target.value })} className={inputCls}>
                  {DUP_MODES.map(([k, v]) => <option key={k} value={k} className="bg-zinc-900">{v}</option>)}
                </select>
              </div>
              <div className="flex items-end">
                <div className="pb-2">
                  <Chk label="Permitir duplicar com justificativa" checked={form.duplicatePolicy.allowDuplicateWithJustification} onChange={v => setDP({ allowDuplicateWithJustification: v })} />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
              <button onClick={() => setModalOpen(false)} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/5">Cancelar</button>
              <button onClick={salvar} disabled={salvando} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60">
                {salvando ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Secao({ titulo }: { titulo: string }) {
  return <div className="col-span-2 mt-1 border-t border-white/10 pt-3 text-xs font-bold uppercase tracking-wide text-white/50">{titulo}</div>
}
function Chk({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-white/70">
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  )
}
function IconBtn({ children, title, onClick, danger }: { children: ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button title={title} aria-label={title} onClick={onClick}
      className={`rounded-md p-1.5 hover:bg-white/10 ${danger ? "text-red-300/80 hover:text-red-300" : "text-white/60 hover:text-white"}`}>
      {children}
    </button>
  )
}
const PencilIcon = () => <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
const CopyIcon = () => <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
const ArchiveIcon = () => <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="5" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></svg>
const RotateIcon = () => <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 2v6h6" /><path d="M3 8a9 9 0 1 0 3-5.7L3 8" /></svg>
const TrashIcon = () => <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
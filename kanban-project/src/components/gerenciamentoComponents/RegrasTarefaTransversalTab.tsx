// src/components/gerenciamentoComponents/RegrasTarefaTransversalTab.tsx
"use client"

import { useEffect, useState, useCallback, type ReactNode } from "react"

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

const TRIGGERS: Record<string, string> = {
  document_not_located_missing_information: "Documento não localizado por falta de informação",
  document_divergence_needs_certificate: "Divergência documental exige nova certidão",
  rectification_needs_complement: "Retificação exige documento complementar",
  translation_blocked_by_original: "Tradução bloqueada por erro no original",
  apostille_refused: "Apostilamento recusado por problema no documento",
  protocol_requires_complement: "Protocolo com exigência de complemento",
  certificate_reveals_new_need: "Certidão recebida revela nova pessoa/documento",
}
const LINK_TYPES: [string, string][] = [
  ["document", "documento"], ["person", "pessoa"], ["requirement", "requisito"],
  ["divergence", "divergência"], ["protocol_requirement", "exigência de protocolo"],
  ["global_pendency", "pendência global"], ["task", "tarefa"],
  ["workflow_step", "passo de workflow"], ["custom", "custom"],
]
const DUP_MODES: [string, string][] = [
  ["block", "bloquear"], ["warn", "avisar"], ["allow_with_justification", "permitir com justificativa"],
]
const APPLY_MODES: [string, string][] = [
  ["manual_review", "revisão manual"], ["auto_when_safe", "aplicar automaticamente quando seguro"], ["never_auto", "nunca aplicar automaticamente"],
]
const UPDATE_TARGETS: [string, string][] = [
  ["document", "documento"], ["person", "pessoa"], ["requirement", "requisito"],
  ["divergence", "divergência"], ["protocol_requirement", "protocolo"], ["global_pendency", "pendência global"],
]
const PRIORIDADES: [string, string][] = [["low", "baixa"], ["medium", "média"], ["high", "alta"]]

interface Regra {
  id: number
  name: string
  originPhase: string
  operationalPhase: string
  templateId: number | null
  trigger: any
  creation: any
  originLink: any
  duplicatePolicy: any
  applyResult: any
  autoCreate: boolean
  suggested: boolean
  mandatory: boolean
  isSystemTemplate: boolean
  usedByCount: number
  arquivado: boolean
}
interface Modelo { id: number; name: string }

function novoForm(): any {
  return {
    id: null,
    name: "",
    originPhase: "genealogia",
    operationalPhase: "emissao_documental",
    templateId: null,
    trigger: { type: "document_not_located_missing_information", watchedField: "", condition: "" },
    creation: { mode: "suggest", mandatory: true, defaultSlaDays: "", defaultPriority: "medium" },
    originLink: { type: "document", useDocument: true, usePerson: false, useDivergence: false, useProtocolRequirement: false },
    duplicatePolicy: { mode: "warn" },
    applyResult: { mode: "manual_review", updateTarget: "document", autoResolveIfComplete: false, keepReviewingIfPartial: true },
    arquivado: false,
  }
}

const inputCls = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-white/60"

function authHeaders(): Record<string, string> {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}

export default function RegrasTarefaTransversalTab() {
  const [regras, setRegras] = useState<Regra[]>([])
  const [modelos, setModelos] = useState<Modelo[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState("")
  const [filtro, setFiltro] = useState<"" | "active" | "archived">("")
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<any>(novoForm())
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/gerenciamento/regras-tarefa-transversal")
      if (r.ok) setRegras((await r.json()).regras || [])
    } catch { /* silencioso */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    carregar()
    fetch("/api/gerenciamento/modelos-tarefa-transversal")
      .then(r => (r.ok ? r.json() : { modelos: [] }))
      .then(d => setModelos((d.modelos || []).map((m: any) => ({ id: m.id, name: m.name }))))
      .catch(() => {})
  }, [carregar])

  const modeloNome = (id: number | null) => (id ? modelos.find(m => m.id === id)?.name || "—" : "—")

  function abrirNovo() { setForm(novoForm()); setModalOpen(true) }
  function abrirEditar(r: Regra) {
    const base = novoForm()
    setForm({
      ...base,
      id: r.id,
      name: r.name,
      originPhase: r.originPhase,
      operationalPhase: r.operationalPhase,
      templateId: r.templateId,
      trigger: { ...base.trigger, ...(r.trigger || {}) },
      creation: { ...base.creation, ...(r.creation || {}), defaultSlaDays: (r.creation && r.creation.defaultSlaDays != null) ? r.creation.defaultSlaDays : "" },
      originLink: { ...base.originLink, ...(r.originLink || {}) },
      duplicatePolicy: { ...base.duplicatePolicy, ...(r.duplicatePolicy || {}) },
      applyResult: { ...base.applyResult, ...(r.applyResult || {}) },
      arquivado: r.arquivado,
    })
    setModalOpen(true)
  }

  function montarBody(f: any): any {
    const auto = f.creation.mode === "auto"
    const sla = f.creation.defaultSlaDays === "" || f.creation.defaultSlaDays == null ? null : Number(f.creation.defaultSlaDays)
    return {
      name: (f.name || "").trim(),
      originPhase: f.originPhase,
      operationalPhase: f.operationalPhase,
      templateId: f.templateId,
      trigger: { type: f.trigger.type, watchedField: f.trigger.watchedField || "", condition: f.trigger.condition || "" },
      creation: { ...f.creation, defaultSlaDays: sla },
      originLink: f.originLink,
      duplicatePolicy: f.duplicatePolicy,
      applyResult: f.applyResult,
      autoCreate: auto,
      suggested: !auto,
      mandatory: f.creation.mandatory,
      arquivado: f.arquivado,
    }
  }

  async function salvar() {
    if (!form.name.trim()) { alert("Dê um nome à regra."); return }
    if (!form.templateId) { alert("Escolha o modelo de tarefa transversal."); return }
    setSalvando(true)
    const body = montarBody(form)
    try {
      let r: Response
      if (form.id) {
        r = await fetch(`/api/gerenciamento/regras-tarefa-transversal/${form.id}`, { method: "PUT", headers: authHeaders(), body: JSON.stringify(body) })
      } else {
        r = await fetch("/api/gerenciamento/regras-tarefa-transversal", { method: "POST", headers: authHeaders(), body: JSON.stringify(body) })
      }
      if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || "Erro ao salvar."); return }
      setModalOpen(false)
      await carregar()
    } catch { alert("Erro ao salvar.") }
    finally { setSalvando(false) }
  }

  async function duplicar(r: Regra) {
    const merged = { ...novoForm(), ...r, name: r.name + " (cópia)", creation: { ...novoForm().creation, ...(r.creation || {}), defaultSlaDays: (r.creation && r.creation.defaultSlaDays != null) ? r.creation.defaultSlaDays : "" } }
    const res = await fetch("/api/gerenciamento/regras-tarefa-transversal", { method: "POST", headers: authHeaders(), body: JSON.stringify(montarBody(merged)) })
    if (res.ok) carregar(); else alert("Erro ao duplicar.")
  }

  async function toggleArquivo(r: Regra) {
    const res = await fetch(`/api/gerenciamento/regras-tarefa-transversal/${r.id}`, { method: "PUT", headers: authHeaders(), body: JSON.stringify({ arquivado: !r.arquivado }) })
    if (res.ok) carregar()
  }

  async function excluir(r: Regra) {
    if (!confirm(`Excluir a regra "${r.name}"?`)) return
    const res = await fetch(`/api/gerenciamento/regras-tarefa-transversal/${r.id}`, { method: "DELETE", headers: authHeaders() })
    if (res.ok) { carregar(); return }
    const e = await res.json().catch(() => ({}))
    alert(e.error || "Não foi possível excluir.")
  }

  let lista = regras
  if (filtro === "active") lista = lista.filter(r => !r.arquivado)
  else if (filtro === "archived") lista = lista.filter(r => r.arquivado)
  if (busca.trim()) {
    const q = busca.toLowerCase()
    lista = lista.filter(r => r.name.toLowerCase().includes(q))
  }

  const setF = (patch: any) => setForm((f: any) => ({ ...f, ...patch }))
  const setTR = (patch: any) => setForm((f: any) => ({ ...f, trigger: { ...f.trigger, ...patch } }))
  const setCR = (patch: any) => setForm((f: any) => ({ ...f, creation: { ...f.creation, ...patch } }))
  const setOL = (patch: any) => setForm((f: any) => ({ ...f, originLink: { ...f.originLink, ...patch } }))
  const setDP = (patch: any) => setForm((f: any) => ({ ...f, duplicatePolicy: { ...f.duplicatePolicy, ...patch } }))
  const setAP = (patch: any) => setForm((f: any) => ({ ...f, applyResult: { ...f.applyResult, ...patch } }))

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-white">Regras de Tarefas Transversais</h2>
        <p className="mt-1 text-sm text-white/60">
          Quando cada tarefa transversal deve aparecer sozinha — gatilho + condição por fase.
          Ex.: faltou local de nascimento na Genealogia → sugerir uma emissão investigativa.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar regra…" className={`${inputCls} max-w-xs`} />
        <select value={filtro} onChange={e => setFiltro(e.target.value as any)} className={`${inputCls} w-auto`}>
          <option value="" className="bg-zinc-900">Todos</option>
          <option value="active" className="bg-zinc-900">Ativos</option>
          <option value="archived" className="bg-zinc-900">Arquivados</option>
        </select>
        <button onClick={abrirNovo} className="ml-auto rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">
          + Nova regra
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs text-white/50">
              <th className="px-3 py-2 font-medium">Regra</th>
              <th className="px-3 py-2 font-medium">Fase de origem</th>
              <th className="px-3 py-2 font-medium">Operação</th>
              <th className="px-3 py-2 font-medium">Modelo</th>
              <th className="px-3 py-2 font-medium">Modo</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-white/40">Carregando…</td></tr>
            ) : lista.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-white/40">Nenhuma regra. Clique em “+ Nova regra”.</td></tr>
            ) : lista.map(r => (
              <tr key={r.id} className="border-b border-white/5 last:border-0">
                <td className="px-3 py-2.5">
                  <div className="font-medium text-white">{r.name}</div>
                  <div className="text-xs text-white/40">{TRIGGERS[r.trigger?.type] || r.trigger?.type || "—"}</div>
                </td>
                <td className="px-3 py-2.5 text-white/70">{faseLabel(r.originPhase)}</td>
                <td className="px-3 py-2.5 text-white/70">{faseLabel(r.operationalPhase)}</td>
                <td className="px-3 py-2.5 text-white/70">{modeloNome(r.templateId)}</td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {r.autoCreate
                      ? <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">cria automático</span>
                      : <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">sugere</span>}
                    {r.mandatory && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">obrigatória</span>}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  {r.arquivado
                    ? <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">arquivado</span>
                    : <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] text-green-300">ativo</span>}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    <IconBtn title="Editar" onClick={() => abrirEditar(r)}><PencilIcon /></IconBtn>
                    <IconBtn title="Duplicar" onClick={() => duplicar(r)}><CopyIcon /></IconBtn>
                    <IconBtn title={r.arquivado ? "Reativar" : "Arquivar"} onClick={() => toggleArquivo(r)}>{r.arquivado ? <RotateIcon /> : <ArchiveIcon />}</IconBtn>
                    {(r.usedByCount || 0) === 0 && <IconBtn title="Excluir" danger onClick={() => excluir(r)}><TrashIcon /></IconBtn>}
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
              <h3 className="text-base font-semibold text-white">{form.id ? "Editar" : "Nova"} regra de tarefa transversal</h3>
            </div>

            <div className="grid grid-cols-2 gap-3 p-5">
              <div className="col-span-2">
                <label className={labelCls}>Nome *</label>
                <input value={form.name} onChange={e => setF({ name: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Fase de origem *</label>
                <select value={form.originPhase} onChange={e => setF({ originPhase: e.target.value })} className={inputCls}>
                  {FASES.map(([k, v]) => <option key={k} value={k} className="bg-zinc-900">{v}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Operação usada *</label>
                <select value={form.operationalPhase} onChange={e => setF({ operationalPhase: e.target.value })} className={inputCls}>
                  {FASES.map(([k, v]) => <option key={k} value={k} className="bg-zinc-900">{v}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Gatilho *</label>
                <select value={form.trigger.type} onChange={e => setTR({ type: e.target.value })} className={inputCls}>
                  {Object.entries(TRIGGERS).map(([k, v]) => <option key={k} value={k} className="bg-zinc-900">{v}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Modelo de tarefa transversal *</label>
                <select value={form.templateId ?? ""} onChange={e => setF({ templateId: e.target.value ? parseInt(e.target.value) : null })} className={inputCls}>
                  <option value="" className="bg-zinc-900">—</option>
                  {modelos.map(m => <option key={m.id} value={m.id} className="bg-zinc-900">{m.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Campo observado</label>
                <input value={form.trigger.watchedField} onChange={e => setTR({ watchedField: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Condição (opcional)</label>
                <input value={form.trigger.condition} onChange={e => setTR({ condition: e.target.value })} className={inputCls} />
              </div>

              <Secao titulo="Criação" />
              <div>
                <label className={labelCls}>Modo de criação *</label>
                <select value={form.creation.mode} onChange={e => setCR({ mode: e.target.value })} className={inputCls}>
                  <option value="suggest" className="bg-zinc-900">Sugerir (com confirmação)</option>
                  <option value="auto" className="bg-zinc-900">Criar automaticamente</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Obrigatória?</label>
                <select value={form.creation.mandatory ? "1" : "0"} onChange={e => setCR({ mandatory: e.target.value === "1" })} className={inputCls}>
                  <option value="1" className="bg-zinc-900">Sim</option>
                  <option value="0" className="bg-zinc-900">Não</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>SLA (dias)</label>
                <input type="number" value={form.creation.defaultSlaDays} onChange={e => setCR({ defaultSlaDays: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Prioridade</label>
                <select value={form.creation.defaultPriority} onChange={e => setCR({ defaultPriority: e.target.value })} className={inputCls}>
                  {PRIORIDADES.map(([k, v]) => <option key={k} value={k} className="bg-zinc-900">{v}</option>)}
                </select>
              </div>

              <Secao titulo="Vínculo e duplicidade" />
              <div>
                <label className={labelCls}>Tipo de vínculo</label>
                <select value={form.originLink.type} onChange={e => setOL({ type: e.target.value })} className={inputCls}>
                  {LINK_TYPES.map(([k, v]) => <option key={k} value={k} className="bg-zinc-900">{v}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Política de duplicidade</label>
                <select value={form.duplicatePolicy.mode} onChange={e => setDP({ mode: e.target.value })} className={inputCls}>
                  {DUP_MODES.map(([k, v]) => <option key={k} value={k} className="bg-zinc-900">{v}</option>)}
                </select>
              </div>
              <div className="col-span-2 flex flex-wrap gap-x-4 gap-y-1.5">
                <Chk label="Usar documento" checked={form.originLink.useDocument} onChange={v => setOL({ useDocument: v })} />
                <Chk label="Usar pessoa" checked={form.originLink.usePerson} onChange={v => setOL({ usePerson: v })} />
                <Chk label="Usar divergência" checked={form.originLink.useDivergence} onChange={v => setOL({ useDivergence: v })} />
                <Chk label="Usar protocolo" checked={form.originLink.useProtocolRequirement} onChange={v => setOL({ useProtocolRequirement: v })} />
              </div>

              <Secao titulo="Aplicação do resultado" />
              <div>
                <label className={labelCls}>Modo de aplicação *</label>
                <select value={form.applyResult.mode} onChange={e => setAP({ mode: e.target.value })} className={inputCls}>
                  {APPLY_MODES.map(([k, v]) => <option key={k} value={k} className="bg-zinc-900">{v}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>O que atualizar</label>
                <select value={form.applyResult.updateTarget} onChange={e => setAP({ updateTarget: e.target.value })} className={inputCls}>
                  {UPDATE_TARGETS.map(([k, v]) => <option key={k} value={k} className="bg-zinc-900">{v}</option>)}
                </select>
              </div>
              <div className="col-span-2 flex flex-wrap gap-x-4 gap-y-1.5">
                <Chk label="Resolver pendência se resultado completo" checked={form.applyResult.autoResolveIfComplete} onChange={v => setAP({ autoResolveIfComplete: v })} />
                <Chk label="Manter em revisão se parcial" checked={form.applyResult.keepReviewingIfPartial} onChange={v => setAP({ keepReviewingIfPartial: v })} />
              </div>

              <div className="col-span-2">
                <label className={labelCls}>Status</label>
                <select value={form.arquivado ? "archived" : "active"} onChange={e => setF({ arquivado: e.target.value === "archived" })} className={inputCls}>
                  <option value="active" className="bg-zinc-900">ativo</option>
                  <option value="archived" className="bg-zinc-900">arquivado</option>
                </select>
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
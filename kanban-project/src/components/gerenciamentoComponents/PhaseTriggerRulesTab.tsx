"use client"

import { useEffect, useState, useCallback } from "react"

// ============================================================
// Tipos
// ============================================================
interface Trigger {
  id: number
  itemCode: string
  financialItemId: number | null
  name: string
  phaseKey: string
  phaseEvent: string
  entryType: string
  automatic: boolean
  requiresContractSigned: boolean
  requiresProposalApproved: boolean
  allowRepeat: boolean
}
interface Produto { id: number; codigo: string; nome: string; naturezaFinanceira: string | null }
interface Data { triggers: Trigger[]; produtos: Produto[] }

// ============================================================
// Constantes
// ============================================================
const PHASE_ORDER = ["genealogia", "emissao_documental", "analise_documental", "retificacao", "emissao_documental_retificada", "traducao", "apostilamento", "aguardando_protocolo", "protocolado", "finalizado"]
const PHASE_LABELS: Record<string, string> = {
  genealogia: "Genealogia", emissao_documental: "Emissão Documental", analise_documental: "Análise Documental",
  retificacao: "Retificação", emissao_documental_retificada: "Emissão Documental Retificada", traducao: "Tradução",
  apostilamento: "Apostilamento", aguardando_protocolo: "Aguardando Protocolo", protocolado: "Protocolado", finalizado: "Finalizado",
}
const EVENT_LABELS: Record<string, string> = {
  entered: "Ao entrar na fase", completed: "Ao concluir a fase", reopened: "Ao reabrir a fase", blocked: "Ao bloquear a fase",
}
const EVENTS = Object.keys(EVENT_LABELS)

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}
const inputCls = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-white/60"
const opt = "bg-zinc-900"

const IEdit = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>)
const ITrash = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>)

type Form = {
  id?: number; itemCode: string; phaseKey: string; phaseEvent: string; entryType: string
  automatic: boolean; requiresContractSigned: boolean; requiresProposalApproved: boolean; allowRepeat: boolean
}
const blankForm = (phaseKey: string): Form => ({
  itemCode: "", phaseKey, phaseEvent: "entered", entryType: "revenue",
  automatic: true, requiresContractSigned: false, requiresProposalApproved: false, allowRepeat: false,
})

// ============================================================
// Componente
// ============================================================
export default function PhaseTriggerRulesTab() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState("")
  const [form, setForm] = useState<Form | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/gerenciamento/disparo-fase", { headers: authHeaders() })
      if (res.ok) setData(await res.json())
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const showFlash = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 2800) }
  const upsertLocal = (t: Trigger) => setData(d => {
    if (!d) return d
    const i = d.triggers.findIndex(x => x.id === t.id); const triggers = d.triggers.slice()
    if (i < 0) triggers.push(t); else triggers[i] = t
    return { ...d, triggers }
  })
  const removeLocal = (id: number) => setData(d => d ? { ...d, triggers: d.triggers.filter(x => x.id !== id) } : d)

  const triggersOf = (phaseKey: string) => (data?.triggers || []).filter(t => t.phaseKey === phaseKey)

  function onPickItem(code: string) {
    setForm(f => {
      if (!f) return f
      const p = data?.produtos.find(x => x.codigo === code)
      const nat = p?.naturezaFinanceira
      const entryType = nat === "cost" || nat === "revenue" ? nat : f.entryType
      return { ...f, itemCode: code, entryType }
    })
  }

  async function saveForm() {
    if (!form) return
    if (!form.itemCode) { showFlash("Escolha o item financeiro."); return }
    if (!form.phaseKey) { showFlash("Escolha a fase."); return }
    setBusy(true)
    try {
      const url = form.id ? `/api/gerenciamento/disparo-fase/${form.id}` : "/api/gerenciamento/disparo-fase"
      const res = await fetch(url, { method: form.id ? "PUT" : "POST", headers: authHeaders(), body: JSON.stringify(form) })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.trigger) { upsertLocal(j.trigger); setForm(null); showFlash(form.id ? "Regra salva." : "Regra criada.") }
      else showFlash(j.error || "Erro ao salvar.")
    } finally { setBusy(false) }
  }

  async function del(t: Trigger) {
    if (!confirm(`Excluir a regra de disparo "${t.name}"?`)) return
    removeLocal(t.id) // otimista
    const res = await fetch(`/api/gerenciamento/disparo-fase/${t.id}`, { method: "DELETE", headers: authHeaders() })
    if (res.ok) showFlash("Regra excluída.")
    else { showFlash("Erro ao excluir."); load() }
  }

  function openNew(phaseKey: string) { setForm(blankForm(phaseKey)) }
  function openEdit(t: Trigger) {
    setForm({
      id: t.id, itemCode: t.itemCode, phaseKey: t.phaseKey, phaseEvent: t.phaseEvent, entryType: t.entryType,
      automatic: t.automatic, requiresContractSigned: t.requiresContractSigned,
      requiresProposalApproved: t.requiresProposalApproved, allowRepeat: t.allowRepeat,
    })
  }

  if (loading) return <div className="py-24 text-center text-white/50">Carregando…</div>

  const semProdutos = (data?.produtos || []).length === 0

  return (
    <div className="space-y-5">
      {flash && <div className="rounded-xl border border-green-400/30 bg-green-500/15 px-4 py-3 text-sm text-green-200">{flash}</div>}

      {/* cabeçalho */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Regras de Disparo por Fase</h2>
            <p className="mt-1 text-sm text-white/60">Vinculam um item do Catálogo Financeiro a um evento da fase (ex.: ao entrar na fase, criar uma receita). Valem para todos os processos. <span className="text-white/40">A execução real vem na Fase 4.</span></p>
          </div>
          <button onClick={() => openNew("genealogia")} className="flex-none rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500">+ Nova Regra de Disparo</button>
        </div>
        {semProdutos && <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">Nenhum produto no Catálogo Financeiro ainda. Cadastre produtos em “Produtos e Serviços” para usá-los aqui.</div>}
      </div>

      {/* grade de fases */}
      <div className="grid gap-3 md:grid-cols-2">
        {PHASE_ORDER.map(pk => {
          const list = triggersOf(pk)
          return (
            <div key={pk} className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-semibold text-white">{PHASE_LABELS[pk] || pk}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] ${list.length ? "bg-green-500/15 text-green-300" : "bg-white/10 text-white/50"}`}>{list.length ? `${list.length} disparo${list.length > 1 ? "s" : ""}` : "sem regras"}</span>
              </div>

              {list.length === 0 ? (
                <div className="text-xs text-white/40">Nenhuma regra de disparo.</div>
              ) : (
                <div className="space-y-1.5">
                  {list.map(t => (
                    <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-xs text-white">{data?.produtos.find(p => p.codigo === t.itemCode)?.nome || t.itemCode}</span>
                          <span className={`rounded px-1.5 py-0.5 text-[9px] ${t.entryType === "cost" ? "bg-amber-500/15 text-amber-300" : "bg-green-500/15 text-green-300"}`}>{t.entryType === "cost" ? "custo" : "receita"}</span>
                          {!t.automatic && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] text-white/50">sugestão</span>}
                        </div>
                        <div className="text-[10px] text-white/40">{EVENT_LABELS[t.phaseEvent] || t.phaseEvent}</div>
                      </div>
                      <div className="flex flex-none items-center gap-0.5 text-white/50">
                        <button title="Editar" aria-label="Editar" onClick={() => openEdit(t)} className="rounded p-1 hover:bg-white/10 hover:text-white"><IEdit /></button>
                        <button title="Excluir" aria-label="Excluir" onClick={() => del(t)} className="rounded p-1 text-red-300/70 hover:bg-red-500/10 hover:text-red-300"><ITrash /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={() => openNew(pk)} className="mt-2.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/70 hover:bg-white/10">+ Disparo financeiro</button>
            </div>
          )
        })}
      </div>

      {/* MODAL — nova/editar regra */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setForm(null)}>
          <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="border-b border-white/10 px-6 py-4">
              <h3 className="font-semibold text-white">{form.id ? "Editar" : "Nova"} · Regra de Disparo por Fase</h3>
            </div>
            <div className="grid grid-cols-2 gap-3 px-6 py-4">
              <div className="col-span-2">
                <label className={labelCls}>Item financeiro *</label>
                <select value={form.itemCode} onChange={e => onPickItem(e.target.value)} className={inputCls}>
                  <option value="" className={opt}>— Selecione um item —</option>
                  {data?.produtos.map(p => <option key={p.id} value={p.codigo} className={opt}>{p.codigo} · {p.nome}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Fase</label>
                <select value={form.phaseKey} onChange={e => setForm(f => f && { ...f, phaseKey: e.target.value })} className={inputCls}>
                  {PHASE_ORDER.map(pk => <option key={pk} value={pk} className={opt}>{PHASE_LABELS[pk]}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Evento</label>
                <select value={form.phaseEvent} onChange={e => setForm(f => f && { ...f, phaseEvent: e.target.value })} className={inputCls}>
                  {EVENTS.map(ev => <option key={ev} value={ev} className={opt}>{EVENT_LABELS[ev]}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Ação</label>
                <select value={form.entryType} onChange={e => setForm(f => f && { ...f, entryType: e.target.value })} className={inputCls}>
                  <option value="revenue" className={opt}>Criar receita</option>
                  <option value="cost" className={opt}>Criar custo</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Automático</label>
                <select value={form.automatic ? "1" : "0"} onChange={e => setForm(f => f && { ...f, automatic: e.target.value === "1" })} className={inputCls}>
                  <option value="1" className={opt}>Sim</option>
                  <option value="0" className={opt}>Não (só sugestão)</option>
                </select>
              </div>
              <div className="col-span-2 flex flex-wrap gap-x-5 gap-y-2 pt-1 text-xs text-white/70">
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={form.requiresContractSigned} onChange={e => setForm(f => f && { ...f, requiresContractSigned: e.target.checked })} />Exige contrato assinado</label>
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={form.requiresProposalApproved} onChange={e => setForm(f => f && { ...f, requiresProposalApproved: e.target.checked })} />Exige proposta aprovada</label>
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={form.allowRepeat} onChange={e => setForm(f => f && { ...f, allowRepeat: e.target.checked })} />Permite repetição</label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-white/10 px-6 py-4">
              <button onClick={() => setForm(null)} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10">Cancelar</button>
              <button disabled={busy} onClick={saveForm} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
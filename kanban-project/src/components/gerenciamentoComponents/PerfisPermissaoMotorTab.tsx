// src/components/gerenciamentoComponents/PerfisPermissaoMotorTab.tsx
"use client"

import { useEffect, useState, useCallback, type ReactNode } from "react"
import { useApi } from "@/src/lib/dados"

const PERMISSOES: [string, string][] = [
  ["manageProcessTypes", "Gerenciar Processos de Nacionalidade"],
  ["manageWorkflowMacro", "Gerenciar Workflow Macro"],
  ["manageTemplates", "Gerenciar Modelos"],
  ["applyTemplates", "Aplicar Modelos"],
  ["manageAutomations", "Gerenciar Automações"],
  ["manageFinancialRules", "Gerenciar Regras Financeiras"],
  ["manageDocumentMatrix", "Gerenciar Matriz Documental"],
  ["publishConfiguration", "Publicar Configuração"],
  ["deleteUnusedItems", "Excluir Itens Não Usados"],
  ["archiveItems", "Arquivar Itens"],
  ["viewAudit", "Ver Auditoria"],
  ["viewFinancial", "Ver Financeiro"],
]

interface Perfil {
  id: number
  chave: string
  nome: string
  permissoes: Record<string, boolean> | null
  isSystemTemplate: boolean
  usedByCount: number
  arquivado: boolean
}

function novoForm(): any {
  const permissoes: Record<string, boolean> = {}
  PERMISSOES.forEach(([k]) => (permissoes[k] = false))
  return { id: null, nome: "", chave: "", permissoes, arquivado: false }
}

const inputCls = "w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-[var(--text-secondary)]"

function authHeaders(): Record<string, string> {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}

export default function PerfisPermissaoMotorTab() {
  // Leitura pela camada oficial. A falha segue silenciosa de propósito: a tela
  // mostra a lista vazia em vez de um erro, como antes.
  const consulta = useApi<{ perfis?: Perfil[] }>("/api/gerenciamento/perfis-permissao-motor")
  const perfis = consulta.dados?.perfis ?? []
  const loading = consulta.carregando
  const carregar = consulta.recarregar
  const [busca, setBusca] = useState("")
  const [filtro, setFiltro] = useState<"" | "active" | "archived">("")
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<any>(novoForm())
  const [salvando, setSalvando] = useState(false)


  const contaOn = (p: Perfil) => PERMISSOES.filter(([k]) => p.permissoes && p.permissoes[k]).length

  function abrirNovo() { setForm(novoForm()); setModalOpen(true) }
  function abrirEditar(p: Perfil) {
    const base = novoForm()
    setForm({
      ...base,
      id: p.id,
      nome: p.nome,
      chave: p.chave || "",
      permissoes: { ...base.permissoes, ...(p.permissoes || {}) },
      arquivado: p.arquivado,
    })
    setModalOpen(true)
  }

  async function salvar() {
    if (!form.nome.trim()) { alert("Dê um nome ao perfil."); return }
    setSalvando(true)
    const body: any = { nome: form.nome.trim(), permissoes: form.permissoes, arquivado: form.arquivado }
    if (form.chave.trim()) body.chave = form.chave.trim()
    try {
      let r: Response
      if (form.id) {
        r = await fetch(`/api/gerenciamento/perfis-permissao-motor/${form.id}`, { method: "PUT", headers: authHeaders(), body: JSON.stringify(body) })
      } else {
        r = await fetch("/api/gerenciamento/perfis-permissao-motor", { method: "POST", headers: authHeaders(), body: JSON.stringify(body) })
      }
      if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || "Erro ao salvar."); return }
      setModalOpen(false)
      await carregar()
    } catch { alert("Erro ao salvar.") }
    finally { setSalvando(false) }
  }

  async function duplicar(p: Perfil) {
    const body: any = { nome: p.nome + " (cópia)", permissoes: p.permissoes || {} }
    const r = await fetch("/api/gerenciamento/perfis-permissao-motor", { method: "POST", headers: authHeaders(), body: JSON.stringify(body) })
    if (r.ok) carregar(); else alert("Erro ao duplicar.")
  }

  async function toggleArquivo(p: Perfil) {
    const r = await fetch(`/api/gerenciamento/perfis-permissao-motor/${p.id}`, { method: "PUT", headers: authHeaders(), body: JSON.stringify({ arquivado: !p.arquivado }) })
    if (r.ok) carregar()
  }

  async function excluir(p: Perfil) {
    if (!confirm(`Excluir o perfil "${p.nome}"?`)) return
    const r = await fetch(`/api/gerenciamento/perfis-permissao-motor/${p.id}`, { method: "DELETE", headers: authHeaders() })
    if (r.ok) { carregar(); return }
    const e = await r.json().catch(() => ({}))
    alert(e.error || "Não foi possível excluir.")
  }

  let lista = perfis
  if (filtro === "active") lista = lista.filter(p => !p.arquivado)
  else if (filtro === "archived") lista = lista.filter(p => p.arquivado)
  if (busca.trim()) {
    const q = busca.toLowerCase()
    lista = lista.filter(p => (p.nome + " " + (p.chave || "")).toLowerCase().includes(q))
  }

  const setF = (patch: any) => setForm((f: any) => ({ ...f, ...patch }))
  const togglePerm = (k: string) => setForm((f: any) => ({ ...f, permissoes: { ...f.permissoes, [k]: !f.permissoes[k] } }))
  const marcarTodas = (val: boolean) => setForm((f: any) => {
    const permissoes: Record<string, boolean> = {}
    PERMISSOES.forEach(([k]) => (permissoes[k] = val))
    return { ...f, permissoes }
  })

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-white">Usuários e Permissões</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Perfis de permissão para ações críticas do Gerenciamento. Marque o que cada perfil pode fazer.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar perfil…" className={`${inputCls} max-w-xs`} />
        <select value={filtro} onChange={e => setFiltro(e.target.value as any)} className={`${inputCls} w-auto`}>
          <option value="" className="bg-zinc-900">Todos</option>
          <option value="active" className="bg-zinc-900">Ativos</option>
          <option value="archived" className="bg-zinc-900">Arquivados</option>
        </select>
        <button onClick={abrirNovo} className="ml-auto rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)]">
          + Novo perfil
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]">
              <th className="px-3 py-2 font-medium">Perfil</th>
              <th className="px-3 py-2 font-medium">Permissões</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 text-center font-medium">Usado em</th>
              <th className="px-3 py-2 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-[var(--text-muted)]">Carregando…</td></tr>
            ) : lista.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-[var(--text-muted)]">Nenhum perfil. Clique em “+ Novo perfil”.</td></tr>
            ) : lista.map(p => (
              <tr key={p.id} className="border-b border-[var(--border-subtle)] last:border-0">
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">{p.nome}</span>
                    {p.isSystemTemplate && <span className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">padrão</span>}
                  </div>
                  {p.chave && <div className="text-xs text-[var(--text-muted)]">{p.chave}</div>}
                </td>
                <td className="px-3 py-2.5 text-white/70">{contaOn(p)} de {PERMISSOES.length} permissões</td>
                <td className="px-3 py-2.5">
                  {p.arquivado
                    ? <span className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">arquivado</span>
                    : <span className="rounded bg-[var(--surface-secondary)] px-1.5 py-0.5 text-[10px] text-green-800">ativo</span>}
                </td>
                <td className="px-3 py-2.5 text-center text-[var(--text-secondary)]">{p.usedByCount || 0}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    <IconBtn title="Editar" onClick={() => abrirEditar(p)}><PencilIcon /></IconBtn>
                    <IconBtn title="Duplicar" onClick={() => duplicar(p)}><CopyIcon /></IconBtn>
                    <IconBtn title={p.arquivado ? "Reativar" : "Arquivar"} onClick={() => toggleArquivo(p)}>{p.arquivado ? <RotateIcon /> : <ArchiveIcon />}</IconBtn>
                    {(p.usedByCount || 0) === 0 && <IconBtn title="Excluir" danger onClick={() => excluir(p)}><TrashIcon /></IconBtn>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-modal)] p-4 backdrop-blur-sm" onClick={() => setModalOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-[var(--border-default)] bg-zinc-900/95 shadow-[var(--elev-3)]" onClick={e => e.stopPropagation()}>
            <div className="border-b border-[var(--border-default)] px-5 py-4">
              <h3 className="text-base font-semibold text-white">{form.id ? "Editar" : "Novo"} perfil de permissão</h3>
            </div>

            <div className="grid grid-cols-2 gap-3 p-5">
              <div className="col-span-2">
                <label className={labelCls}>Nome *</label>
                <input value={form.nome} onChange={e => setF({ nome: e.target.value })} className={inputCls} />
              </div>
              {/* Chave técnica interna gerada no backend — nunca informada nem exibida ao operador. */}
              <div className="col-span-2">
                <label className={labelCls}>Status</label>
                <select value={form.arquivado ? "archived" : "active"} onChange={e => setF({ arquivado: e.target.value === "archived" })} className={inputCls}>
                  <option value="active" className="bg-zinc-900">ativo</option>
                  <option value="archived" className="bg-zinc-900">arquivado</option>
                </select>
              </div>

              <div className="col-span-2">
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs text-[var(--text-secondary)]">Permissões</label>
                  <div className="flex gap-2 text-[11px]">
                    <button type="button" onClick={() => marcarTodas(true)} className="text-[var(--text-secondary)] hover:text-white">marcar todas</button>
                    <span className="text-[var(--text-muted)]">·</span>
                    <button type="button" onClick={() => marcarTodas(false)} className="text-[var(--text-secondary)] hover:text-white">limpar</button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-3 sm:grid-cols-2">
                  {PERMISSOES.map(([k, label]) => (
                    <label key={k} className="flex items-center gap-2 text-xs text-white/80">
                      <input type="checkbox" checked={!!form.permissoes[k]} onChange={() => togglePerm(k)} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-[var(--border-default)] px-5 py-4">
              <button onClick={() => setModalOpen(false)} className="rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm text-white/70 hover:bg-[var(--surface-hover)]">Cancelar</button>
              <button onClick={salvar} disabled={salvando} className="rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)] disabled:opacity-60">
                {salvando ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function IconBtn({ children, title, onClick, danger }: { children: ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button title={title} aria-label={title} onClick={onClick}
      className={`rounded-md p-1.5 hover:bg-[var(--surface-hover)] ${danger ? "text-red-700/80 hover:text-red-700" : "text-[var(--text-secondary)] hover:text-white"}`}>
      {children}
    </button>
  )
}
const PencilIcon = () => <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
const CopyIcon = () => <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
const ArchiveIcon = () => <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="5" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></svg>
const RotateIcon = () => <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 2v6h6" /><path d="M3 8a9 9 0 1 0 3-5.7L3 8" /></svg>
const TrashIcon = () => <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
"use client"

// src/components/gerenciamentoComponents/CatalogoFasesTab.tsx
// PROCESSOS → ESTRUTURA → FASES.
// Cadastro ÚNICO das fases do sistema (CatalogoFase). O Workflow Macro só
// REFERENCIA estas fases ao montar a sequência de cada processo — nenhum outro
// módulo cadastra fase.
// Backend: /api/gerenciamento/catalogo-fases (GET/POST) + /[id] (PUT/DELETE)

import { useEffect, useState, useCallback } from "react"
import { useApi } from "@/src/lib/dados"

interface Fase {
  id: number
  phaseKey: string
  label: string
  ordemPadrao: number
  requiredPadrao: boolean
  conditionalPadrao: boolean
  slaDiasPadrao: number
  ativo: boolean
  usos: number
}

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}
const inputCls = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-white/60"
const IEdit = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>)
const ITrash = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>)

type Form = {
  id?: number
  phaseKey: string
  label: string
  ordemPadrao: number
  requiredPadrao: boolean
  conditionalPadrao: boolean
  slaDiasPadrao: number
  ativo: boolean
}

const vazio = (ordem: number): Form => ({
  phaseKey: "", label: "", ordemPadrao: ordem, requiredPadrao: true,
  conditionalPadrao: false, slaDiasPadrao: 30, ativo: true,
})

export default function CatalogoFasesTab() {
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState("")
  // Erro de ESCRITA continua em estado; o de LEITURA vem da consulta.
  const [erroEscrita, setErroEscrita] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)

  // Leitura pela camada oficial: cache, dedupe e revalidação únicos, em lugar do
  // `load` + `useEffect(() => load(), [load])` que cada aba reimplementava.
  const consulta = useApi<{ fases?: Fase[] }>("/api/gerenciamento/catalogo-fases")
  const rows = consulta.dados?.fases ?? []
  const loading = consulta.carregando
  // A mensagem original era a mesma para falha de rede e para erro do servidor.
  const erro = erroEscrita ?? (consulta.erro ? consulta.erro.message : null)
  const setErro = setErroEscrita
  const load = consulta.recarregar
  // As telas atualizavam a lista na mão depois de salvar/excluir, com a entidade
  // que o servidor devolveu. Isso continua: a mesma transformação entra no cache
  // como dado otimista e o SWR confirma com o servidor em seguida — a tela responde
  // na hora e não fica divergindo do banco.
  const atualizarLista = (fn: (rs: Fase[]) => Fase[]) => { void consulta.recarregar({ fases: fn(rows) }) }

  const showFlash = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 3000) }

  async function save() {
    if (!form) return
    if (!form.label.trim()) { showFlash("Informe o nome da fase."); return }
    setBusy(true)
    try {
      const url = form.id ? `/api/gerenciamento/catalogo-fases/${form.id}` : "/api/gerenciamento/catalogo-fases"
      const res = await fetch(url, { method: form.id ? "PUT" : "POST", headers: authHeaders(), body: JSON.stringify(form) })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.fase) {
        atualizarLista(rs => {
          const i = rs.findIndex(x => x.id === j.fase.id)
          const next = i < 0 ? [...rs, j.fase] : rs.map(x => (x.id === j.fase.id ? j.fase : x))
          return next.sort((x, y) => x.ordemPadrao - y.ordemPadrao || x.label.localeCompare(y.label))
        })
        setForm(null); showFlash("Fase salva.")
      } else showFlash(j.error || "Erro ao salvar a fase.")
    } finally { setBusy(false) }
  }

  async function del(f: Fase) {
    if (f.usos > 0) { showFlash(`"${f.label}" é usada em ${f.usos} fluxo(s). Inative em vez de excluir.`); return }
    if (!confirm(`Excluir a fase "${f.label}" do catálogo? Só é possível porque nenhum fluxo a utiliza.`)) return
    const res = await fetch(`/api/gerenciamento/catalogo-fases/${f.id}`, { method: "DELETE", headers: authHeaders() })
    const j = await res.json().catch(() => ({}))
    if (res.ok) { atualizarLista(rs => rs.filter(x => x.id !== f.id)); showFlash("Fase excluída.") }
    else showFlash(j.error || "Erro ao excluir a fase.")
  }

  async function toggleAtivo(f: Fase) {
    const res = await fetch(`/api/gerenciamento/catalogo-fases/${f.id}`, {
      method: "PUT", headers: authHeaders(), body: JSON.stringify({ ativo: !f.ativo }),
    })
    const j = await res.json().catch(() => ({}))
    if (res.ok && j.fase) { atualizarLista(rs => rs.map(x => (x.id === f.id ? j.fase : x))); showFlash(j.fase.ativo ? "Fase ativada." : "Fase inativada.") }
    else showFlash(j.error || "Erro ao alterar a fase.")
  }

  const proximaOrdem = rows.length ? Math.max(...rows.map(r => r.ordemPadrao)) + 10 : 10

  if (loading) return <div className="py-24 text-center text-white/50">Carregando…</div>

  return (
    <div className="space-y-5">
      {flash && <div className="rounded-xl border border-green-400/30 bg-green-500/15 px-4 py-3 text-sm text-green-200">{flash}</div>}
      {erro && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {erro} <button onClick={() => { void load() }} className="ml-2 underline hover:text-white">Tentar de novo</button>
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Fases</h2>
            <p className="mt-1 max-w-3xl text-sm text-white/60">
              Cadastro único das fases do sistema. O Workflow apenas referencia estas fases ao montar a
              sequência de cada processo — nenhum outro módulo cadastra fases.
            </p>
          </div>
          <button
            onClick={() => setForm(vazio(proximaOrdem))}
            className="flex-none rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500"
          >
            + Nova fase
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-white/10 text-left text-xs text-white/50">
            <tr>
              <th className="px-4 py-3 font-medium">Ordem</th>
              <th className="px-4 py-3 font-medium">Fase</th>
              <th className="px-4 py-3 font-medium">Chave</th>
              <th className="px-4 py-3 font-medium">Padrões</th>
              <th className="px-4 py-3 font-medium">SLA</th>
              <th className="px-4 py-3 font-medium">Usada em</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-xs text-white/40">Nenhuma fase no catálogo. Cadastre a primeira em “+ Nova fase”.</td></tr>
            ) : rows.map(f => (
              <tr key={f.id} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-2.5 text-white/60">{f.ordemPadrao}</td>
                <td className="px-4 py-2.5 text-white">{f.label}</td>
                <td className="px-4 py-2.5"><code className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white/70">{f.phaseKey}</code></td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1 text-[10px]">
                    {f.requiredPadrao && <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">obrigatória</span>}
                    {f.conditionalPadrao && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">condicional</span>}
                    {!f.requiredPadrao && !f.conditionalPadrao && <span className="text-white/30">—</span>}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-white/70">{f.slaDiasPadrao} d</td>
                <td className="px-4 py-2.5 text-white/60">{f.usos ? `${f.usos} fluxo(s)` : "—"}</td>
                <td className="px-4 py-2.5">
                  <button
                    onClick={() => toggleAtivo(f)}
                    title={f.ativo ? "Inativar (some do seletor de fases, sem apagar)" : "Ativar"}
                    className={`rounded-full px-2 py-0.5 text-[10px] ${f.ativo ? "bg-green-500/15 text-green-300" : "bg-white/10 text-white/50"}`}
                  >
                    {f.ativo ? "Ativa" : "Inativa"}
                  </button>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-0.5 text-white/50">
                    <button
                      title="Editar" aria-label="Editar"
                      onClick={() => setForm({
                        id: f.id, phaseKey: f.phaseKey, label: f.label, ordemPadrao: f.ordemPadrao,
                        requiredPadrao: f.requiredPadrao, conditionalPadrao: f.conditionalPadrao,
                        slaDiasPadrao: f.slaDiasPadrao, ativo: f.ativo,
                      })}
                      className="rounded p-1 hover:bg-white/10 hover:text-white"
                    ><IEdit /></button>
                    <button
                      title={f.usos > 0 ? `Em uso em ${f.usos} fluxo(s) — inative em vez de excluir` : "Excluir"}
                      aria-label="Excluir"
                      disabled={f.usos > 0}
                      onClick={() => del(f)}
                      className="rounded p-1 text-red-300/70 hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30"
                    ><ITrash /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setForm(null)}>
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="border-b border-white/10 px-6 py-4">
              <h3 className="font-semibold text-white">{form.id ? "Editar fase" : "Nova fase"}</h3>
              <p className="mt-0.5 text-xs text-white/50">Os padrões abaixo são sugeridos ao adicionar a fase a um fluxo — cada fluxo pode ajustá-los.</p>
            </div>
            <div className="space-y-3 px-6 py-4">
              <div>
                <label className={labelCls}>Nome da fase *</label>
                <input value={form.label} onChange={e => setForm(f => f && { ...f, label: e.target.value })} className={inputCls} placeholder="Ex.: Emissão de Certidões" />
              </div>
              <div>
                <label className={labelCls}>Chave {form.id ? "(imutável)" : "(gerada do nome se vazia)"}</label>
                <input
                  value={form.phaseKey}
                  disabled={!!form.id}
                  onChange={e => setForm(f => f && { ...f, phaseKey: e.target.value })}
                  className={`${inputCls} disabled:opacity-50`}
                  placeholder="emissao_certidoes"
                />
                {form.id && <p className="mt-1 text-[11px] text-white/40">A chave é o vínculo com fluxos, automações e runtime — não pode ser alterada.</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Ordem padrão</label>
                  <input type="number" value={form.ordemPadrao} onChange={e => setForm(f => f && { ...f, ordemPadrao: Number(e.target.value) })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>SLA padrão (dias)</label>
                  <input type="number" min="0" value={form.slaDiasPadrao} onChange={e => setForm(f => f && { ...f, slaDiasPadrao: Number(e.target.value) })} className={inputCls} />
                </div>
              </div>
              <div className="space-y-1.5 border-t border-white/10 pt-3">
                <label className="flex items-center gap-2 text-sm text-white/70">
                  <input type="checkbox" checked={form.requiredPadrao} onChange={e => setForm(f => f && { ...f, requiredPadrao: e.target.checked })} className="h-3.5 w-3.5 accent-blue-500" />
                  Obrigatória por padrão
                </label>
                <label className="flex items-center gap-2 text-sm text-white/70">
                  <input type="checkbox" checked={form.conditionalPadrao} onChange={e => setForm(f => f && { ...f, conditionalPadrao: e.target.checked })} className="h-3.5 w-3.5 accent-blue-500" />
                  Condicional por padrão
                </label>
                <label className="flex items-center gap-2 text-sm text-white/70">
                  <input type="checkbox" checked={form.ativo} onChange={e => setForm(f => f && { ...f, ativo: e.target.checked })} className="h-3.5 w-3.5 accent-blue-500" />
                  Ativa (aparece no seletor de fases dos fluxos)
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-white/10 px-6 py-4">
              <button onClick={() => setForm(null)} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10">Cancelar</button>
              <button disabled={busy} onClick={save} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

"use client"

import { useEffect, useState, useCallback } from "react"
import DocumentCategorySelector from "./DocumentCategorySelector"
import { CodigoPublicoField } from "./CodigoPublicoField"

interface CatRel { id: number; code: string; name: string; ativo: boolean }

// ── CONTRATO DOCUMENTAL (espelho do DTO da rota) ────────────────────────────
// O que o Tipo de Documento declara sobre COMO ele é processado. A tela só
// referencia: a edição do workflow continua na área de Workflow Interno.
interface WorkflowDoPerfil {
  id: number; name: string; versao: number; active: boolean; phaseKey: string
  escopoExecucao: string | null; exigeDocumento: boolean; exigePessoa: boolean
  _count: { passos: number }
}
interface PerfilOpc {
  id: number; code: string; name: string; descricao: string | null
  escopoInstanciacao: string; exigeProcesso: boolean; exigePessoa: boolean; exigeDocumento: boolean
  familiaDocumental: { id: number; code: string; name: string } | null
  workflow: WorkflowDoPerfil | null
}
interface FamiliaOpc { id: number; code: string; name: string; descricao: string | null }
interface NaturezaOpc { id: number; code: string; name: string; descricao: string | null; exigeWorkflow: boolean }

const LABEL_ESCOPO: Record<string, string> = {
  PROCESSO: "Uma execução por processo",
  PESSOA: "Uma execução por pessoa",
  NECESSIDADE: "Uma execução por registro a localizar",
  DOCUMENTO: "Uma execução por documento",
}
interface Tipo {
  id: number; publicCode?: string | null; code: string | null; name: string; category: string | null
  nature?: string | null; categoriaDocumentalId?: number | null; categoriaDocumental?: CatRel | null; ativo: boolean
  familiaDocumentalId?: number | null; familiaDocumental?: { id: number; code: string; name: string } | null
  naturezaOperacionalId?: number | null; naturezaOperacional?: { id: number; code: string; name: string; exigeWorkflow: boolean } | null
  perfilOperacionalId?: number | null; perfilOperacional?: PerfilOpc | null
}
// Sem lista fixa de categorias na UI: o nome exibido vem da relação canônica
// (categoriaDocumental). Fallback textual só para linhas ainda não migradas.

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}
const inputCls = "w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-[var(--text-secondary)]"
const IEdit = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>)
const ITrash = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>)

type Form = {
  id?: number; publicCode?: string | null; code: string; name: string; category: string
  categoriaDocumentalId: number | null; currentCat?: CatRel | null; ativo: boolean
  familiaDocumentalId: number | null; naturezaOperacionalId: number | null; perfilOperacionalId: number | null
}
const formVazio = (): Form => ({
  code: "", name: "", category: "", categoriaDocumentalId: null, currentCat: null, ativo: true,
  familiaDocumentalId: null, naturezaOperacionalId: null, perfilOperacionalId: null,
})

function LinhaContrato({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[var(--text-secondary)]">{rotulo}</span>
      <span className="text-right text-white/85">{valor}</span>
    </div>
  )
}

export default function TiposDocumentoTab() {
  const [rows, setRows] = useState<Tipo[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState("")
  const [form, setForm] = useState<Form | null>(null)
  const [filtro, setFiltro] = useState<"todos" | "certidoes">("todos")
  // As três listas do contrato vêm numa requisição só: a natureza escolhida
  // decide se o perfil é obrigatório, então elas precisam ser do mesmo instante.
  const [familias, setFamilias] = useState<FamiliaOpc[]>([])
  const [naturezas, setNaturezas] = useState<NaturezaOpc[]>([])
  const [perfis, setPerfis] = useState<PerfilOpc[]>([])

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/gerenciamento/tipos-documento", { headers: authHeaders() })
      if (res.ok) setRows((await res.json()).tipos || [])
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/gerenciamento/contrato-documental", { headers: authHeaders() })
      if (!res.ok) return
      const j = await res.json()
      setFamilias(j.familias || []); setNaturezas(j.naturezas || []); setPerfis(j.perfis || [])
    })()
  }, [])

  const showFlash = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 2600) }
  const upsert = (d: Tipo) => setRows(rs => { const i = rs.findIndex(x => x.id === d.id); if (i < 0) return [...rs, d]; const c = rs.slice(); c[i] = d; return c })

  async function save() {
    if (!form) return
    if (!form.name.trim()) { showFlash("Informe o nome."); return }
    setBusy(true)
    try {
      const url = form.id ? `/api/gerenciamento/tipos-documento/${form.id}` : "/api/gerenciamento/tipos-documento"
      // O frontend NUNCA envia chave técnica: o backend gera/mantém o `code` interno.
      const { code: _code, currentCat: _cat, ...payload } = form
      const res = await fetch(url, { method: form.id ? "PUT" : "POST", headers: authHeaders(), body: JSON.stringify(payload) })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.tipo) { upsert(j.tipo); setForm(null); showFlash("Salvo.") }
      else showFlash(j.error || "Erro ao salvar.")
    } finally { setBusy(false) }
  }
  async function del(d: Tipo) {
    if (!confirm(`Excluir o tipo "${d.name}"?`)) return
    setRows(rs => rs.filter(x => x.id !== d.id))
    const res = await fetch(`/api/gerenciamento/tipos-documento/${d.id}`, { method: "DELETE", headers: authHeaders() })
    if (res.ok) showFlash("Excluído."); else { showFlash("Erro ao excluir."); load() }
  }

  // Derivados do formulário aberto. `exigePerfil` é a MESMA regra que o servidor
  // cobra (natureza.exigeWorkflow ⇒ perfil obrigatório): a tela avisa antes, o
  // servidor recusa depois — nenhuma das duas corrige sozinha.
  const naturezaSelecionada = naturezas.find(n => n.id === form?.naturezaOperacionalId) ?? null
  const perfilSelecionado = perfis.find(p => p.id === form?.perfilOperacionalId) ?? null
  const exigePerfil = naturezaSelecionada?.exigeWorkflow === true

  if (loading) return <div className="py-24 text-center text-[var(--text-secondary)]">Carregando…</div>

  // Filtro "Certidões" por CLASSIFICAÇÃO ESTRUTURADA. Certidão é um SUBTIPO técnico
  // (naturezaDocumental / `nature`), eixo distinto de CategoriaDocumental — logo o
  // filtro é por `nature`, não pela categoria "Registro Civil" (que contém também
  // documentos que não são certidões). O fallback textual por nome (/certid/i) só
  // vale para linhas SEM `nature` (ainda não migradas) e é CONTABILIZADO abaixo.
  // CONDIÇÃO DE REMOÇÃO do fallback: 100% dos TipoDocumento com `nature` preenchido.
  const ehCertidaoEstruturado = (r: Tipo) => r.nature != null && /^certid/i.test(r.nature)
  const usaFallbackTextual = (r: Tipo) => r.nature == null && /certid/i.test(r.name)
  const ehCertidao = (r: Tipo) => ehCertidaoEstruturado(r) || usaFallbackTextual(r)
  const visiveis = filtro === "certidoes" ? rows.filter(ehCertidao) : rows
  const totalCertidoes = rows.filter(ehCertidao).length
  const certPorNature = rows.filter(ehCertidaoEstruturado).length   // cobertura estruturada
  const certPorTexto = rows.filter(usaFallbackTextual).length       // caíram no fallback

  return (
    <div className="space-y-5">
      {flash && <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3 text-sm text-green-800">{flash}</div>}

      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-5 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Tipos de Documento</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Cadastro <strong className="text-white/80">mestre</strong> de tipos documentais — inclui certidões, identidades, judiciais, etc. Certidões são criadas aqui (não há cadastro separado).</p>
          </div>
          <button onClick={() => setForm(formVazio())} className="flex-none rounded-lg bg-[var(--action-primary)] px-3 py-2 text-xs font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)]">+ Novo tipo de documento</button>
        </div>
        {/* Filtro rápido — consolidação de "Tipos de Certidão" */}
        <div className="mt-4 inline-flex overflow-hidden rounded-lg border border-[var(--border-default)] text-xs">
          <button onClick={() => setFiltro("todos")} aria-pressed={filtro === "todos"} className={`px-3 py-1.5 ${filtro === "todos" ? "bg-[var(--surface-secondary)] font-medium text-white" : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`}>Todos ({rows.length})</button>
          <button onClick={() => setFiltro("certidoes")} aria-pressed={filtro === "certidoes"} className={`px-3 py-1.5 ${filtro === "certidoes" ? "bg-[var(--surface-secondary)] font-medium text-white" : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`}>Certidões ({totalCertidoes})</button>
        </div>
        {filtro === "certidoes" && (
          <p className="mt-2 text-[11px] text-[var(--text-muted)]">Cobertura: {certPorNature} por natureza estruturada · {certPorTexto} por fallback textual{certPorTexto > 0 ? " (migrar `nature` para eliminar)" : ""}.</p>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]">
            <tr><th className="px-4 py-3 font-medium">Código</th><th className="px-4 py-3 font-medium">Nome</th><th className="px-4 py-3 font-medium">Categoria</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 text-right font-medium">Ações</th></tr>
          </thead>
          <tbody>
            {visiveis.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">{filtro === "certidoes" ? "Nenhuma certidão encontrada." : "Nenhum tipo de documento cadastrado."}</td></tr>
            ) : visiveis.map(d => (
              <tr key={d.id} className="border-b border-[var(--border-subtle)] last:border-0">
                <td className="px-4 py-2.5 font-mono text-[12px] font-bold text-white/80">{d.publicCode ?? "—"}</td>
                <td className="px-4 py-2.5 text-white">{d.name}</td>
                <td className="px-4 py-2.5 text-white/70">{d.categoriaDocumental?.name ?? (d.category || "—")}</td>
                <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[10px] ${d.ativo ? "bg-[var(--surface-secondary)] text-green-800" : "bg-[var(--surface-primary)] text-[var(--text-secondary)]"}`}>{d.ativo ? "Ativo" : "Inativo"}</span></td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-0.5 text-[var(--text-secondary)]">
                    <button title="Editar" aria-label="Editar" onClick={() => setForm({ id: d.id, publicCode: d.publicCode ?? null, code: d.code || "", name: d.name, category: d.category || "", categoriaDocumentalId: d.categoriaDocumentalId ?? null, currentCat: d.categoriaDocumental ?? null, ativo: d.ativo, familiaDocumentalId: d.familiaDocumentalId ?? null, naturezaOperacionalId: d.naturezaOperacionalId ?? null, perfilOperacionalId: d.perfilOperacionalId ?? null })} className="rounded p-1 hover:bg-[var(--surface-hover)] hover:text-white"><IEdit /></button>
                    <button title="Excluir" aria-label="Excluir" onClick={() => del(d)} className="rounded p-1 text-red-700/70 hover:bg-[var(--surface-secondary)] hover:text-red-700"><ITrash /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-modal)] p-4 backdrop-blur-sm" onClick={() => setForm(null)}>
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-default)] bg-zinc-900/95 shadow-[var(--elev-3)]" onClick={e => e.stopPropagation()}>
            <div className="border-b border-[var(--border-default)] px-6 py-4"><h3 className="font-semibold text-white">{form.id ? "Editar" : "Novo"} tipo de documento</h3></div>
            <div className="space-y-3 px-6 py-4">
              <CodigoPublicoField codigo={form.publicCode} />
              <div><label className={labelCls}>Nome *</label><input value={form.name} onChange={e => setForm(f => f && { ...f, name: e.target.value })} autoFocus className={inputCls} /></div>
              <div>
                <label className={labelCls}>Categoria documental</label>
                {/* LOTE A — categoria vem do cadastro mestre (API), não mais da lista fixa.
                    Grava categoriaDocumentalId. Sem criação inline. */}
                <DocumentCategorySelector
                  value={form.categoriaDocumentalId}
                  onChange={(id) => setForm(f => f && { ...f, categoriaDocumentalId: id })}
                  currentInactive={form.currentCat && !form.currentCat.ativo ? { id: form.currentCat.id, name: form.currentCat.name } : null}
                  className={inputCls}
                />
              </div>
              {/* ── CONTRATO OPERACIONAL ────────────────────────────────
                  Categoria diz ONDE o documento se arquiva. Estes três dizem
                  COMO ele opera. Todos gravam ID; nenhum aceita texto. */}
              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-3 space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Contrato operacional</div>

                <div>
                  <label className={labelCls}>Família documental</label>
                  <select
                    value={form.familiaDocumentalId ?? ""}
                    onChange={e => setForm(f => f && { ...f, familiaDocumentalId: e.target.value ? Number(e.target.value) : null })}
                    className={inputCls}
                  >
                    <option value="">— Não classificada —</option>
                    {familias.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Natureza operacional</label>
                  <select
                    value={form.naturezaOperacionalId ?? ""}
                    onChange={e => setForm(f => f && { ...f, naturezaOperacionalId: e.target.value ? Number(e.target.value) : null })}
                    className={inputCls}
                  >
                    <option value="">— Não classificada —</option>
                    {naturezas.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                  {naturezaSelecionada?.descricao && (
                    <div className="mt-1 text-[11px] text-[var(--text-secondary)]">{naturezaSelecionada.descricao}</div>
                  )}
                </div>

                <div>
                  <label className={labelCls}>
                    Perfil operacional
                    {exigePerfil && <span className="ml-1 text-amber-800">· obrigatório para esta natureza</span>}
                  </label>
                  <select
                    value={form.perfilOperacionalId ?? ""}
                    onChange={e => setForm(f => f && { ...f, perfilOperacionalId: e.target.value ? Number(e.target.value) : null })}
                    className={exigePerfil && form.perfilOperacionalId == null ? `${inputCls} border-[var(--border-default)]` : inputCls}
                  >
                    <option value="">— Sem perfil (não é processado por workflow) —</option>
                    {perfis.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </div>

                {/* O QUE O PERFIL IMPLICA — só leitura. Os passos se editam no
                    Workflow Interno; aqui a tela apenas referencia o contrato. */}
                {perfilSelecionado && (
                  <div className="rounded-md border border-[var(--border-default)] bg-[var(--surface-secondary)] p-2.5 space-y-1 text-[11.5px]">
                    <LinhaContrato rotulo="Workflow" valor={perfilSelecionado.workflow?.name ?? "— nenhum —"} />
                    <LinhaContrato rotulo="Versão publicada" valor={perfilSelecionado.workflow ? `v${perfilSelecionado.workflow.versao}${perfilSelecionado.workflow.active ? "" : " (inativo)"}` : "—"} />
                    <LinhaContrato rotulo="Escopo de execução" valor={LABEL_ESCOPO[perfilSelecionado.escopoInstanciacao] ?? perfilSelecionado.escopoInstanciacao} />
                    <LinhaContrato rotulo="Exige documento" valor={perfilSelecionado.exigeDocumento ? "Sim" : "Não"} />
                    <LinhaContrato rotulo="Exige pessoa" valor={perfilSelecionado.exigePessoa ? "Sim" : "Não"} />
                    <LinhaContrato rotulo="Passos" valor={perfilSelecionado.workflow ? String(perfilSelecionado.workflow._count.passos) : "—"} />
                    <div className="pt-1 text-[10.5px] text-[var(--text-muted)]">Os passos são editados no Workflow Interno.</div>
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={form.ativo} onChange={e => setForm(f => f && { ...f, ativo: e.target.checked })} />Ativo</label>
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--border-default)] px-6 py-4">
              <button onClick={() => setForm(null)} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2 text-sm text-white/80 hover:bg-[var(--surface-hover)]">Cancelar</button>
              <button disabled={busy} onClick={save} className="rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)] disabled:opacity-50">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
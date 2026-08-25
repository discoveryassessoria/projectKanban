'use client'
// src/components/gerenciamentoComponents/AplicabilidadeEconomicaTab.tsx
// LOTE D — Aplicabilidade Econômica (PhaseEconomicRule): liga FASE → COMPONENTE → produtos
// (custo/receita). É aqui que o Marco liga Tradução/Apostila/Retificação SEM seed/código.
import { useState, useEffect, useCallback } from 'react'
import { useApi } from "@/src/lib/dados"
import { fasesParaSelecao } from '@/src/lib/process-stage/fases-catalog'

type Regra = {
  id: number; tipoProcessoId: number | null; phaseKey: string; documentTypeCode: string | null
  appliesTo: string; componentKey: string; componentName: string
  custoProdutoCode: string | null; receitaProdutoCode: string | null
  participaPlanilha: boolean; ordem: number; ativo: boolean
}
type Produto = { id: number; codigo: string; nome: string; naturezaFinanceira: string | null; possuiCusto?: boolean; possuiReceita?: boolean; moedaPadrao: string | null }
type ProcRef = { id: number; name: string }
type DocRef = { id?: number; code: string | null; name: string }
type Data = { regras: Regra[]; produtos: Produto[]; tiposProcesso: ProcRef[]; docTypes: DocRef[] }
type Form = Omit<Regra, 'id'> & { id?: number }

// Fases do CATÁLOGO OFICIAL. Antes esta lista era repetida aqui e continuou
// oferecendo `traducao`/`retificacao` depois de o cadastro ter sido corrigido —
// a tela gravava chave legada sem ninguém perceber.
const FASES: [string, string][] = fasesParaSelecao().map((f) => [f.phaseKey, f.label])
const APPLIES: [string, string][] = [['any', 'Qualquer'], ['certificate', 'Certidão'], ['translation', 'Tradução'], ['original', 'Original']]
const faseLabel = (k: string) => FASES.find(([v]) => v === k)?.[1] || k

async function jsonFetch(url: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
  const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as any)?.error || `Erro ${res.status}`)
  return data
}

const VAZIO: Form = { tipoProcessoId: null, phaseKey: 'emissao_documental', documentTypeCode: null, appliesTo: 'any', componentKey: '', componentName: '', custoProdutoCode: null, receitaProdutoCode: null, participaPlanilha: true, ordem: 0, ativo: true }

export default function AplicabilidadeEconomicaTab() {
  // A resposta inteira vem da camada de dados. `erroSalvar` continua sendo
  // estado: é erro de ESCRITA, que não pertence à consulta — e `erro` combina os
  // dois para a tela, que só precisa saber "deu problema e qual".
  const { dados: d, carregando: loading, erro: erroCarregar, recarregar: carregar } =
    useApi<Data>('/api/gerenciamento/aplicabilidade-economica')
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)
  const erro = erroSalvar ?? erroCarregar?.message ?? null
  const [form, setForm] = useState<Form | null>(null)
  const [salvando, setSalvando] = useState(false)


  async function salvar() {
    if (!form) return
    setSalvando(true); setErroSalvar(null)
    try {
      const url = form.id ? `/api/gerenciamento/aplicabilidade-economica/${form.id}` : '/api/gerenciamento/aplicabilidade-economica'
      // F3.3 — envia os FKs canônicos (id) além dos códigos; o backend prioriza os ids.
      const custoConfigId = (d?.produtos || []).find(p => p.codigo === form.custoProdutoCode)?.id ?? null
      const receitaConfigId = (d?.produtos || []).find(p => p.codigo === form.receitaProdutoCode)?.id ?? null
      const tipoDocumentoId = (d?.docTypes || []).find(t => t.code === form.documentTypeCode)?.id ?? null
      await jsonFetch(url, { method: form.id ? 'PUT' : 'POST', body: JSON.stringify({ ...form, custoConfigId, receitaConfigId, tipoDocumentoId }) })
      setForm(null); await carregar()
    } catch (e: any) { setErroSalvar(e.message) } finally { setSalvando(false) }
  }
  async function excluir(r: Regra) {
    if (!confirm(`Excluir a regra "${r.componentName}" (${faseLabel(r.phaseKey)})?`)) return
    try { await jsonFetch(`/api/gerenciamento/aplicabilidade-economica/${r.id}`, { method: 'DELETE' }); await carregar() }
    catch (e: any) { alert(e.message) }
  }

  // M-UNIFICA — a config única habilita custo e/ou receita; a MESMA config pode ser
  // escolhida como fonte de custo e de receita (a natureza mora no preço, não na config).
  const custos = (d?.produtos || []).filter(p => p.possuiCusto)
  const receitas = (d?.produtos || []).filter(p => p.possuiReceita)
  const procName = (id: number | null) => id == null ? 'Qualquer processo' : (d?.tiposProcesso.find(t => t.id === id)?.name || `#${id}`)

  return (
    <div className="text-white">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Matrizes e Aplicabilidade · Aplicabilidade Econômica</h2>
          <p className="text-sm text-[var(--text-secondary)]">Liga cada fase a um componente (coluna da Planilha) e aos produtos de custo/receita. É aqui que se liga Tradução/Apostila/Retificação — sem código.</p>
        </div>
        <button onClick={() => setForm({ ...VAZIO })} className="rounded-lg bg-[var(--action-primary)] px-3 py-2 text-sm font-medium hover:bg-[var(--action-primary)]">+ Nova regra</button>
      </div>

      {erro && <div className="mb-3 rounded-lg bg-[var(--surface-secondary)] px-3 py-2 text-sm text-red-700 ring-1 ring-[var(--border-strong)]">{erro}</div>}
      {loading ? <div className="py-10 text-center text-[var(--text-muted)]">Carregando…</div>
      : (d?.regras.length ?? 0) === 0 ? <div className="py-10 text-center text-[var(--text-muted)]">Nenhuma regra. Clique em "+ Nova regra".</div>
      : (
        <div className="overflow-hidden rounded-xl ring-1 ring-white/10">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-primary)] text-left text-[var(--text-secondary)]"><tr>
              <th className="px-3 py-2">Fase</th><th className="px-3 py-2">Componente</th><th className="px-3 py-2">Processo</th><th className="px-3 py-2">Doc</th><th className="px-3 py-2">Custo</th><th className="px-3 py-2">Receita</th><th className="px-3 py-2">Planilha</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Ações</th>
            </tr></thead>
            <tbody>
              {d!.regras.map(r => (
                <tr key={r.id} className="border-t border-[var(--border-subtle)]">
                  <td className="px-3 py-2">{faseLabel(r.phaseKey)}</td>
                  <td className="px-3 py-2 font-medium">{r.componentName}{r.appliesTo !== 'any' && <span className="ml-1.5 text-[10px] text-[var(--text-muted)]">· {APPLIES.find(([v]) => v === r.appliesTo)?.[1]}</span>}</td>
                  <td className="px-3 py-2 text-[var(--text-secondary)]">{procName(r.tipoProcessoId)}</td>
                  <td className="px-3 py-2 text-[var(--text-secondary)]">{r.documentTypeCode || '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.custoProdutoCode || <span className="text-amber-800/70">[AJUSTAR]</span>}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.receitaProdutoCode || <span className="text-amber-800/70">[AJUSTAR]</span>}</td>
                  <td className="px-3 py-2">{r.participaPlanilha ? '✓' : '—'}</td>
                  <td className="px-3 py-2">{r.ativo ? <span className="text-green-800">Ativo</span> : <span className="text-[var(--text-muted)]">Inativo</span>}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => setForm({ ...r })} className="text-[var(--text-secondary)] hover:underline">Editar</button>
                    <button onClick={() => excluir(r)} className="ml-3 text-red-700 hover:underline">Excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-modal)] p-4" onClick={() => !salvando && setForm(null)}>
          <div className="w-full max-w-2xl rounded-2xl bg-neutral-900 p-5 ring-1 ring-white/10" onClick={e => e.stopPropagation()}>
            <h3 className="mb-4 text-base font-semibold">{form.id ? 'Editar regra' : 'Nova regra econômica'}</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label><span className="text-[var(--text-secondary)]">Fase *</span>
                <select value={form.phaseKey} onChange={e => setForm(f => f && { ...f, phaseKey: e.target.value })} className="mt-1 w-full rounded-lg bg-[var(--surface-primary)] px-3 py-2 ring-1 ring-white/10 focus:ring-[var(--border-strong)]">
                  {FASES.map(([v, l]) => <option key={v} value={v} className="bg-neutral-900">{l}</option>)}</select></label>
              <label><span className="text-[var(--text-secondary)]">Nome do componente * (coluna da Planilha)</span>
                <input value={form.componentName} onChange={e => setForm(f => f && { ...f, componentName: e.target.value })} className="mt-1 w-full rounded-lg bg-[var(--surface-primary)] px-3 py-2 ring-1 ring-white/10 focus:ring-[var(--border-strong)]" placeholder="Tradução Juramentada" /></label>
              <label><span className="text-[var(--text-secondary)]">Processo (nacionalidade)</span>
                <select value={form.tipoProcessoId ?? ''} onChange={e => setForm(f => f && { ...f, tipoProcessoId: e.target.value === '' ? null : Number(e.target.value) })} className="mt-1 w-full rounded-lg bg-[var(--surface-primary)] px-3 py-2 ring-1 ring-white/10 focus:ring-[var(--border-strong)]">
                  <option value="" className="bg-neutral-900">Qualquer</option>
                  {d?.tiposProcesso.map(t => <option key={t.id} value={t.id} className="bg-neutral-900">{t.name}</option>)}</select></label>
              <label><span className="text-[var(--text-secondary)]">Aplica a</span>
                <select value={form.appliesTo} onChange={e => setForm(f => f && { ...f, appliesTo: e.target.value })} className="mt-1 w-full rounded-lg bg-[var(--surface-primary)] px-3 py-2 ring-1 ring-white/10 focus:ring-[var(--border-strong)]">
                  {APPLIES.map(([v, l]) => <option key={v} value={v} className="bg-neutral-900">{l}</option>)}</select></label>
              <label><span className="text-[var(--text-secondary)]">Produto de CUSTO</span>
                <select value={form.custoProdutoCode ?? ''} onChange={e => setForm(f => f && { ...f, custoProdutoCode: e.target.value || null })} className="mt-1 w-full rounded-lg bg-[var(--surface-primary)] px-3 py-2 ring-1 ring-white/10 focus:ring-[var(--border-strong)]">
                  <option value="" className="bg-neutral-900">— nenhum —</option>
                  {custos.map(p => <option key={p.codigo} value={p.codigo} className="bg-neutral-900">{p.nome} ({p.codigo})</option>)}</select></label>
              <label><span className="text-[var(--text-secondary)]">Produto de RECEITA</span>
                <select value={form.receitaProdutoCode ?? ''} onChange={e => setForm(f => f && { ...f, receitaProdutoCode: e.target.value || null })} className="mt-1 w-full rounded-lg bg-[var(--surface-primary)] px-3 py-2 ring-1 ring-white/10 focus:ring-[var(--border-strong)]">
                  <option value="" className="bg-neutral-900">— nenhum —</option>
                  {receitas.map(p => <option key={p.codigo} value={p.codigo} className="bg-neutral-900">{p.nome} ({p.codigo})</option>)}</select></label>
              <label><span className="text-[var(--text-secondary)]">Doc específico (code, opcional)</span>
                <select value={form.documentTypeCode ?? ''} onChange={e => setForm(f => f && { ...f, documentTypeCode: e.target.value || null })} className="mt-1 w-full rounded-lg bg-[var(--surface-primary)] px-3 py-2 ring-1 ring-white/10 focus:ring-[var(--border-strong)]">
                  <option value="" className="bg-neutral-900">Qualquer</option>
                  {d?.docTypes.filter(t => t.code).map(t => <option key={t.code!} value={t.code!} className="bg-neutral-900">{t.name}</option>)}</select></label>
              <label><span className="text-[var(--text-secondary)]">Ordem</span>
                <input type="number" value={form.ordem} onChange={e => setForm(f => f && { ...f, ordem: Number(e.target.value) })} className="mt-1 w-full rounded-lg bg-[var(--surface-primary)] px-3 py-2 ring-1 ring-white/10 focus:ring-[var(--border-strong)]" /></label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.participaPlanilha} onChange={e => setForm(f => f && { ...f, participaPlanilha: e.target.checked })} /> <span className="text-white/70">Aparece na Planilha</span></label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.ativo} onChange={e => setForm(f => f && { ...f, ativo: e.target.checked })} /> <span className="text-white/70">Ativo</span></label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setForm(null)} disabled={salvando} className="rounded-lg px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">Cancelar</button>
              <button onClick={salvar} disabled={salvando} className="rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium hover:bg-[var(--action-primary)] disabled:opacity-50">{salvando ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
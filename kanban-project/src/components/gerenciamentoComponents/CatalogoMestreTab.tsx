'use client'
// src/components/gerenciamentoComponents/CatalogoMestreTab.tsx
// LOTE D — Catálogo Mestre (ItemCatalogo): a FONTE ÚNICA de itens do sistema.
// Cada item existe UMA vez aqui; Matriz/Produtos/Preços/Regras só REFERENCIAM.
// Backend: /api/gerenciamento/catalogo-mestre (GET/POST) + /[id] (PUT/DELETE)
import { useState, useEffect, useCallback } from 'react'

type Item = {
  id: number; code: string; name: string; descricao: string | null
  natureza: string; categoria: string | null; unidade: string; ativo: boolean
  _count?: { tiposDocumento: number; produtos: number; servicos: number; precos: number }
}
type Form = { id?: number; code: string; name: string; descricao: string; natureza: string; categoria: string; unidade: string; ativo: boolean }

const NAT_LABEL: Record<string, string> = {
  DOCUMENTO: 'Documento', PRODUTO: 'Produto', SERVICO: 'Serviço', HONORARIO: 'Honorário',
  TAXA: 'Taxa', DESPESA: 'Despesa', LOGISTICA: 'Logística', OUTRO: 'Outro',
}

async function jsonFetch(url: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
  const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as any)?.error || `Erro ${res.status}`)
  return data
}

const VAZIO: Form = { code: '', name: '', descricao: '', natureza: 'DOCUMENTO', categoria: '', unidade: 'UNIDADE', ativo: true }

export default function CatalogoMestreTab() {
  const [itens, setItens] = useState<Item[]>([])
  const [naturezas, setNaturezas] = useState<string[]>([])
  const [unidades, setUnidades] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [busca, setBusca] = useState('')

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    try {
      const d = await jsonFetch('/api/gerenciamento/catalogo-mestre')
      setItens(d.itens || []); setNaturezas(d.naturezas || []); setUnidades(d.unidades || [])
    } catch (e: any) { setErro(e.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { carregar() }, [carregar])

  async function salvar() {
    if (!form) return
    setSalvando(true); setErro(null)
    try {
      const url = form.id ? `/api/gerenciamento/catalogo-mestre/${form.id}` : '/api/gerenciamento/catalogo-mestre'
      await jsonFetch(url, { method: form.id ? 'PUT' : 'POST', body: JSON.stringify(form) })
      setForm(null); await carregar()
    } catch (e: any) { setErro(e.message) } finally { setSalvando(false) }
  }
  async function excluir(it: Item) {
    if (!confirm(`Excluir o item "${it.name}"?`)) return
    try { await jsonFetch(`/api/gerenciamento/catalogo-mestre/${it.id}`, { method: 'DELETE' }); await carregar() }
    catch (e: any) { alert(e.message) }
  }

  const filtrados = itens.filter(i => {
    const q = busca.trim().toLowerCase()
    return !q || i.code.toLowerCase().includes(q) || i.name.toLowerCase().includes(q) || NAT_LABEL[i.natureza]?.toLowerCase().includes(q)
  })
  const usos = (it: Item) => it._count ? it._count.tiposDocumento + it._count.produtos + it._count.servicos + it._count.precos : 0

  return (
    <div className="text-white">
      <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
        Tela legada em migração. O papel financeiro (custo/receita/…) de cada item agora é configurado em
        <span className="font-medium"> Configurações Financeiras</span>, que referenciam os mestres por FK — sem recriar documentos aqui.
      </div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Catálogo Mestre · Itens</h2>
          <p className="text-sm text-white/50">Fonte única de itens (documentos, produtos, serviços, honorários…). Tudo o mais só referencia daqui.</p>
        </div>
        <button onClick={() => setForm({ ...VAZIO })} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500">+ Novo item</button>
      </div>

      <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por código, nome ou natureza…"
        className="mb-3 w-full rounded-lg bg-white/5 px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-blue-500" />

      {erro && <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300 ring-1 ring-red-500/20">{erro}</div>}
      {loading ? (
        <div className="py-10 text-center text-white/40">Carregando…</div>
      ) : filtrados.length === 0 ? (
        <div className="py-10 text-center text-white/40">Nenhum item. Clique em "+ Novo item".</div>
      ) : (
        <div className="overflow-hidden rounded-xl ring-1 ring-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-left text-white/60">
              <tr><th className="px-3 py-2">Código</th><th className="px-3 py-2">Nome</th><th className="px-3 py-2">Natureza</th><th className="px-3 py-2">Unidade</th><th className="px-3 py-2">Vínculos</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Ações</th></tr>
            </thead>
            <tbody>
              {filtrados.map(it => (
                <tr key={it.id} className="border-t border-white/5">
                  <td className="px-3 py-2 font-mono text-xs text-white/70">{it.code}</td>
                  <td className="px-3 py-2 font-medium">{it.name}{it.categoria && <span className="ml-1.5 text-[10px] text-white/40">· {it.categoria}</span>}</td>
                  <td className="px-3 py-2">{NAT_LABEL[it.natureza] || it.natureza}</td>
                  <td className="px-3 py-2 text-white/60">{it.unidade}</td>
                  <td className="px-3 py-2">{usos(it) > 0 ? <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] text-blue-300">{usos(it)}</span> : <span className="text-white/30">—</span>}</td>
                  <td className="px-3 py-2">{it.ativo ? <span className="text-emerald-400">Ativo</span> : <span className="text-white/40">Inativo</span>}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => setForm({ id: it.id, code: it.code, name: it.name, descricao: it.descricao || '', natureza: it.natureza, categoria: it.categoria || '', unidade: it.unidade, ativo: it.ativo })} className="text-blue-400 hover:underline">Editar</button>
                    <button onClick={() => excluir(it)} className="ml-3 text-red-400 hover:underline">Excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !salvando && setForm(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-neutral-900 p-5 ring-1 ring-white/10" onClick={e => e.stopPropagation()}>
            <h3 className="mb-4 text-base font-semibold text-white">{form.id ? 'Editar item' : 'Novo item'}</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className="col-span-1"><span className="text-white/50">Código *</span>
                <input value={form.code} onChange={e => setForm(f => f && { ...f, code: e.target.value })} className="mt-1 w-full rounded-lg bg-white/5 px-3 py-2 outline-none ring-1 ring-white/10 focus:ring-blue-500" placeholder="CERT_NASCIMENTO_IT" /></label>
              <label className="col-span-1"><span className="text-white/50">Categoria</span>
                <input value={form.categoria} onChange={e => setForm(f => f && { ...f, categoria: e.target.value })} className="mt-1 w-full rounded-lg bg-white/5 px-3 py-2 outline-none ring-1 ring-white/10 focus:ring-blue-500" placeholder="Registro civil" /></label>
              <label className="col-span-2"><span className="text-white/50">Nome *</span>
                <input value={form.name} onChange={e => setForm(f => f && { ...f, name: e.target.value })} className="mt-1 w-full rounded-lg bg-white/5 px-3 py-2 outline-none ring-1 ring-white/10 focus:ring-blue-500" placeholder="Certidão de Nascimento - Inteiro Teor" /></label>
              <label className="col-span-1"><span className="text-white/50">Natureza</span>
                <select value={form.natureza} onChange={e => setForm(f => f && { ...f, natureza: e.target.value })} className="mt-1 w-full rounded-lg bg-white/5 px-3 py-2 outline-none ring-1 ring-white/10 focus:ring-blue-500">
                  {naturezas.map(n => <option key={n} value={n} className="bg-neutral-900">{NAT_LABEL[n] || n}</option>)}</select></label>
              <label className="col-span-1"><span className="text-white/50">Unidade</span>
                <select value={form.unidade} onChange={e => setForm(f => f && { ...f, unidade: e.target.value })} className="mt-1 w-full rounded-lg bg-white/5 px-3 py-2 outline-none ring-1 ring-white/10 focus:ring-blue-500">
                  {unidades.map(u => <option key={u} value={u} className="bg-neutral-900">{u}</option>)}</select></label>
              <label className="col-span-2"><span className="text-white/50">Descrição</span>
                <textarea value={form.descricao} onChange={e => setForm(f => f && { ...f, descricao: e.target.value })} rows={2} className="mt-1 w-full rounded-lg bg-white/5 px-3 py-2 outline-none ring-1 ring-white/10 focus:ring-blue-500" /></label>
              <label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={form.ativo} onChange={e => setForm(f => f && { ...f, ativo: e.target.checked })} /> <span className="text-white/70">Ativo</span></label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setForm(null)} disabled={salvando} className="rounded-lg px-3 py-2 text-sm text-white/60 hover:bg-white/5">Cancelar</button>
              <button onClick={salvar} disabled={salvando} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50">{salvando ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
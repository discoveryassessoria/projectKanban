'use client'

// src/components/gerenciamentoComponents/FornecedoresTab.tsx
// Cadastro REAL de Fornecedores (tabela Fornecedor).
// Backend: /api/gerenciamento/fornecedores (GET/POST) + /[id] (PUT/DELETE)
// `tipo` guarda a CATEGORIA do mockup (cartório, tradutor, apostilamento...).
// Campos ricos do schema + pais + moedaPadrao (novos). Form em 5 seções.

import { useState, useEffect, useMemo, useCallback } from 'react'

type Fornecedor = {
  id: number
  nome: string
  tipo: string
  nomeFantasia: string | null
  cpfCnpj: string | null
  inscricaoEstadual: string | null
  inscricaoMunicipal: string | null
  telefone: string | null
  celular: string | null
  email: string | null
  website: string | null
  cep: string | null
  endereco: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  estado: string | null
  pais: string | null
  banco: string | null
  agencia: string | null
  conta: string | null
  tipoConta: string | null
  chavePix: string | null
  tipoChavePix: string | null
  moedaPadrao: string
  observacoes: string | null
  ativo: boolean
  _count?: { contasPagar: number }
}

const CATEGORIAS: [string, string][] = [
  ['registry_office', 'Cartório'],
  ['translator', 'Tradutor'],
  ['apostille_service', 'Apostilamento'],
  ['lawyer', 'Advogado'],
  ['correspondent', 'Correspondente'],
  ['courier', 'Courier / Transporte'],
  ['consultant', 'Consultor'],
  ['government_fee', 'Taxa governamental'],
  ['software', 'Software'],
  ['office', 'Escritório'],
  ['other', 'Outro'],
]
const MOEDAS: [string, string][] = [['BRL', 'Real (BRL)'], ['EUR', 'Euro (EUR)'], ['USD', 'Dólar (USD)']]
const TIPOS_PIX = ['CPF', 'CNPJ', 'E-mail', 'Telefone', 'Aleatória']

const catLabel = (v: string | null) => CATEGORIAS.find(([k]) => k === v)?.[1] || v || '—'

const EMPTY = {
  nome: '', tipo: '', nomeFantasia: '', cpfCnpj: '', inscricaoEstadual: '', inscricaoMunicipal: '',
  telefone: '', celular: '', email: '', website: '',
  cep: '', endereco: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '', pais: '',
  banco: '', agencia: '', conta: '', tipoConta: '', chavePix: '', tipoChavePix: '',
  moedaPadrao: 'BRL', observacoes: '', ativo: true,
}
type FormState = typeof EMPTY

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

function Secao({ titulo, children, primeira }: { titulo: string; children: React.ReactNode; primeira?: boolean }) {
  return (
    <div className={primeira ? '' : 'border-t border-white/10 pt-4'}>
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-white/40">{titulo}</div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

export default function FornecedoresTab() {
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Fornecedor | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)

  const set = (k: keyof FormState, v: any) => setForm((f) => ({ ...f, [k]: v }))

  const carregar = useCallback(async () => {
    setLoading(true); setErroLista(null)
    try {
      const data = await jsonFetch('/api/gerenciamento/fornecedores', { cache: 'no-store' })
      setFornecedores((data as any).fornecedores || [])
    } catch (e: any) {
      setErroLista(e.message || 'Não foi possível carregar os fornecedores.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return fornecedores
    return fornecedores.filter((f) =>
      f.nome.toLowerCase().includes(q) ||
      (f.nomeFantasia || '').toLowerCase().includes(q) ||
      (f.cpfCnpj || '').toLowerCase().includes(q) ||
      catLabel(f.tipo).toLowerCase().includes(q)
    )
  }, [fornecedores, busca])

  function abrirNovo() {
    setEditando(null)
    setForm(EMPTY)
    setErroModal(null); setModalAberto(true)
  }
  function abrirEditar(f: Fornecedor) {
    setEditando(f)
    setForm({
      nome: f.nome, tipo: f.tipo, nomeFantasia: f.nomeFantasia || '', cpfCnpj: f.cpfCnpj || '',
      inscricaoEstadual: f.inscricaoEstadual || '', inscricaoMunicipal: f.inscricaoMunicipal || '',
      telefone: f.telefone || '', celular: f.celular || '', email: f.email || '', website: f.website || '',
      cep: f.cep || '', endereco: f.endereco || '', numero: f.numero || '', complemento: f.complemento || '',
      bairro: f.bairro || '', cidade: f.cidade || '', estado: f.estado || '', pais: f.pais || '',
      banco: f.banco || '', agencia: f.agencia || '', conta: f.conta || '', tipoConta: f.tipoConta || '',
      chavePix: f.chavePix || '', tipoChavePix: f.tipoChavePix || '',
      moedaPadrao: f.moedaPadrao || 'BRL', observacoes: f.observacoes || '', ativo: f.ativo,
    })
    setErroModal(null); setModalAberto(true)
  }

  async function salvar() {
    if (!form.nome.trim()) { setErroModal('Dê um nome ao fornecedor.'); return }
    if (!form.tipo) { setErroModal('Escolha a categoria (Tipo).'); return }
    setSalvando(true); setErroModal(null)
    try {
      const body = JSON.stringify(form)
      if (editando) {
        await jsonFetch(`/api/gerenciamento/fornecedores/${editando.id}`, { method: 'PUT', body })
      } else {
        await jsonFetch('/api/gerenciamento/fornecedores', { method: 'POST', body })
      }
      setModalAberto(false)
      await carregar()
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(f: Fornecedor) {
    if (!confirm(`Excluir o fornecedor "${f.nome}"? Esta ação não pode ser desfeita.`)) return
    try {
      await jsonFetch(`/api/gerenciamento/fornecedores/${f.id}`, { method: 'DELETE' })
      await carregar()
    } catch (e: any) {
      alert(e.message || 'Não foi possível excluir.')
    }
  }

  const inputCls = 'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20'

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Fornecedores</h2>
          <p className="text-sm text-white/50">Cartórios, tradutores, apostilamento, correspondentes.</p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
          + Novo fornecedor
        </button>
      </div>

      {/* Busca */}
      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar fornecedor..."
        className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder-white/30 outline-none backdrop-blur focus:border-white/20"
      />

      {/* Estados */}
      {loading && <div className="py-12 text-center text-sm text-white/40">Carregando...</div>}

      {!loading && erroLista && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {erroLista}
          <button onClick={carregar} className="ml-3 underline hover:text-white">Tentar de novo</button>
        </div>
      )}

      {!loading && !erroLista && filtrados.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 py-12 text-center text-sm text-white/40 backdrop-blur">
          {busca ? 'Nenhum fornecedor encontrado.' : 'Nenhum fornecedor ainda. Crie o primeiro.'}
        </div>
      )}

      {/* Tabela */}
      {!loading && !erroLista && filtrados.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-white/5">
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Fornecedor</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Categoria</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Contato</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Status</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((f) => (
                <tr key={f.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-white">{f.nome}</div>
                    {f.nomeFantasia && <div className="text-[11px] text-white/40">{f.nomeFantasia}</div>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="rounded bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/70">{catLabel(f.tipo)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-white/60">
                    {f.email || f.telefone || f.celular || '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${f.ativo ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-white/50'}`}>
                      {f.ativo ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => abrirEditar(f)} className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white">Editar</button>
                      <button onClick={() => excluir(f)} className="rounded-md border border-red-500/20 px-2.5 py-1 text-xs text-red-300/80 transition hover:bg-red-500/10 hover:text-red-200">Excluir</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar fornecedor' : 'Novo fornecedor'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            <div className="max-h-[72vh] space-y-5 overflow-y-auto px-6 py-5">
              {/* Identificação */}
              <Secao titulo="Identificação" primeira>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Nome / Razão social</label>
                    <input value={form.nome} onChange={(e) => set('nome', e.target.value)} autoFocus className={inputCls} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Tipo (categoria)</label>
                    <select value={form.tipo} onChange={(e) => set('tipo', e.target.value)} className={inputCls}>
                      <option value="" className="bg-zinc-900">— Selecione —</option>
                      {CATEGORIAS.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Nome fantasia</label>
                  <input value={form.nomeFantasia} onChange={(e) => set('nomeFantasia', e.target.value)} className={inputCls} />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-white/60">CPF / CNPJ</label>
                    <input value={form.cpfCnpj} onChange={(e) => set('cpfCnpj', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Inscr. estadual</label>
                    <input value={form.inscricaoEstadual} onChange={(e) => set('inscricaoEstadual', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Inscr. municipal</label>
                    <input value={form.inscricaoMunicipal} onChange={(e) => set('inscricaoMunicipal', e.target.value)} className={inputCls} />
                  </div>
                </div>
              </Secao>

              {/* Contato */}
              <Secao titulo="Contato">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Telefone</label>
                    <input value={form.telefone} onChange={(e) => set('telefone', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Celular</label>
                    <input value={form.celular} onChange={(e) => set('celular', e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-white/60">E-mail</label>
                    <input value={form.email} onChange={(e) => set('email', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Site</label>
                    <input value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://..." className={inputCls} />
                  </div>
                </div>
              </Secao>

              {/* Endereço */}
              <Secao titulo="Endereço">
                <div className="grid grid-cols-4 gap-3">
                  <div className="col-span-1">
                    <label className="mb-1 block text-xs text-white/60">CEP</label>
                    <input value={form.cep} onChange={(e) => set('cep', e.target.value)} className={inputCls} />
                  </div>
                  <div className="col-span-3">
                    <label className="mb-1 block text-xs text-white/60">Endereço</label>
                    <input value={form.endereco} onChange={(e) => set('endereco', e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Número</label>
                    <input value={form.numero} onChange={(e) => set('numero', e.target.value)} className={inputCls} />
                  </div>
                  <div className="col-span-3">
                    <label className="mb-1 block text-xs text-white/60">Complemento</label>
                    <input value={form.complemento} onChange={(e) => set('complemento', e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Bairro</label>
                    <input value={form.bairro} onChange={(e) => set('bairro', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Cidade</label>
                    <input value={form.cidade} onChange={(e) => set('cidade', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/60">UF</label>
                    <input value={form.estado} maxLength={2} onChange={(e) => set('estado', e.target.value.toUpperCase())} className={inputCls} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/60">País</label>
                    <input value={form.pais} onChange={(e) => set('pais', e.target.value)} placeholder="Brasil" className={inputCls} />
                  </div>
                </div>
              </Secao>

              {/* Dados bancários */}
              <Secao titulo="Dados bancários">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Banco</label>
                    <input value={form.banco} onChange={(e) => set('banco', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Agência</label>
                    <input value={form.agencia} onChange={(e) => set('agencia', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Conta</label>
                    <input value={form.conta} onChange={(e) => set('conta', e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Tipo de conta</label>
                    <input value={form.tipoConta} onChange={(e) => set('tipoConta', e.target.value)} placeholder="Corrente / Poupança" className={inputCls} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Chave Pix</label>
                    <input value={form.chavePix} onChange={(e) => set('chavePix', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Tipo da chave</label>
                    <select value={form.tipoChavePix} onChange={(e) => set('tipoChavePix', e.target.value)} className={inputCls}>
                      <option value="" className="bg-zinc-900">—</option>
                      {TIPOS_PIX.map((t) => <option key={t} value={t} className="bg-zinc-900">{t}</option>)}
                    </select>
                  </div>
                </div>
              </Secao>

              {/* Configurações */}
              <Secao titulo="Configurações">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Moeda padrão</label>
                    <select value={form.moedaPadrao} onChange={(e) => set('moedaPadrao', e.target.value)} className={inputCls}>
                      {MOEDAS.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                    </select>
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 pb-2 text-sm text-white/80">
                      <input type="checkbox" checked={form.ativo} onChange={(e) => set('ativo', e.target.checked)} className="h-4 w-4 accent-blue-500" />
                      Ativo
                    </label>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Observações</label>
                  <textarea value={form.observacoes} onChange={(e) => set('observacoes', e.target.value)} rows={2} className={`${inputCls} resize-none`} />
                </div>
              </Secao>

              {erroModal && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{erroModal}</div>
              )}
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
    </div>
  )
}
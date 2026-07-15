'use client'

// src/components/gerenciamentoComponents/CategoriasTab.tsx
// Categorias Financeiras (tabela CategoriaFinanceira) — MDM.
// A categoria NÃO é um cadastro independente de texto livre: ela REFERENCIA um
// cadastro mestre por FK real (Documento/Serviço/Honorário/Processo). O nome é
// DERIVADO do mestre e fica READ-ONLY (não é possível redigitar/recriar a entidade).
// Backend: /api/gerenciamento/categorias (GET/POST) + /[id] (PUT/DELETE).
//   GET -> { categorias: [...], mestres: { tiposDocumento, servicos, honorarios, tiposProcesso } }

import { useState, useEffect, useMemo, useCallback } from 'react'

type MestreEmbed = { id: number; name: string; code?: string | null } | null
type Categoria = {
  id: number
  nome: string
  tipo: 'ENTRADA' | 'SAIDA'
  cor: string | null
  descricao: string | null
  categoriaPaiId: number | null
  ativo: boolean
  origem: 'DOCUMENTO' | 'SERVICO' | 'HONORARIO' | 'PROCESSO' | 'LEGADO'
  tipoDocumentoId: number | null
  honorarioId: number | null
  tipoProcessoId: number | null
  itemCatalogoId: number | null
  categoriaPai?: { id: number; nome: string } | null
  tipoDocumento?: MestreEmbed
  honorario?: MestreEmbed
  tipoProcesso?: { id: number; name: string } | null
  itemCatalogo?: MestreEmbed
  _count?: { subcategorias: number; contasPagar: number; transacoes: number }
}

const CORES = [
  '#EF4444', '#F59E0B', '#3B82F6', '#8B5CF6',
  '#10B981', '#EC4899', '#14B8A6', '#6366F1',
]

// Origem do cadastro mestre (nunca recriado aqui).
const ORIGENS: [OrigemKey, string][] = [
  ['documento', 'Documento'], ['servico', 'Serviço'], ['honorario', 'Honorário'], ['processo', 'Processo / Modalidade'],
]
type OrigemKey = 'documento' | 'servico' | 'honorario' | 'processo'
// mapeia origem (UI) → campo FK enviado no POST/PUT
const FK_POR_ORIGEM: Record<OrigemKey, 'tipoDocumentoId' | 'itemCatalogoId' | 'honorarioId' | 'tipoProcessoId'> = {
  documento: 'tipoDocumentoId', servico: 'itemCatalogoId', honorario: 'honorarioId', processo: 'tipoProcessoId',
}
// mapeia origem (enum do banco) → chave da UI
const ENUM_PARA_KEY: Record<Categoria['origem'], OrigemKey | null> = {
  DOCUMENTO: 'documento', SERVICO: 'servico', HONORARIO: 'honorario', PROCESSO: 'processo', LEGADO: null,
}
const ORIGEM_LABEL: Record<Categoria['origem'], string> = {
  DOCUMENTO: 'Documento', SERVICO: 'Serviço', HONORARIO: 'Honorário', PROCESSO: 'Processo / Modalidade', LEGADO: 'Legado (sem mestre)',
}

type MestreRef = { id: number; label: string; code: string | null }
type Mestres = Record<OrigemKey, MestreRef[]>
const MESTRES_VAZIO: Mestres = { documento: [], servico: [], honorario: [], processo: [] }
const lbl = (v: OrigemKey) => ORIGENS.find(([k]) => k === v)?.[1] || v

// nome do mestre já vinculado a uma categoria (para a listagem)
function mestreDe(c: Categoria): string {
  return c.tipoDocumento?.name ?? c.itemCatalogo?.name ?? c.honorario?.name ?? c.tipoProcesso?.name ?? (c.origem === 'LEGADO' ? '— (migrar)' : '—')
}

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

export default function CategoriasTab() {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [mestres, setMestres] = useState<Mestres>(MESTRES_VAZIO)
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<'TODOS' | 'ENTRADA' | 'SAIDA'>('TODOS')

  // modal
  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Categoria | null>(null)
  const [origem, setOrigem] = useState<OrigemKey>('documento')
  const [masterId, setMasterId] = useState<string>('')
  const [masterBusca, setMasterBusca] = useState('')
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<'ENTRADA' | 'SAIDA'>('SAIDA')
  const [cor, setCor] = useState(CORES[2])
  const [descricao, setDescricao] = useState('')
  const [categoriaPaiId, setCategoriaPaiId] = useState<string>('')
  const [ativo, setAtivo] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)

  // categoria com mestre já vinculado → origem/mestre travados na edição
  const origemTravada = !!editando && editando.origem !== 'LEGADO'

  const carregar = useCallback(async () => {
    setLoading(true); setErroLista(null)
    try {
      const data = await jsonFetch('/api/gerenciamento/categorias', { cache: 'no-store' })
      setCategorias((data as any).categorias || [])
      const m = (data as any).mestres || {}
      setMestres({
        documento: (m.tiposDocumento || []).map((d: any) => ({ id: d.id, label: d.name, code: d.code ?? null })),
        servico: (m.servicos || []).map((x: any) => ({ id: x.id, label: x.name, code: x.code ?? null })),
        honorario: (m.honorarios || []).map((h: any) => ({ id: h.id, label: h.name, code: h.code ?? null })),
        processo: (m.tiposProcesso || []).map((p: any) => ({ id: p.id, label: p.name, code: null })),
      })
    } catch (e: any) {
      setErroLista(e.message || 'Não foi possível carregar as categorias.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return categorias.filter((c) => {
      if (filtroTipo !== 'TODOS' && c.tipo !== filtroTipo) return false
      if (!q) return true
      return c.nome.toLowerCase().includes(q) || mestreDe(c).toLowerCase().includes(q) || (c.descricao || '').toLowerCase().includes(q)
    })
  }, [categorias, busca, filtroTipo])

  const masterFiltrado = useMemo(() => {
    const arr = mestres[origem] ?? []
    const q = masterBusca.trim().toLowerCase()
    if (!q) return arr.slice(0, 50)
    return arr.filter((m) => m.label.toLowerCase().includes(q) || (m.code ?? '').toLowerCase().includes(q)).slice(0, 50)
  }, [mestres, origem, masterBusca])
  const masterSelecionado = (mestres[origem] ?? []).find((m) => String(m.id) === masterId) || null

  function selecionarMaster(m: MestreRef) {
    setMasterId(String(m.id)); setNome(m.label); setMasterBusca('')
  }
  function mudarOrigem(o: OrigemKey) {
    setOrigem(o); setMasterId(''); setNome(''); setMasterBusca('')
  }

  function abrirNovo() {
    setEditando(null)
    setOrigem('documento'); setMasterId(''); setMasterBusca(''); setNome('')
    setTipo('SAIDA'); setCor(CORES[2]); setDescricao(''); setCategoriaPaiId(''); setAtivo(true)
    setErroModal(null); setModalAberto(true)
  }
  function abrirEditar(c: Categoria) {
    setEditando(c)
    const key = ENUM_PARA_KEY[c.origem] ?? 'documento'
    setOrigem(key)
    const fkId = c.tipoDocumentoId ?? c.itemCatalogoId ?? c.honorarioId ?? c.tipoProcessoId ?? null
    setMasterId(fkId ? String(fkId) : '')
    setMasterBusca('')
    setNome(c.nome)
    setTipo(c.tipo); setCor(c.cor || CORES[2]); setDescricao(c.descricao || '')
    setCategoriaPaiId(c.categoriaPaiId ? String(c.categoriaPaiId) : ''); setAtivo(c.ativo)
    setErroModal(null); setModalAberto(true)
  }

  async function salvar() {
    // categoria com mestre travado dispensa nova seleção; caso contrário exige mestre
    if (!origemTravada && !masterId) {
      setErroModal('Selecione a entidade mestre (origem). O nome vem dela.'); return
    }
    setSalvando(true); setErroModal(null)
    try {
      const base: any = {
        tipo,
        cor,
        descricao: descricao.trim() || null,
        categoriaPaiId: categoriaPaiId ? Number(categoriaPaiId) : null,
        ativo,
      }
      if (!origemTravada && masterId) {
        base[FK_POR_ORIGEM[origem]] = Number(masterId)
      }
      const body = JSON.stringify(base)
      if (editando) {
        await jsonFetch(`/api/gerenciamento/categorias/${editando.id}`, { method: 'PUT', body })
      } else {
        await jsonFetch('/api/gerenciamento/categorias', { method: 'POST', body })
      }
      setModalAberto(false)
      await carregar()
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(c: Categoria) {
    if (!confirm(`Excluir a categoria "${c.nome}"? Esta ação não pode ser desfeita.`)) return
    try {
      await jsonFetch(`/api/gerenciamento/categorias/${c.id}`, { method: 'DELETE' })
      await carregar()
    } catch (e: any) {
      alert(e.message || 'Não foi possível excluir.')
    }
  }

  const inputCls = 'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-white/20'
  const opcoesPai = categorias.filter((c) => !editando || c.id !== editando.id)

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Categorias Financeiras</h2>
          <p className="text-sm text-white/50">
            Cada categoria REFERENCIA um cadastro mestre (Documento/Serviço/Honorário/Processo) por FK. Sem texto livre.
          </p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
          + Nova categoria
        </button>
      </div>

      {/* Busca + filtro de tipo */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por mestre, nome ou descrição..."
          className="min-w-[200px] flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder-white/30 outline-none backdrop-blur focus:border-white/20"
        />
        <div className="flex overflow-hidden rounded-lg border border-white/10">
          {(['TODOS', 'ENTRADA', 'SAIDA'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFiltroTipo(t)}
              className={`px-3 py-2 text-xs transition ${filtroTipo === t ? 'bg-white/15 text-white' : 'text-white/50 hover:bg-white/5'}`}
            >
              {t === 'TODOS' ? 'Todos' : t === 'ENTRADA' ? 'Entradas' : 'Saídas'}
            </button>
          ))}
        </div>
      </div>

      {/* Estados */}
      {loading && <div className="py-12 text-center text-sm text-white/40">Carregando...</div>}

      {!loading && erroLista && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {erroLista}
          <button onClick={carregar} className="ml-3 underline hover:text-white">Tentar de novo</button>
        </div>
      )}

      {!loading && !erroLista && filtradas.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 py-12 text-center text-sm text-white/40 backdrop-blur">
          {busca || filtroTipo !== 'TODOS' ? 'Nenhuma categoria encontrada.' : 'Nenhuma categoria ainda. Crie a primeira a partir de um cadastro mestre.'}
        </div>
      )}

      {/* Tabela — Origem / Tipo / Cadastro Mestre / Status */}
      {!loading && !erroLista && filtradas.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-white/5">
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Origem</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Tipo</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Cadastro mestre</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Status</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((c) => (
                <tr key={c.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${c.origem === 'LEGADO' ? 'bg-white/10 text-white/50' : 'bg-blue-500/15 text-blue-200'}`}>
                      {ORIGEM_LABEL[c.origem]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${c.tipo === 'ENTRADA' ? 'bg-green-500/15 text-green-300' : 'bg-amber-500/15 text-amber-300'}`}>
                      {c.tipo === 'ENTRADA' ? 'Receita' : 'Custo'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: c.cor || '#64748b' }} />
                      <span className="font-medium text-white">{mestreDe(c)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${c.ativo ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-white/50'}`}>
                      {c.ativo ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => abrirEditar(c)} className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white">Editar</button>
                      <button onClick={() => excluir(c)} className="rounded-md border border-red-500/20 px-2.5 py-1 text-xs text-red-300/80 transition hover:bg-red-500/10 hover:text-red-200">Excluir</button>
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
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar categoria financeira' : 'Nova categoria financeira'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            <div className="max-h-[72vh] space-y-4 overflow-y-auto px-6 py-4">
              {/* Origem + mestre — a categoria REFERENCIA o cadastro real; nunca o recria */}
              <div>
                <label className="mb-1 block text-xs text-white/60">Origem</label>
                <select value={origem} onChange={(e) => mudarOrigem(e.target.value as OrigemKey)} disabled={origemTravada} className={inputCls + (origemTravada ? ' opacity-60' : '')}>
                  {ORIGENS.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/60">{lbl(origem)} (mestre existente)</label>
                {masterSelecionado ? (
                  <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
                    <span className="text-white">{masterSelecionado.label}{masterSelecionado.code ? <span className="text-white/40"> · {masterSelecionado.code}</span> : null}</span>
                    {!origemTravada && <button onClick={() => { setMasterId(''); setNome('') }} className="text-xs text-white/50 hover:text-white">trocar</button>}
                  </div>
                ) : (
                  <>
                    <input value={masterBusca} onChange={(e) => setMasterBusca(e.target.value)} autoFocus placeholder={`Buscar ${lbl(origem).toLowerCase()} pelo nome/código...`} className={inputCls} />
                    {masterBusca && (
                      <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-white/10 bg-zinc-900">
                        {masterFiltrado.length === 0 && <div className="px-3 py-2 text-xs text-white/40">Nenhum cadastro encontrado.</div>}
                        {masterFiltrado.map((m) => (
                          <button key={m.id} onClick={() => selecionarMaster(m)} className="block w-full px-3 py-1.5 text-left text-sm text-white/80 hover:bg-white/10">
                            {m.label}{m.code ? <span className="text-white/40"> · {m.code}</span> : null}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
                <p className="mt-1 text-[11px] text-white/40">O nome vem do mestre — não é possível redigitá-lo aqui.</p>
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/60">Nome (do mestre)</label>
                <input value={nome} readOnly disabled placeholder="Selecione um mestre acima" className={inputCls + ' opacity-60'} />
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/60">Tipo</label>
                <div className="flex overflow-hidden rounded-lg border border-white/10">
                  {(['ENTRADA', 'SAIDA'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTipo(t)}
                      className={`flex-1 px-3 py-2 text-sm transition ${tipo === t ? (t === 'ENTRADA' ? 'bg-green-500/20 text-green-200' : 'bg-amber-500/20 text-amber-200') : 'text-white/50 hover:bg-white/5'}`}
                    >
                      {t === 'ENTRADA' ? 'Receita' : 'Custo'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/60">Categoria pai (opcional)</label>
                <select value={categoriaPaiId} onChange={(e) => setCategoriaPaiId(e.target.value)} className={inputCls}>
                  <option value="" className="bg-zinc-900">— Nenhuma (categoria principal) —</option>
                  {opcoesPai.map((c) => (
                    <option key={c.id} value={c.id} className="bg-zinc-900">{c.nome} ({c.tipo === 'ENTRADA' ? 'Receita' : 'Custo'})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/60">Descrição</label>
                <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Opcional" className={inputCls + ' placeholder-white/30'} />
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/60">Cor</label>
                <div className="flex items-center gap-2">
                  {CORES.map((c) => (
                    <button key={c} type="button" onClick={() => setCor(c)} className={`h-7 w-7 rounded-full transition ${cor === c ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900' : ''}`} style={{ backgroundColor: c }} />
                  ))}
                  <input type="color" value={cor} onChange={(e) => setCor(e.target.value)} className="h-7 w-10 cursor-pointer rounded bg-transparent" />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-white/80">
                <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                Ativo
              </label>

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

'use client'

// src/components/gerenciamentoComponents/ProdutosServicosTab.tsx
// CATÁLOGO DE SERVIÇOS — a ÚNICA tela de usuário sobre o Cadastro Mestre.
//
// O Cadastro Mestre (ItemCatalogo) segue existindo como ESTRUTURA TÉCNICA
// INTERNA: mesmos registros, mesmos ids, mesmos vínculos (FKs, automações,
// integrações). O que saiu foi a segunda tela sobre ele (Sistema › Cadastros
// Auxiliares › "Catálogo Mestre"): ?screen=catalogmestre agora resolve para cá.
//
// Esta tela mostra as DUAS origens do MESMO mestre, sem cadastro paralelo:
//   • Serviço      → ServicoProduto (operacional: nacionalidade, código SRV-n),
//                    projetado no ItemCatalogo por dual-write;
//   • Item técnico → ItemCatalogo que não é projeção de serviço (documento,
//                    taxa, despesa, logística, etapa cobrada, pacote…).
// A unificação, a nomenclatura de negócio e a regra de "comercializável" vivem
// em lib/gerenciamento/catalogo-servicos.ts (pura, testada) — a tela só renderiza.
//
// SEM PREÇO: preço e comportamento financeiro continuam exclusivamente na
// Configuração Financeira + Tabela de Valores, que apenas REFERENCIAM o mestre.
// Backend: /api/gerenciamento/produtos-servicos (serviços) e
//          /api/gerenciamento/catalogo-mestre (itens técnicos do mesmo mestre).

import { useState, useEffect, useMemo, useCallback } from 'react'
import { usePermissoes } from '@/src/hooks/use-permissoes'
import { ExclusaoDefinitivaModal } from './ExclusaoDefinitivaModal'
import { CodigoPublicoField } from './CodigoPublicoField'
import {
  unificarCatalogo, filtrarCatalogo, contarPorEscopo,
  rotuloTipo, TIPOS_CADASTRAVEIS, ESCOPOS,
  type ItemUnificado, type EscopoCatalogo, type ServicoBruto, type ItemMestreBruto,
} from '@/lib/gerenciamento/catalogo-servicos'

// Nacionalidades/modalidades aplicáveis ao serviço (conjunto operacional fixo).
const NACIONALIDADES: [string, string][] = [
  ['all', 'Todas'], ['italiano', 'Italiana'], ['espanhol', 'Espanhola'],
  ['portugues', 'Portuguesa'], ['alemao', 'Alemã'],
]
const nacLabel = (v: string) => NACIONALIDADES.find(([k]) => k === v)?.[1] || v || '—'

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

const URL_SERVICOS = '/api/gerenciamento/produtos-servicos'
const URL_MESTRE = '/api/gerenciamento/catalogo-mestre'

export default function ProdutosServicosTab() {
  const [servicos, setServicos] = useState<ServicoBruto[]>([])
  const [itens, setItens] = useState<ItemMestreBruto[]>([])
  const [unidades, setUnidades] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [escopo, setEscopo] = useState<EscopoCatalogo>('comercial')

  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<ItemUnificado | null>(null)
  const { pode } = usePermissoes()
  const podeExcluirDefinitivo = pode('sistema.exclusaoDefinitiva')
  const [modalExcluir, setModalExcluir] = useState<ItemUnificado | null>(null)
  // Formulário: `tipo` decide para QUAL cadastro do mestre a linha vai (Serviço
  // = registro operacional; demais = item técnico). Não há terceira via.
  const [tipo, setTipo] = useState<string>('SERVICO')
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [descricao, setDescricao] = useState('')
  const [unidade, setUnidade] = useState('')
  const [nationality, setNationality] = useState('all')
  const [ativo, setAtivo] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)

  // Carga da tela em UM lugar: `buscar` só faz rede, `aplicar` só escreve estado.
  // As duas origens do MESMO mestre são lidas juntas (nunca meia tela).
  const buscar = useCallback(async (sinal?: AbortSignal) => {
    const [s, m] = await Promise.all([
      jsonFetch(URL_SERVICOS, { cache: 'no-store', signal: sinal }),
      jsonFetch(URL_MESTRE, { cache: 'no-store', signal: sinal }),
    ])
    return { s, m }
  }, [])
  const aplicar = useCallback((d: { s: any; m: any }) => {
    setServicos(d.s?.servicos || [])
    setItens(d.m?.itens || [])
    setUnidades(d.m?.unidades || [])
  }, [])

  // MONTAGEM: o efeito não escreve estado de forma síncrona (`loading` já nasce
  // true e `erroLista` nasce null) — a escrita acontece na continuação da promessa.
  useEffect(() => {
    const ac = new AbortController()
    buscar(ac.signal)
      .then((d) => { if (!ac.signal.aborted) aplicar(d) })
      .catch((e: any) => { if (!ac.signal.aborted) setErroLista(e.message || 'Não foi possível carregar o catálogo.') })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [buscar, aplicar])

  // RECARGA por ação do usuário (salvar/excluir): aí sim volta ao carregamento.
  const carregar = useCallback(async () => {
    setLoading(true); setErroLista(null)
    try { aplicar(await buscar()) }
    catch (e: any) { setErroLista(e.message || 'Não foi possível carregar o catálogo.') }
    finally { setLoading(false) }
  }, [buscar, aplicar])

  // Derivados: unificação + filtro vêm da fonte única pura.
  const linhas = useMemo(() => unificarCatalogo({ servicos, itens }), [servicos, itens])
  const contagem = useMemo(() => contarPorEscopo(linhas), [linhas])
  const filtrados = useMemo(() => filtrarCatalogo(linhas, { escopo, busca }), [linhas, escopo, busca])

  const ehServico = tipo === 'SERVICO'

  function abrirNovo() {
    setEditando(null)
    setTipo('SERVICO')
    setName(''); setCategory(''); setDescricao(''); setUnidade(''); setNationality('all'); setAtivo(true)
    setErroModal(null); setModalAberto(true)
  }
  function abrirEditar(l: ItemUnificado) {
    setEditando(l)
    // Serviço não troca de tipo: o registro operacional é, por definição, serviço.
    setTipo(l.origem === 'servico' ? 'SERVICO' : l.natureza)
    setName(l.nome); setCategory(l.categoria || '')
    setDescricao(l.descricao || '')
    setUnidade(l.unidade || '')
    setNationality(l.nacionalidade || 'all'); setAtivo(l.ativo)
    setErroModal(null); setModalAberto(true)
  }

  async function salvar() {
    if (!name.trim()) { setErroModal('Informe o nome.'); return }
    setSalvando(true); setErroModal(null)
    try {
      // Código público (SRV-n) e chave técnica interna são gerados no BACKEND —
      // o frontend nunca envia identificador técnico.
      if (tipo === 'SERVICO' && (!editando || editando.origem === 'servico')) {
        const body = JSON.stringify({
          name: name.trim(),
          category: category.trim() || null,
          descricao: descricao.trim() || null,
          unidadePadrao: unidade || null,
          nationality,
          ativo,
        })
        if (editando) await jsonFetch(`${URL_SERVICOS}/${editando.id}`, { method: 'PUT', body })
        else await jsonFetch(URL_SERVICOS, { method: 'POST', body })
      } else {
        const body = JSON.stringify({
          name: name.trim(),
          categoria: category.trim() || null,
          descricao: descricao.trim() || null,
          natureza: tipo,
          unidade: unidade || undefined,
          ativo,
        })
        if (editando) await jsonFetch(`${URL_MESTRE}/${editando.id}`, { method: 'PUT', body })
        else await jsonFetch(URL_MESTRE, { method: 'POST', body })
      }
      setModalAberto(false)
      await carregar()
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(l: ItemUnificado) {
    // Com permissão de exclusão definitiva: modal com 2 opções (inativar × excluir).
    if (podeExcluirDefinitivo) { setModalExcluir(l); return }
    // Sem permissão: o botão não mente — informa o que REALMENTE aconteceu.
    const alvo = l.origem === 'servico' ? 'serviço' : 'item'
    if (!confirm(`Excluir o ${alvo} "${l.nome}"?\n\nSe já tiver uso, será apenas inativado para preservar o histórico.`)) return
    try {
      const base = l.origem === 'servico' ? URL_SERVICOS : URL_MESTRE
      const r: any = await jsonFetch(`${base}/${l.id}`, { method: 'DELETE' })
      await carregar()
      if (r?.inativado) alert(`${alvo === 'serviço' ? 'Serviço' : 'Item'} inativado.${r?.motivo ? `\n\n${r.motivo}` : ''}`)
      else if (r?.excluido || r?.ok) alert(`${alvo === 'serviço' ? 'Serviço' : 'Item'} excluído.`)
    } catch (e: any) {
      alert(e.message || 'Não foi possível excluir.')
    }
  }

  const inputCls = 'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20'
  const urlExclusao = (l: ItemUnificado) =>
    `${l.origem === 'servico' ? URL_SERVICOS : URL_MESTRE}/${l.id}/exclusao-definitiva`

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Catálogo de Serviços</h2>
          <p className="text-sm text-white/50">
            Cadastro único do que a empresa vende e executa (assessoria, tradução, apostilamento, retificação,
            busca genealógica, logística…) e dos itens cobráveis relacionados — documentos, taxas, etapas e pacotes.
            O preço e a configuração financeira vivem no Financeiro, que apenas referencia este cadastro.
          </p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
          + Novo item
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
          {ESCOPOS.map((e) => (
            <button
              key={e.valor}
              onClick={() => setEscopo(e.valor)}
              title={e.ajuda}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${escopo === e.valor ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80'}`}
            >
              {e.label}
              <span className="ml-1.5 text-[10px] text-white/40">{contagem[e.valor]}</span>
            </button>
          ))}
        </div>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por código (SRV-n), nome, categoria ou tipo..."
          className="min-w-[240px] flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder-white/30 outline-none backdrop-blur focus:border-white/20"
        />
      </div>

      {loading && <div className="py-12 text-center text-sm text-white/40">Carregando...</div>}

      {!loading && erroLista && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {erroLista}
          <button onClick={carregar} className="ml-3 underline hover:text-white">Tentar de novo</button>
        </div>
      )}

      {!loading && !erroLista && filtrados.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 py-12 text-center text-sm text-white/40 backdrop-blur">
          {busca ? 'Nenhum item encontrado.' : escopo === 'tecnico' ? 'Nenhum item técnico sem cobrança.' : 'Nenhum item ainda. Crie o primeiro.'}
        </div>
      )}

      {!loading && !erroLista && filtrados.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-white/5">
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Código</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Nome</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Tipo</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Categoria</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Unidade</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Vínculos</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Status</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((l) => (
                <tr key={l.chave} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5 font-mono text-[12px] font-bold text-white/90">{l.codigo ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-white">{l.nome}</div>
                    {l.descricao && <div className="text-[11px] text-white/40">{l.descricao}</div>}
                    {l.origem === 'servico' && l.nacionalidade && l.nacionalidade !== 'all' && (
                      <div className="text-[11px] text-white/40">{nacLabel(l.nacionalidade)}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-white/70">{l.tipo}</td>
                  <td className="px-4 py-2.5 text-white/70">{l.categoria || '—'}</td>
                  <td className="px-4 py-2.5 text-white/70">{l.unidade || '—'}</td>
                  <td className="px-4 py-2.5">
                    {l.vinculos > 0
                      ? <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] text-blue-300" title="Configurações financeiras, preços e tipos de documento que apontam para este item">{l.vinculos}</span>
                      : <span className="text-white/30">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${l.ativo ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-white/50'}`}>
                      {l.ativo ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => abrirEditar(l)} className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white">Editar</button>
                      <button onClick={() => excluir(l)} className="rounded-md border border-red-500/20 px-2.5 py-1 text-xs text-red-300/80 transition hover:bg-red-500/10 hover:text-red-200">Excluir</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <h3 className="text-lg font-semibold text-white">{editando ? `Editar ${rotuloTipo(editando.natureza).toLowerCase()}` : 'Novo item do catálogo'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            <div className="space-y-4 px-6 py-4">
              {(!editando || editando.origem === 'servico') && <CodigoPublicoField codigo={editando?.codigo ?? null} />}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Tipo</label>
                  <select
                    value={tipo}
                    onChange={(e) => setTipo(e.target.value)}
                    disabled={!!editando && editando.origem === 'servico'}
                    className={`${inputCls} disabled:opacity-60`}
                    title={editando && editando.origem === 'servico' ? 'Um serviço cadastrado permanece serviço (o vínculo financeiro depende disso).' : undefined}
                  >
                    {TIPOS_CADASTRAVEIS.map((t) => <option key={t} value={t} className="bg-zinc-900">{rotuloTipo(t)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Unidade</label>
                  <select value={unidade} onChange={(e) => setUnidade(e.target.value)} className={inputCls}>
                    <option value="" className="bg-zinc-900">— não definida</option>
                    {unidades.map((u) => <option key={u} value={u} className="bg-zinc-900">{u}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/60">Nome</label>
                <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Tradução Juramentada" className={inputCls} />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Categoria</label>
                  <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="cidadania, traducao, apostilamento..." className={inputCls} />
                </div>
                {ehServico && (
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Nacionalidade / modalidade</label>
                    <select value={nationality} onChange={(e) => setNationality(e.target.value)} className={inputCls}>
                      {NACIONALIDADES.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                    </select>
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/60">Descrição</label>
                <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2} placeholder="O que o item entrega..." className={inputCls} />
              </div>

              <label className="flex items-center gap-2 text-sm text-white/80">
                <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                Ativo
              </label>

              {editando && editando.vinculos > 0 && (
                <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white/60">
                  Este item tem <b className="text-white/80">{editando.vinculos}</b> vínculo(s) em uso (configuração financeira, preço ou tipo de documento).
                  Editar o nome preserva os vínculos; para tirá-lo de circulação, desmarque <b className="text-white/80">Ativo</b> em vez de excluir.
                </div>
              )}

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

      {modalExcluir && (
        <ExclusaoDefinitivaModal
          titulo={`Excluir ${rotuloTipo(modalExcluir.natureza).toLowerCase()} · ${modalExcluir.nome}`}
          entidadeLabel={rotuloTipo(modalExcluir.natureza)}
          previewUrl={urlExclusao(modalExcluir)}
          deleteUrl={urlExclusao(modalExcluir)}
          onInativar={modalExcluir.origem === 'servico'
            ? async () => { await jsonFetch(`${URL_SERVICOS}/${modalExcluir.id}`, { method: 'DELETE' }) }
            : undefined}
          onDone={() => { setModalExcluir(null); void carregar() }}
          onClose={() => setModalExcluir(null)}
        />
      )}
    </div>
  )
}

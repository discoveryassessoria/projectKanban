'use client'

// src/components/gerenciamentoComponents/ProdutosTab.tsx
// Configurações Financeiras (tabela ProdutoFinanceiro) — UMA config por cadastro mestre.
// Custo e receita NÃO são registros independentes: são VALORES desta config
// (possuiCusto/possuiReceita + valorCustoPadrao/valorReceitaPadrao). O papel financeiro
// vive só na entidade de valores (TabelaValor.natureza).
// Backend: /api/gerenciamento/produtos (GET/POST) + /[id] (PUT/DELETE).

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useApi } from '@/src/lib/dados'
import { usePermissoes } from '@/src/hooks/use-permissoes'
import { ExclusaoDefinitivaModal } from './ExclusaoDefinitivaModal'
import {
  nomeExibidoDoMestre, combinaComBusca, mestreDaConfiguracao, mestreSelecionavel,
  type MestreFinanceiro,
} from '@/lib/gerenciamento/mestre-financeiro'

type ComissaoRef = { id: number; name: string; ativo: boolean }
type Produto = {
  id: number
  publicCode: string | null   // CFG-n — código PÚBLICO da configuração (backend, automático)
  codigo: string              // id técnico interno (NOT NULL, não exibido)
  nome: string
  especie: string | null
  naturezaFinanceira: string | null
  moedaPadrao: string
  // M-UNIFICA — custo e receita como valores da MESMA config
  possuiCusto: boolean
  possuiReceita: boolean
  valorCustoPadrao: string | number | null
  valorReceitaPadrao: string | number | null
  cobravelDoCliente: boolean
  repasse: boolean
  reembolsavel: boolean
  ativo: boolean
  regraComissaoId: number | null
  regraComissao?: ComissaoRef | null
  tipoDocumentoId: number | null
  honorarioId: number | null
  tipoProcessoId: number | null
  itemCatalogoId: number | null
  fornecedorPadraoId: number | null
  // Mestre REAL resolvido pelo backend. codigo = chave técnica; publicCode = código público do
  // mestre quando ele tem um (ex.: Serviço → SRV-n).
  mestre?: { origem: string; codigo: string | null; nome: string; publicCode: string | null } | null
}

const MOEDAS: [string, string][] = [['BRL', 'Real (BRL)'], ['EUR', 'Euro (EUR)'], ['USD', 'Dólar (USD)']]
// Origem do cadastro MESTRE (nunca recriado aqui). O papel financeiro NÃO é mais atributo
// da config — custo/receita são valores (checkboxes + valores abaixo).
const ORIGENS: [string, string][] = [
  ['documento', 'Documento'], ['servico', 'Serviço'], ['honorario', 'Honorário'], ['processo', 'Processo / Modalidade'],
]
// Origens CRIÁVEIS — só cadastros mestres oficiais. "Honorário" saiu da arquitetura
// (honorário é Serviço do Catálogo Mestre + Configuração Financeira + preço na Tabela
// de Valores). O rótulo continua em ORIGENS apenas para LER as configurações antigas
// que ainda apontam para o mestre legado — o backend recusa novos vínculos.
const ORIGENS_CRIAVEIS: [string, string][] = ORIGENS.filter(([k]) => k !== 'honorario')
// O mestre chega em campos SEPARADOS (sourceId/sourceType/sourceCode/masterKey/
// displayName) e a tela renderiza só `displayName`. Rótulo pré-concatenado não
// existe aqui — era exatamente por onde "SRV-8 — Nome · CHAVE" vazava.
type MestreRef = MestreFinanceiro
type Mestres = { documento: MestreRef[]; servico: MestreRef[]; honorario: MestreRef[]; processo: MestreRef[] }
type FornecedorRef = { id: number; nome: string; publicCode: string | null }
const MESTRES_VAZIO: Mestres = { documento: [], servico: [], honorario: [], processo: [] }
// Forma da resposta de /produtos. Antes era lida com `(d as any).x` — o `as any`
// escondia justamente os campos opcionais que a normalização abaixo trata.
type MestreBruto = { id: number; name: string; code?: string | null; publicCode?: string | null }
type RespostaProdutos = {
  produtos?: Produto[]
  mestres?: {
    tiposDocumento?: MestreBruto[]
    servicos?: MestreBruto[]
    honorarios?: MestreBruto[]
    tiposProcesso?: MestreBruto[]
    fornecedores?: { id: number; nome: string; publicCode?: string | null }[]
  }
}
// Listas vazias como constantes: literal novo por render trocaria a identidade da
// dependência e faria os memos desta tela recalcularem sempre.
const SEM_PRODUTOS: Produto[] = []
const SEM_COMISSOES: ComissaoRef[] = []
// Rótulo da ORIGEM estrutural do mestre (Documento/Serviço/...). Usado na coluna e busca.
const ORIGEM_LABEL: Record<string, string> = { documento: 'Documento', servico: 'Serviço', honorario: 'Honorário', processo: 'Processo', item: 'Item' }
const origemLabel = (o?: string | null) => (o ? (ORIGEM_LABEL[o] ?? o) : '—')
// mapeia origem → campo FK enviado no POST
const FK_POR_ORIGEM: Record<string, 'tipoDocumentoId' | 'honorarioId' | 'tipoProcessoId' | 'itemCatalogoId'> = {
  documento: 'tipoDocumentoId', honorario: 'honorarioId', processo: 'tipoProcessoId', servico: 'itemCatalogoId',
}

const lbl = (arr: [string, string][], v: string | null) => arr.find(([k]) => k === v)?.[1] || v || '—'
const fmtMoney = (v: any, moeda?: string) =>
  v == null || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: moeda || 'BRL' })

// PREÇO-FONTE-ÚNICA — Natureza Financeira estrutural (o QUE o item gera). Os valores
// (preço) NÃO vivem mais na Configuração Financeira: vão para a Tabela de Preços.
const NATUREZA_FIN: [string, string][] = [
  ['SOMENTE_CUSTO', 'Somente custo'],
  ['SOMENTE_RECEITA', 'Somente receita'],
  ['CUSTO_E_RECEITA', 'Custo e receita'],
]
const natFinDe = (possuiCusto: boolean, possuiReceita: boolean) =>
  possuiCusto && possuiReceita ? 'CUSTO_E_RECEITA' : possuiCusto ? 'SOMENTE_CUSTO' : 'SOMENTE_RECEITA'

const EMPTY = {
  origem: 'documento', masterId: '',
  possuiCusto: false, possuiReceita: true,
  naturezaFin: 'SOMENTE_RECEITA',
  valorCustoPadrao: '', valorReceitaPadrao: '',
  codigo: '', nome: '', naturezaFinanceira: 'revenue',
  moedaPadrao: 'BRL', fornecedorPadraoId: '', regraComissaoId: '',
  cobravelDoCliente: false, repasse: false, reembolsavel: false, ativo: true,
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

const Check = ({ ok }: { ok: boolean }) =>
  ok ? <span className="text-green-300">✓</span> : <span className="text-white/25">—</span>

export default function ProdutosTab() {
  // Duas leituras pela camada oficial. A lista de regras de comissão é de APOIO ao
  // formulário e segue TOLERANTE: falha nela não pode impedir a tela de mostrar as
  // configurações.
  const produtosReq = useApi<RespostaProdutos>('/api/gerenciamento/produtos')
  const comissoesReq = useApi<{ regras?: ComissaoRef[] }>('/api/gerenciamento/regras-comissao')
  const produtos = produtosReq.dados?.produtos ?? SEM_PRODUTOS
  const comissoes = (comissoesReq.dados?.regras ?? SEM_COMISSOES).filter((r) => r.ativo)
  // A resposta dos mestres é normalizada para o formato dos selects. Como isso é
  // derivação pura, vive num useMemo e não em estado copiado por efeito.
  const mestres = useMemo<Mestres>(() => {
    const m = produtosReq.dados?.mestres
    if (!m) return MESTRES_VAZIO
    return {
      documento: (m.tiposDocumento ?? []).map((d) => mestreSelecionavel('documento', d)),
      servico: (m.servicos ?? []).map((x) => mestreSelecionavel('servico', x)),
      honorario: (m.honorarios ?? []).map((h) => mestreSelecionavel('honorario', h)),
      processo: (m.tiposProcesso ?? []).map((p) => mestreSelecionavel('processo', p)),
    }
  }, [produtosReq.dados])
  const fornecedores = useMemo<FornecedorRef[]>(
    () => (produtosReq.dados?.mestres?.fornecedores ?? []).map((f) => ({ id: f.id, nome: f.nome, publicCode: f.publicCode ?? null })),
    [produtosReq.dados],
  )
  const loading = produtosReq.carregando
  const carregar = produtosReq.recarregar
  const [masterBusca, setMasterBusca] = useState('')
  const [erroEscritaLista, setErroEscritaLista] = useState<string | null>(null)
  const erroLista = erroEscritaLista ?? (produtosReq.erro ? produtosReq.erro.message : null)
  const setErroLista = setErroEscritaLista
  const [busca, setBusca] = useState('')
  const [mostrarInativos, setMostrarInativos] = useState(false)

  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Produto | null>(null)
  const { pode } = usePermissoes()
  const podeExcluirDefinitivo = pode('sistema.exclusaoDefinitiva')
  const [modalExcluir, setModalExcluir] = useState<Produto | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)

  const set = (k: keyof FormState, v: any) => setForm((f) => ({ ...f, [k]: v }))

  const filtrados = useMemo(() => {
    const base = mostrarInativos ? produtos : produtos.filter((p) => p.ativo)
    const q = busca.trim().toLowerCase()
    if (!q) return base
    // Busca sobre os termos TÉCNICOS também (SRV-n, chave, origem) — o que a
    // tela deixou de exibir continua encontrável.
    return base.filter((p) =>
      combinaComBusca(mestreDaConfiguracao(p), q) ||
      origemLabel(p.mestre?.origem).toLowerCase().includes(q)
    )
  }, [produtos, busca, mostrarInativos])

  const qtdInativos = useMemo(() => produtos.filter((p) => !p.ativo).length, [produtos])

  const masterFiltrado = useMemo(() => {
    const arr = mestres[form.origem as keyof Mestres] ?? []
    const q = masterBusca.trim().toLowerCase()
    if (!q) return arr.slice(0, 50)
    return arr.filter((m) => combinaComBusca(m, q)).slice(0, 50)
  }, [mestres, form.origem, masterBusca])
  // Na EDIÇÃO o mestre já está travado: exibe o que a própria configuração guarda,
  // sem depender da lista de mestres selecionáveis (que só traz cadastros oficiais).
  const masterSelecionado =
    (mestres[form.origem as keyof Mestres] ?? []).find((m) => String(m.sourceId) === form.masterId)
    ?? (editando && form.masterId
      ? mestreDaConfiguracao({ id: Number(form.masterId), nome: form.nome, mestre: editando.mestre })
      : null)

  // O nome/código de negócio vêm do MESTRE (não são montados aqui). Só guardamos o
  // vínculo (masterId) e o nome real do mestre para exibição; o código real é do mestre.
  function selecionarMaster(m: MestreRef) {
    // `nome` recebe o displayName PURO. Com o rótulo concatenado, "SRV-8 —
    // Apostilamento de Tradução" ia parar no corpo do POST — o vazamento
    // chegava ao dado, não só à tela.
    setForm((f) => ({ ...f, masterId: String(m.sourceId), nome: nomeExibidoDoMestre(m), codigo: '' }))
    setMasterBusca('')
  }
  function mudarOrigem(origem: string) {
    setForm((f) => ({ ...f, origem, masterId: '', codigo: '', nome: '' })); setMasterBusca('')
  }

  function abrirNovo() {
    setEditando(null); setForm(EMPTY); setMasterBusca(''); setErroModal(null); setModalAberto(true)
  }
  function abrirEditar(p: Produto) {
    setEditando(p)
    const origem = p.tipoDocumentoId ? 'documento' : p.honorarioId ? 'honorario' : p.tipoProcessoId ? 'processo' : 'servico'
    const masterId = p.tipoDocumentoId ?? p.honorarioId ?? p.tipoProcessoId ?? p.itemCatalogoId ?? null
    setForm({
      origem, masterId: masterId ? String(masterId) : '',
      possuiCusto: p.possuiCusto, possuiReceita: p.possuiReceita,
      naturezaFin: natFinDe(p.possuiCusto, p.possuiReceita),
      valorCustoPadrao: p.valorCustoPadrao != null ? String(p.valorCustoPadrao) : '',
      valorReceitaPadrao: p.valorReceitaPadrao != null ? String(p.valorReceitaPadrao) : '',
      codigo: '', nome: p.mestre?.nome || p.nome,
      naturezaFinanceira: p.naturezaFinanceira || 'revenue',
      moedaPadrao: p.moedaPadrao || 'BRL',
      fornecedorPadraoId: p.fornecedorPadraoId ? String(p.fornecedorPadraoId) : '',
      regraComissaoId: p.regraComissaoId ? String(p.regraComissaoId) : '',
      cobravelDoCliente: p.cobravelDoCliente,
      repasse: p.repasse, reembolsavel: p.reembolsavel, ativo: p.ativo,
    })
    setMasterBusca(''); setErroModal(null); setModalAberto(true)
  }

  async function salvar() {
    if (!form.masterId) { setErroModal('Selecione a entidade mestre (origem). O nome/código vêm dela.'); return }
    if (!form.naturezaFin) { setErroModal('Selecione a Natureza Financeira.'); return }
    const geraCusto = form.naturezaFin !== 'SOMENTE_RECEITA'
    if (form.reembolsavel && !geraCusto) { setErroModal('Reembolsável só se aplica a itens que geram custo.'); return }
    setSalvando(true); setErroModal(null)
    try {
      const fkField = FK_POR_ORIGEM[form.origem]
      // PREÇO-FONTE-ÚNICA — envia a Natureza Financeira (estrutural); o backend deriva
      // possuiCusto/possuiReceita. Valores de preço NÃO são enviados: vivem na Tabela de
      // Preços e os campos legado são preservados (o PUT mantém o que for omitido).
      const { valorCustoPadrao: _vc, valorReceitaPadrao: _vr, ...rest } = form
      void _vc; void _vr
      const body = JSON.stringify({
        ...rest,
        [fkField]: Number(form.masterId),
        naturezaFin: form.naturezaFin,
        possuiCusto: form.naturezaFin !== 'SOMENTE_RECEITA',
        possuiReceita: form.naturezaFin !== 'SOMENTE_CUSTO',
        fornecedorPadraoId: form.fornecedorPadraoId || null,
        regraComissaoId: form.regraComissaoId || null,
      })
      if (editando) {
        await jsonFetch(`/api/gerenciamento/produtos/${editando.id}`, { method: 'PUT', body })
      } else {
        await jsonFetch('/api/gerenciamento/produtos', { method: 'POST', body })
      }
      setModalAberto(false)
      await carregar()
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(p: Produto) {
    // Com permissão sistema.exclusaoDefinitiva: modal com 2 opções (inativar × excluir definitivo).
    if (podeExcluirDefinitivo) { setModalExcluir(p); return }
    // Usuário comum: regra geral inalterada — nunca apaga; no máximo inativa (o backend decide).
    const nome = p.mestre?.nome || p.nome
    if (!confirm(`Inativar a Configuração Financeira de "${nome}"?\n\nPreços, regras e histórico são preservados. Excluir definitivamente é restrito a administradores.`)) return
    try {
      const r: any = await jsonFetch(`/api/gerenciamento/produtos/${p.id}`, { method: 'DELETE' })
      await carregar()
      if (r?.inativado && r?.motivo) alert(r.motivo)
    } catch (e: any) {
      alert(e.message || 'Não foi possível excluir.')
    }
  }

  const inputCls = 'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Configurações Financeiras</h2>
          <p className="text-sm text-white/50">Uma configuração por cadastro mestre. Custo e receita são valores dela.</p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
          + Nova configuração
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar (código CFG-n, cadastro mestre, chave ou origem)..."
          className="min-w-[220px] flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder-white/30 outline-none backdrop-blur focus:border-white/20"
        />
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-white/60 select-none">
          <input
            type="checkbox"
            checked={mostrarInativos}
            onChange={(e) => setMostrarInativos(e.target.checked)}
            className="h-4 w-4 accent-blue-500"
          />
          Mostrar inativos{qtdInativos > 0 ? ` (${qtdInativos})` : ''}
        </label>
      </div>

      {loading && <div className="py-12 text-center text-sm text-white/40">Carregando...</div>}

      {!loading && erroLista && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {erroLista}
          <button onClick={() => { void carregar() }} className="ml-3 underline hover:text-white">Tentar de novo</button>
        </div>
      )}

      {!loading && !erroLista && filtrados.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 py-12 text-center text-sm text-white/40 backdrop-blur">
          {busca ? 'Nenhuma configuração encontrada.' : 'Nenhuma configuração ainda. Crie a primeira.'}
        </div>
      )}

      {!loading && !erroLista && filtrados.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-white/5">
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Cadastro mestre</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Origem</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Natureza financeira</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Status</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((p) => (
                <tr key={p.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5">
                    {/* Só o nome legível. Código (SRV-n) e chave estrutural são do
                        cadastro de ORIGEM — vivem no Catálogo de Serviços. */}
                    <div className="font-medium text-white">{nomeExibidoDoMestre(mestreDaConfiguracao(p))}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${p.mestre?.origem === 'servico' ? 'bg-sky-500/15 text-sky-300' : p.mestre?.origem === 'documento' ? 'bg-indigo-500/15 text-indigo-300' : 'bg-white/10 text-white/60'}`}>{origemLabel(p.mestre?.origem)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-white/80">{lbl(NATUREZA_FIN, natFinDe(p.possuiCusto, p.possuiReceita))}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${p.ativo ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-white/50'}`}>
                        {p.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                      {p.cobravelDoCliente && <span className="rounded px-2 py-0.5 text-[11px] font-medium bg-blue-500/15 text-blue-300">Cobrável</span>}
                      {p.repasse && <span className="rounded px-2 py-0.5 text-[11px] font-medium bg-purple-500/15 text-purple-300">Repasse</span>}
                      {p.reembolsavel && <span className="rounded px-2 py-0.5 text-[11px] font-medium bg-teal-500/15 text-teal-300">Reembolsável</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => abrirEditar(p)} className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white">Editar</button>
                      <button onClick={() => excluir(p)} className="rounded-md border border-red-500/20 px-2.5 py-1 text-xs text-red-300/80 transition hover:bg-red-500/10 hover:text-red-200">Excluir</button>
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
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar Configuração Financeira' : 'Nova Configuração Financeira'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            <div className="max-h-[72vh] space-y-5 overflow-y-auto px-6 py-5">
              {/* Entidade mestre — a config REFERENCIA o cadastro real; nunca o recria */}
              <Secao titulo="Entidade mestre" primeira>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Origem do cadastro</label>
                  <select value={form.origem} onChange={(e) => mudarOrigem(e.target.value)} disabled={!!editando} className={inputCls + (editando ? ' opacity-60' : '')}>
                    {(editando ? ORIGENS : ORIGENS_CRIAVEIS).map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">{lbl(ORIGENS, form.origem)} (mestre existente)</label>
                  {masterSelecionado ? (
                    <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
                      <span className="text-white">{nomeExibidoDoMestre(masterSelecionado)}</span>
                      {!editando && <button onClick={() => setForm((f) => ({ ...f, masterId: '', codigo: '', nome: '' }))} className="text-xs text-white/50 hover:text-white">trocar</button>}
                    </div>
                  ) : (
                    <>
                      <input value={masterBusca} onChange={(e) => setMasterBusca(e.target.value)} autoFocus placeholder={`Buscar ${lbl(ORIGENS, form.origem).toLowerCase()} pelo nome/código...`} className={inputCls} />
                      {masterBusca && (
                        <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-white/10 bg-zinc-900">
                          {masterFiltrado.length === 0 && <div className="px-3 py-2 text-xs text-white/40">Nenhum cadastro encontrado.</div>}
                          {masterFiltrado.map((m) => (
                            <button key={m.sourceId} onClick={() => selecionarMaster(m)} className="block w-full px-3 py-1.5 text-left text-sm text-white/80 hover:bg-white/10">
                              {nomeExibidoDoMestre(m)}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  <p className="mt-1 text-[11px] text-white/40">O nome vem do cadastro mestre — não é possível redigitá-lo aqui. O código e a chave ficam no cadastro de origem, no Catálogo de Serviços.</p>
                </div>
              </Secao>

              {/* Custo e receita — valores da MESMA configuração */}
              <Secao titulo="Custo e receita">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Moeda padrão</label>
                  <select value={form.moedaPadrao} onChange={(e) => set('moedaPadrao', e.target.value)} className={inputCls + ' max-w-[12rem]'}>
                    {MOEDAS.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Natureza financeira</label>
                  <select value={form.naturezaFin} onChange={(e) => set('naturezaFin', e.target.value)} className={inputCls}>
                    {NATUREZA_FIN.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                  </select>
                </div>
                <p className="text-[11px] text-white/40">A Configuração Financeira define <b>o que</b> é o item. Os <b>preços</b> (custo/venda) vivem na Tabela de Preços — cadastre-os lá conforme a natureza escolhida.</p>
              </Secao>

              {/* Vínculos — o comportamento financeiro vive AQUI, no cadastro mestre.
                  Não há classificação intermediária (categoria/conta/centro de custo). */}
              <Secao titulo="Vínculos">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Regra de comissão (quando aplicável)</label>
                  <select value={form.regraComissaoId} onChange={(e) => set('regraComissaoId', e.target.value)} className={inputCls}>
                    <option value="" className="bg-zinc-900">— Sem comissão —</option>
                    {comissoes.map((r) => <option key={r.id} value={r.id} className="bg-zinc-900">{r.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Fornecedor padrão (opcional)</label>
                  <select value={form.fornecedorPadraoId} onChange={(e) => set('fornecedorPadraoId', e.target.value)} className={inputCls}>
                    <option value="" className="bg-zinc-900">— Nenhum —</option>
                    {fornecedores.map((f) => <option key={f.id} value={f.id} className="bg-zinc-900">{f.publicCode ? f.publicCode + ' — ' : ''}{f.nome}</option>)}
                  </select>
                </div>
              </Secao>

              {/* Marcações */}
              <Secao titulo="Marcações">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <label className="flex items-center gap-2 text-sm text-white/80">
                    <input type="checkbox" checked={form.cobravelDoCliente} onChange={(e) => set('cobravelDoCliente', e.target.checked)} className="h-4 w-4 accent-blue-500" />
                    Cobrável do cliente
                  </label>
                  <label className="flex items-center gap-2 text-sm text-white/80" title="Item é um valor de terceiros repassado ao cliente (pass-through, sem margem).">
                    <input type="checkbox" checked={form.repasse} onChange={(e) => set('repasse', e.target.checked)} className="h-4 w-4 accent-blue-500" />
                    Repasse
                  </label>
                  <label className="flex items-center gap-2 text-sm text-white/80" title="Os custos gerados por este item podem ser reembolsados pelo cliente.">
                    <input type="checkbox" checked={form.reembolsavel} onChange={(e) => set('reembolsavel', e.target.checked)} className="h-4 w-4 accent-blue-500" />
                    Reembolsável
                  </label>
                  <label className="flex items-center gap-2 text-sm text-white/80">
                    <input type="checkbox" checked={form.ativo} onChange={(e) => set('ativo', e.target.checked)} className="h-4 w-4 accent-blue-500" />
                    Ativo
                  </label>
                </div>
                <div className="mt-2 space-y-0.5 text-[11px] text-white/40">
                  <p><b>Repasse</b>: valor de terceiros repassado ao cliente (pass-through, sem margem/serviço próprio).</p>
                  <p><b>Reembolsável</b>: os custos gerados por este item podem ser reembolsados pelo cliente.</p>
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

      {modalExcluir && (
          <ExclusaoDefinitivaModal
          entidadeLabel="Configuração Financeira"
          titulo={`Excluir Configuração Financeira · ${modalExcluir.mestre?.nome || modalExcluir.nome}`}
          previewUrl={`/api/gerenciamento/produtos/${modalExcluir.id}/exclusao-definitiva`}
          deleteUrl={`/api/gerenciamento/produtos/${modalExcluir.id}/exclusao-definitiva`}
          onInativar={async () => { await jsonFetch(`/api/gerenciamento/produtos/${modalExcluir.id}`, { method: 'DELETE' }) }}
          onDone={() => { setModalExcluir(null); void carregar() }}
          onClose={() => setModalExcluir(null)}
        />
      )}
    </div>
  )
}

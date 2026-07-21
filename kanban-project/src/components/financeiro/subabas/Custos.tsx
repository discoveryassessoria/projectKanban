// src/components/financeiro/subabas/Custos.tsx
//
// 🆕 Fase 3 v2.1 — Custos com view router interno.
//
// Estrutura:
//   - View 'lista':
//       Section 1: 📂 Pasta Documental (TabelaCustos antiga, intocada)
//       Section 2: 🧾 Registrar Custos (Fase 3 — KPIs + tabela)
//   - View 'nova'   → renderiza <NovoCustoPagina />
//   - View 'editar' → renderiza <NovoCustoPagina custoInicial={...} />
//   - View 'lancar' → renderiza <LancarParcelaPagina tipo="custo" />
//
// 🆕 v2.1 — KPIs em BRL principal (igual ao Receitas).
// 🆕 v2   — Header da coluna "Total (orig.)" sempre.
//         — Filtra custos cancelados (cancelado=true) antes de tudo.
//         — Aba 📝 Rascunhos após "A pagar".
//         — Linha de rascunho com botões Editar / Excluir.
//         — KPIs agora consideram apenas custos ATIVOS (rascunhos fora).

'use client'

import '@/src/styles/financeiro-paginas.css'
import { useEffect, useState, useMemo } from 'react'
import { TabelaCustos } from '@/src/components/kanban/TabelaCustos'
import { parseLista } from '@/src/lib/financeiro/parseLista'
// PARIDADE COM RECEITA: mesma Central de Operação, vocabulário de custo.
import { CustoFinanceiroModal } from '@/src/components/financeiro/receita-modal/ReceitaFinanceiraModal'
// ARQUITETURA NOVA — aplicação MANUAL de template financeiro REMOVIDA. Lançamentos
// financeiros nascem apenas via Automações por Fase (evento do Workflow Interno).
// O modal SeletorTemplate e o botão "Template" foram retirados desta tela.

// ============================================================================
// Tipos
// ============================================================================

type Moeda = 'BRL' | 'EUR' | 'USD'
type FxRule = 'FIXO' | 'VARIAVEL'
type StatusParcela = 'PENDENTE' | 'RECEBIDA' | 'PAGA' | 'CANCELADA'
type TipoCusto = 'SERVICO' | 'IMPOSTO' | 'DOCUMENTO' | 'DESPESA'
type CategoriaCusto =
  | 'TRADUCOES_JURAMENTACOES'
  | 'APOSTILAMENTOS'
  | 'HONORARIOS_ESCRITORIO'
  | 'TAXAS_CONSULARES'
  | 'OUTROS'
type CustoStatus = 'ATIVA' | 'RASCUNHO' | 'CANCELADA'

interface ParcelaAPI {
  id: number
  numero: number
  vencimento: string
  valor: number | string
  status: StatusParcela
  dataPagamento?: string | null
  cambioAplicado?: number | string | null
  valorBrl?: number | string | null
}

interface CustoAPI {
  id: number
  codigo: string
  tipo: TipoCusto
  categoria: CategoriaCusto
  descricao: string
  fornecedor?: string | null
  moeda: Moeda
  valor: number | string
  fxEstimado: number | string
  fxRule: FxRule
  fxFixo?: number | string | null
  fxData?: string | null
  nParcelas: number
  vencimento: string
  custoOperacional?: boolean
  categoriaVinculada?: string | null
  percentualVinculado?: number | string | null
  formaPagamento?: string | null
  status?: CustoStatus
  cancelado?: boolean
  parcelas: ParcelaAPI[]
  // 🆕 Pasta Documental — vínculos do motor econômico (já vêm da API; usados
  // para classificar e detalhar os custos documentais). Todos opcionais.
  origem?: string | null
  personId?: number | null
  documentoId?: number | null
  tipoServicoId?: number | null
  phaseKey?: string | null
  phaseCycle?: number | null
  productServiceId?: number | null
  pessoa?: { id: number; nome: string; sobrenome?: string | null } | null
  tipoServico?: { id: number; nome: string } | null
  documento?: { id: number; tipo: string } | null
}

type Filter = 'todos' | 'pagos' | 'pendentes' | 'rascunhos'

export interface CustosProps {
  processoId: number
  nomeFamilia?: string
  onUpdate?: () => void
  fxHoje?: number
}

// ============================================================================
// Helpers
// ============================================================================

const num = (v: unknown): number => {
  if (v == null) return 0
  if (typeof v === 'number') return v
  const n = parseFloat(String(v))
  return isFinite(n) ? n : 0
}
const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtMoeda = (v: number, m: Moeda) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: m })
const fmtFX = (v: number) => v.toFixed(4).replace('.', ',')

const TIPO_LABEL: Record<TipoCusto, string> = {
  SERVICO: 'Serviço',
  IMPOSTO: 'Imposto',
  DOCUMENTO: 'Documento',
  DESPESA: 'Despesa',
}
const CAT_LABEL: Record<CategoriaCusto, string> = {
  TRADUCOES_JURAMENTACOES: 'Traduções e juramentações',
  APOSTILAMENTOS: 'Apostilamentos',
  HONORARIOS_ESCRITORIO: 'Honorários do escritório',
  TAXAS_CONSULARES: 'Taxas consulares',
  OUTROS: 'Outros',
}

function cambioEfetivo(c: CustoAPI): number {
  if (c.moeda === 'BRL') return 1
  if (c.fxRule === 'FIXO' && c.fxFixo) return num(c.fxFixo)
  return num(c.fxEstimado) || 1
}
// ============================================================================
// Pasta Documental — classificação
// ----------------------------------------------------------------------------
// REGRA ÚNICA de "o que é custo documental" (entra na Pasta). Centralizada aqui
// de propósito: quando existir um campo de grupo no schema (ex.: financialGroupKey
// = DOCUMENT_FOLDER), troca-se SÓ esta função — nada de espalhar nomes soltos.
// Hoje: documental = gerado pelo motor (origem 'motor') OU vinculado a um
// documento (documentoId). Custos manuais soltos (advogado, taxa, etc.) NÃO
// entram — ficam na lista normal, separados.
// ============================================================================
function isCustoDocumental(c: CustoAPI): boolean {
  return c.origem === 'motor' || c.documentoId != null
}

// Nome do componente/serviço p/ exibir no detalhe (ex.: "Certidão Inteiro Teor").
// Preferimos o nome do TipoServico; se não vier, caímos na descrição do custo.
function componenteLabel(c: CustoAPI): string {
  if (c.tipoServico?.nome) return c.tipoServico.nome
  // descrição do motor = "Componente · Pessoa" → pega a parte antes do "·"
  const antes = c.descricao?.split('·')[0]?.trim()
  return antes || c.descricao || '—'
}
function pessoaLabel(c: CustoAPI): string {
  if (c.pessoa) return `${c.pessoa.nome} ${c.pessoa.sobrenome ?? ''}`.trim()
  return '—'
}

function isVencida(p: ParcelaAPI): boolean {
  if (p.status !== 'PENDENTE') return false
  if (!p.vencimento) return false
  const v = new Date(p.vencimento.includes('T') ? p.vencimento : p.vencimento + 'T00:00:00')
  v.setHours(0, 0, 0, 0)
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  return v.getTime() < hoje.getTime()
}

// ============================================================================
// Componente
// ============================================================================

type View = { kind: 'lista' }

export function Custos({
  processoId,
  nomeFamilia,
  onUpdate,
  fxHoje = 5.5,
}: CustosProps) {
  const [lancamentoAberto, setLancamentoAberto] = useState<number | null>(null)
  const [view, setView] = useState<View>({ kind: 'lista' })
  const [custos, setCustos] = useState<CustoAPI[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filter>('todos')
  const [excluindoId, setExcluindoId] = useState<number | null>(null)
  const [pastaAberta, setPastaAberta] = useState(true) // Pasta Documental expandida por padrão

  // ---- Load ----
  useEffect(() => {
    let cancelado = false
    async function carregar() {
      setLoading(true)
      setErro(null)
      try {
        const res = await fetch(
          `/api/financeiro/custos?processoId=${processoId}`,
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
            },
          },
        )
        if (cancelado) return
        if (!res.ok) {
          setErro(`Não foi possível carregar custos (HTTP ${res.status}).`)
          setCustos([])
          return
        }
        const data = await res.json()
        const lista = parseLista<CustoAPI>(data)
        if (!cancelado) setCustos(Array.isArray(lista) ? lista : [])
      } catch (err) {
        console.error('[Custos] erro:', err)
        if (!cancelado) {
          setErro('Erro de conexão ao carregar custos.')
          setCustos([])
        }
      } finally {
        if (!cancelado) setLoading(false)
      }
    }
    carregar()
    return () => {
      cancelado = true
    }
  }, [processoId])

  async function recarregar() {
    try {
      const res = await fetch(`/api/financeiro/custos?processoId=${processoId}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
        },
      })
      if (!res.ok) return
      const data = await res.json()
      const lista = parseLista<CustoAPI>(data)
      setCustos(Array.isArray(lista) ? lista : [])
    } catch (err) {
      console.error('[Custos] recarregar:', err)
    }
  }

  // ---- Excluir rascunho (soft delete: marca cancelado=true) ----
  async function excluirRascunho(c: CustoAPI) {
    if (!window.confirm(`Excluir o rascunho "${c.descricao}"?\n\nEsta ação não pode ser desfeita.`)) {
      return
    }
    setExcluindoId(c.id)
    try {
      const res = await fetch(`/api/financeiro/custos/${c.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
        },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data?.error || `Falha ao excluir (HTTP ${res.status}).`)
        return
      }
      await recarregar()
      onUpdate?.()
    } catch (err) {
      console.error('[Custos] excluir:', err)
      alert('Erro de conexão ao excluir.')
    } finally {
      setExcluindoId(null)
    }
  }

  // ---- Separação por status (custos cancelados somem) ----
  const custosVisiveis = useMemo(
    () => custos.filter((c) => !c.cancelado),
    [custos],
  )

  const custosAtivos = useMemo(
    () => custosVisiveis.filter((c) => (c.status ?? 'ATIVA') === 'ATIVA'),
    [custosVisiveis],
  )
  const custosRascunho = useMemo(
    () => custosVisiveis.filter((c) => c.status === 'RASCUNHO'),
    [custosVisiveis],
  )

  // ---- KPIs (sempre sobre ATIVOS, em BRL como denominador comum) ----
  const kpis = useMemo(() => {
    let totalBrl = 0
    let pagoBrl = 0
    let pendenteBrl = 0
    let atrasadoBrl = 0
    let qtdAtrasadas = 0
    custosAtivos.forEach((c) => {
      const cx = cambioEfetivo(c)
      c.parcelas?.forEach((p) => {
        const v = num(p.valor)
        const vBrl = num(p.valorBrl) || v * cx
        totalBrl += vBrl
        if (p.status === 'PAGA' || p.status === 'RECEBIDA') {
          pagoBrl += num(p.valorBrl) || v * (num(p.cambioAplicado) || cx)
        } else if (p.status === 'PENDENTE') {
          pendenteBrl += vBrl
          if (isVencida(p)) {
            atrasadoBrl += vBrl
            qtdAtrasadas++
          }
        }
      })
    })
    return {
      totalBrl,
      pagoBrl,
      pendenteBrl,
      atrasadoBrl,
      qtdAtrasadas,
    }
  }, [custosAtivos])

  // ---- Filtro aplicado ----
  const custosExibidos = useMemo(() => {
    if (filtro === 'rascunhos') return custosRascunho
    if (filtro === 'todos') return custosAtivos
    if (filtro === 'pagos') {
      return custosAtivos.filter((c) => {
        const tot = c.parcelas?.length || 0
        const pg = c.parcelas?.filter(
          (p) => p.status === 'PAGA' || p.status === 'RECEBIDA',
        ).length
        return tot > 0 && pg === tot
      })
    }
    return custosAtivos.filter((c) =>
      c.parcelas?.some((p) => p.status === 'PENDENTE'),
    )
  }, [custosAtivos, custosRascunho, filtro])

  // ---- Pasta Documental: separa documentais × outros (dentro do filtro atual) ----
  // NÃO funde no banco: só agrupa PARA EXIBIR. Cada custo continua individual.
  const { pastaCustos, outrosCustos, pastaResumo } = useMemo(() => {
    const pastaCustos = custosExibidos.filter(isCustoDocumental)
    const outrosCustos = custosExibidos.filter((c) => !isCustoDocumental(c))
    const pessoas = new Set<number>()
    const porMoeda: Record<string, number> = {}
    let totalBrl = 0
    let pagoBrl = 0
    for (const c of pastaCustos) {
      if (c.personId != null) pessoas.add(c.personId)
      const cx = cambioEfetivo(c)
      const orig = num(c.valor)
      totalBrl += orig * cx
      porMoeda[c.moeda] = (porMoeda[c.moeda] || 0) + orig // ⚠ soma por moeda ORIGINAL (não mistura)
      c.parcelas?.forEach((p) => {
        if (p.status === 'PAGA' || p.status === 'RECEBIDA') {
          pagoBrl += num(p.valorBrl) || num(p.valor) * (num(p.cambioAplicado) || cx)
        }
      })
    }
    return {
      pastaCustos,
      outrosCustos,
      pastaResumo: {
        nPessoas: pessoas.size,
        nComponentes: pastaCustos.length,
        totalBrl,
        pagoBrl,
        porMoeda,
        multiMoeda: Object.keys(porMoeda).length > 1,
      },
    }
  }, [custosExibidos])

  // Renderiza UMA linha de custo. Reusada pela Pasta (dentroPasta) e pela lista normal.
  function renderCustoRow(c: CustoAPI, opts?: { dentroPasta?: boolean }): React.ReactNode {
    const dentroPasta = opts?.dentroPasta === true
    const cx = cambioEfetivo(c)
    const totOrig = num(c.valor)
    const totBrl = totOrig * cx
    let pgCount = 0
    c.parcelas?.forEach((p) => {
      if (p.status === 'PAGA' || p.status === 'RECEBIDA') pgCount++
    })
    const totParc = c.parcelas?.length || 0
    const isQuit = totParc > 0 && pgCount === totParc
    const temAtraso = c.parcelas?.some(isVencida)
    const isRascunho = c.status === 'RASCUNHO'
    const sendoExcluido = excluindoId === c.id

    let statusBadge: React.ReactNode
    if (isRascunho)
      statusBadge = (
        <span className="badge" style={{ background: '#f1f5f9', color: '#475569' }}>
          📝 Rascunho
        </span>
      )
    else if (isQuit) statusBadge = <span className="badge badge-recebida">Pago</span>
    else if (temAtraso) statusBadge = <span className="badge badge-atrasada">Atrasado</span>
    else statusBadge = <span className="badge badge-pendente">A pagar</span>

    const fxBadge =
      c.moeda === 'BRL' ? (
        <span className="badge badge-pendente">BRL</span>
      ) : c.fxRule === 'FIXO' ? (
        <span className="badge-fx-fixo-sm">FIXO</span>
      ) : (
        <span className="badge-fx-var-sm">VAR</span>
      )

    const abrir = () => setLancamentoAberto(c.id)
    return (
      <tr
        key={c.id}
        onClick={abrir}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir() } }}
        tabIndex={0}
        role="button"
        aria-label={`Abrir detalhes de ${c.descricao}`}
        className="rct-linha"
        style={
          sendoExcluido
            ? { opacity: 0.4, cursor: 'pointer' }
            : isRascunho
              ? { opacity: 0.7, cursor: 'pointer' }
              : dentroPasta
                ? { background: '#fcfdff', cursor: 'pointer' }
                : { cursor: 'pointer' }
        }
      >
        <td style={dentroPasta ? { paddingLeft: 28 } : undefined}>
          {isRascunho ? '📝' : dentroPasta ? '↳' : '📋'}
        </td>
        <td>
          <strong>{dentroPasta ? componenteLabel(c) : c.descricao}</strong>
          <span className="muted-xs">
            {dentroPasta ? pessoaLabel(c) : ''}
          </span>
        </td>
        <td>
          {TIPO_LABEL[c.tipo]}
          <span className="muted-xs">{CAT_LABEL[c.categoria]}</span>
        </td>
        <td>{c.fornecedor || <span className="muted">—</span>}</td>
        <td>{fmtMoeda(totOrig, c.moeda)}</td>
        <td className="brl">
          <strong>
            {fmtBRL(totBrl)}
            {c.moeda !== 'BRL' && c.fxRule === 'VARIAVEL' && (
              <span className="muted-xs">(est.)</span>
            )}
          </strong>
        </td>
        <td>
          {c.moeda === 'BRL' ? (
            <span className="muted">—</span>
          ) : c.fxRule === 'FIXO' ? (
            <>
              {fmtFX(num(c.fxFixo))} {fxBadge}
            </>
          ) : (
            <>
              {fmtFX(num(c.fxEstimado))} {fxBadge}
            </>
          )}
        </td>
        <td>
          {pgCount}/{totParc}
        </td>
        <td>{statusBadge}</td>
      </tr>
    )
  }

  // MODELO DEFINITIVO: o Financeiro do Processo é READ ONLY para criação de
  // lançamentos. Não há mais criação/edição/lançamento manual de custos — quem
  // cria é exclusivamente o motor financeiro (Config Financeira → Regra → Engine).
  // ---- View única: leitura ----
  return (
    <div className="fpag-page">
      {/* === Section 1: Pasta Documental === */}
      <section style={{ marginBottom: 32 }}>
        <div className="page-header">
          <div>
            <h1 className="page-title">📂 Pasta Documental</h1>
            <div className="page-subtitle">
              Custos de aquisição/reposição documental ligados à pasta do processo
            </div>
          </div>
        </div>
        <TabelaCustos processoId={processoId} nomeFamilia={nomeFamilia} />
      </section>

      {/* === Section 2: Lançamentos de custo (gerados pelo motor) === */}
      <section>
        <div className="page-header">
          <div>
            <h1 className="page-title">🧾 Lançamentos de Custo</h1>
            <div className="page-subtitle">
              Gerados automaticamente pelo motor financeiro (Config Financeira → Regra). Somente leitura.
            </div>
          </div>
        </div>

        {/* KPIs (BRL como denominador comum entre moedas) */}
        <div className="grid-4">
          <div className="kpi">
            <div className="kpi-label">📉 Total Previsto</div>
            <div className="kpi-value">{fmtBRL(kpis.totalBrl)}</div>
            <div className="kpi-sub">
              {custosAtivos.length} {custosAtivos.length === 1 ? 'custo' : 'custos'}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">✓ Pago</div>
            <div className="kpi-value pos">{fmtBRL(kpis.pagoBrl)}</div>
            <div className="kpi-sub pos">já pago</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">⏳ A Pagar</div>
            <div className="kpi-value">{fmtBRL(kpis.pendenteBrl)}</div>
            <div className="kpi-sub">pendente</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">⚠ Atrasado</div>
            <div className="kpi-value neg">
              {kpis.qtdAtrasadas} {kpis.qtdAtrasadas === 1 ? 'parc.' : 'parc.'}
            </div>
            <div className="kpi-sub">
              {kpis.qtdAtrasadas} {kpis.qtdAtrasadas === 1 ? 'parcela' : 'parcelas'}
            </div>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="filter-tabs">
          <button
            type="button"
            className={`filter-tab ${filtro === 'todos' ? 'active' : ''}`}
            onClick={() => setFiltro('todos')}
          >
            Todos{' '}
            <span style={{ opacity: 0.6, marginLeft: 6 }}>
              ({custosAtivos.length})
            </span>
          </button>
          <button
            type="button"
            className={`filter-tab ${filtro === 'pagos' ? 'active' : ''}`}
            onClick={() => setFiltro('pagos')}
          >
            Pagos
          </button>
          <button
            type="button"
            className={`filter-tab ${filtro === 'pendentes' ? 'active' : ''}`}
            onClick={() => setFiltro('pendentes')}
          >
            A pagar
          </button>
          <button
            type="button"
            className={`filter-tab ${filtro === 'rascunhos' ? 'active' : ''}`}
            onClick={() => setFiltro('rascunhos')}
          >
            📝 Rascunhos{' '}
            <span style={{ opacity: 0.6, marginLeft: 6 }}>
              ({custosRascunho.length})
            </span>
          </button>
        </div>

        {erro && (
          <div className="alert alert-danger" style={{ marginBottom: 16 }}>
            <i className="alert-icon">⚠</i>
            <span>{erro}</span>
          </div>
        )}

        <div className="table-card">
          {loading ? (
            <div className="empty-state">Carregando custos...</div>
          ) : custosExibidos.length === 0 &&
            custosAtivos.length === 0 &&
            custosRascunho.length === 0 ? (
            <div className="empty-state">
              Nenhum lançamento de custo. Os custos são gerados automaticamente pelo motor financeiro conforme o processo avança.
            </div>
          ) : custosExibidos.length === 0 ? (
            <div className="empty-state">
              {filtro === 'rascunhos'
                ? 'Nenhum rascunho salvo.'
                : 'Nenhum custo corresponde ao filtro.'}
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 30 }}></th>
                  <th>Descrição</th>
                  <th>Tipo / Categoria</th>
                  <th>Fornecedor</th>
                  <th>Total (orig.)</th>
                  <th>Total (BRL)</th>
                  <th>Câmbio</th>
                  <th>Parcelas</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {/* === Grupo: Pasta Documental (agrupador visual; custos seguem individuais) === */}
                {pastaCustos.length > 0 && (
                  <>
                    <tr
                      onClick={() => setPastaAberta((v) => !v)}
                      style={{ cursor: 'pointer', background: '#f8fafc', fontWeight: 600 }}
                    >
                      <td>{pastaAberta ? '▾' : '▸'}</td>
                      <td>
                        <strong>📂 Pasta Documental</strong>
                        <span className="muted-xs">
                          {pastaResumo.nPessoas}{' '}
                          {pastaResumo.nPessoas === 1 ? 'pessoa' : 'pessoas'} ·{' '}
                          {pastaResumo.nComponentes}{' '}
                          {pastaResumo.nComponentes === 1 ? 'componente' : 'componentes'}
                        </span>
                      </td>
                      <td>
                        <span className="muted">—</span>
                      </td>
                      <td>
                        <span className="muted">—</span>
                      </td>
                      <td>
                        {pastaResumo.multiMoeda ? (
                          <span className="muted-xs">
                            {Object.entries(pastaResumo.porMoeda)
                              .map(([m, v]) => fmtMoeda(v, m as Moeda))
                              .join(' + ')}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="brl">
                        <strong>
                          {fmtBRL(pastaResumo.totalBrl)}
                          {pastaResumo.multiMoeda && (
                            <span className="muted-xs">(conv.)</span>
                          )}
                        </strong>
                      </td>
                      <td>
                        <span className="muted">—</span>
                      </td>
                      <td>
                        <span className="muted">—</span>
                      </td>
                      <td>
                        <span className="badge badge-pendente">
                          {pastaResumo.nComponentes}{' '}
                          {pastaResumo.nComponentes === 1 ? 'item' : 'itens'}
                        </span>
                      </td>
                      <td></td>
                    </tr>
                    {pastaAberta &&
                      pastaCustos.map((c) => renderCustoRow(c, { dentroPasta: true }))}
                  </>
                )}

                {/* === Custos não-documentais (advogado, taxa, etc.) — soltos, separados === */}
                {outrosCustos.map((c) => renderCustoRow(c))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ── CENTRAL DE OPERAÇÃO DO CUSTO (mesma da receita) ── */}
      {lancamentoAberto != null && (
        <CustoFinanceiroModal
          receitaId={lancamentoAberto}
          onClose={() => setLancamentoAberto(null)}
          onChanged={() => { void recarregar(); onUpdate?.() }}
        />
      )}
    </div>
  )
}

export default Custos
// src/components/financeiro/subabas/Receitas.tsx
//
// 🆕 Fase 3 v2.2 — Receitas com view router interno (não usa mais modais).
//
// Views:
//   - 'lista'   → KPIs + tabela de receitas (clone visual do #page-receitas)
//   - 'nova'    → renderiza <NovaReceitaPagina /> (sem receitaInicial)
//   - 'editar'  → renderiza <NovaReceitaPagina receitaInicial={...} />
//   - 'lancar'  → renderiza <LancarParcelaPagina tipo="receita" />
//
// 🆕 v2.2 — Mudanças:
//   - Header da coluna de total agora é "Total (orig.)" sempre (antes era
//     "Total (EUR)" fixo, mas as receitas podem ser em BRL/USD/EUR).
//   - Filtra receitas canceladas (cancelada=true) antes de qualquer outro
//     filtro — quando o DELETE da rota marca cancelada, some da lista.
//   - Linha de rascunho agora tem ações "Editar" e "Excluir".
//
// Endpoints:
//   - GET    /api/financeiro/receitas?processoId=X
//   - DELETE /api/financeiro/receitas/[id]   (soft delete: cancelada=true)

'use client'

import '@/src/styles/financeiro-paginas.css'
import { useEffect, useState, useMemo } from 'react'
import { NovaReceitaPagina } from '@/src/components/financeiro/paginas/NovaReceitaPagina'
import {
  LancarParcelaPagina,
  type ParcelaLancavel,
  type EntidadeLancavel,
} from '@/src/components/financeiro/paginas/LancarParcelaPagina'
import { SeletorTemplate } from '@/src/components/financeiro/SeletorTemplate'
import { DetalhesReceitaPagina } from '@/src/components/financeiro/paginas/DetalhesReceitaPagina'

// ============================================================================
// Tipos
// ============================================================================

type Moeda = 'BRL' | 'EUR' | 'USD'
type FxRule = 'FIXO' | 'VARIAVEL'
type StatusParcela = 'PENDENTE' | 'RECEBIDA' | 'PAGA' | 'CANCELADA'
type CategoriaReceita = 'HONORARIOS' | 'REEMBOLSO' | 'PASTA_DOCUMENTAL' | 'OUTROS'
type ReceitaStatus = 'ATIVA' | 'RASCUNHO' | 'CANCELADA'

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

interface ReceitaRequerenteAPI {
  id: number
  idx?: number
  requerenteId?: number | null
  percentual: number | string
  nome?: string
  requerente?: { id: number; nome: string }
}

interface ReceitaAPI {
  id: number
  codigo: string
  categoria: CategoriaReceita
  descricao: string
  moeda: Moeda
  valor: number | string
  fxEstimado: number | string
  fxRule: FxRule
  fxFixo?: number | string | null
  fxData?: string | null
  nParcelas: number
  data1: string
  status?: ReceitaStatus
  cancelada?: boolean
  parcelas: ParcelaAPI[]
  requerentes?: ReceitaRequerenteAPI[]
  // 🆕 Pasta Documental (espelho de Custos)
  origem?: string | null
  personId?: number | null
  documentoId?: number | null
  tipoServicoId?: number | null
  pessoa?: { id: number; nome: string; sobrenome?: string | null } | null
  tipoServico?: { id: number; nome: string } | null
  documento?: { id: number; tipo: string | null } | null
}

type Filter = 'todas' | 'recebidas' | 'pendentes' | 'rascunhos'

export interface ReceitasProps {
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
const fmtDate = (iso?: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso.includes('T') ? iso : iso + 'T00:00:00')
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR')
}

const CATEGORIA_LABEL: Record<CategoriaReceita, string> = {
  HONORARIOS: 'Honorários',
  REEMBOLSO: 'Reembolso',
  PASTA_DOCUMENTAL: 'Pasta Documental',
  OUTROS: 'Outros',
}

function cambioEfetivo(r: ReceitaAPI): number {
  if (r.moeda === 'BRL') return 1
  if (r.fxRule === 'FIXO' && r.fxFixo) return num(r.fxFixo)
  return num(r.fxEstimado) || 1
}
// Pasta Documental — mesma regra do Custos: receita documental = motor ou vinculada a doc
function isReceitaDocumental(r: ReceitaAPI): boolean {
  return r.origem === 'motor' || r.documentoId != null
}
function componenteLabelR(r: ReceitaAPI): string {
  if (r.tipoServico?.nome) return r.tipoServico.nome
  const antes = r.descricao?.split('·')[0]?.trim()
  return antes || r.descricao || '—'
}
function pessoaLabelR(r: ReceitaAPI): string {
  if (r.pessoa) return `${r.pessoa.nome} ${r.pessoa.sobrenome ?? ''}`.trim()
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

// 🆕 Parse defensivo: backend retorna array direto, mas suporta wrapper também
function parseLista(data: unknown): ReceitaAPI[] {
  if (Array.isArray(data)) return data as ReceitaAPI[]
  const d = data as { receitas?: ReceitaAPI[]; data?: ReceitaAPI[] } | null
  return d?.receitas || d?.data || []
}

// ============================================================================
// Componente
// ============================================================================

type View =
  | { kind: 'lista' }
  | { kind: 'nova' }
  | { kind: 'editar'; receita: ReceitaAPI }
  | { kind: 'lancar'; parcela: ParcelaLancavel; entidade: EntidadeLancavel }
  | { kind: 'detalhes'; receita: ReceitaAPI }

export function Receitas({ processoId, onUpdate, fxHoje = 5.5 }: ReceitasProps) {
  const [view, setView] = useState<View>({ kind: 'lista' })
  const [receitas, setReceitas] = useState<ReceitaAPI[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filter>('todas')
  const [excluindoId, setExcluindoId] = useState<number | null>(null)
  const [templateAberto, setTemplateAberto] = useState(false)
  const [pastaAberta, setPastaAberta] = useState(true) // Pasta Documental expandida por padrão

  // ---- Load ----
  useEffect(() => {
    let cancelado = false
    async function carregar() {
      setLoading(true)
      setErro(null)
      try {
        const res = await fetch(
          `/api/financeiro/receitas?processoId=${processoId}`,
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
            },
          },
        )
        if (cancelado) return
        if (!res.ok) {
          setErro(`Não foi possível carregar receitas (HTTP ${res.status}).`)
          setReceitas([])
          return
        }
        const data = await res.json()
        const lista = parseLista(data)
        if (!cancelado) setReceitas(lista)
      } catch (err) {
        console.error('[Receitas] erro:', err)
        if (!cancelado) {
          setErro('Erro de conexão ao carregar receitas.')
          setReceitas([])
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
      const res = await fetch(`/api/financeiro/receitas?processoId=${processoId}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
        },
      })
      if (!res.ok) return
      const data = await res.json()
      setReceitas(parseLista(data))
    } catch (err) {
      console.error('[Receitas] recarregar:', err)
    }
  }

  // ---- Excluir rascunho (soft delete: marca cancelada=true) ----
  async function excluirRascunho(r: ReceitaAPI) {
    if (!window.confirm(`Excluir o rascunho "${r.descricao}"?\n\nEsta ação não pode ser desfeita.`)) {
      return
    }
    setExcluindoId(r.id)
    try {
      const res = await fetch(`/api/financeiro/receitas/${r.id}`, {
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
      console.error('[Receitas] excluir:', err)
      alert('Erro de conexão ao excluir.')
    } finally {
      setExcluindoId(null)
    }
  }

  // ---- Filtros: canceladas (cancelada=true) somem de tudo ----
  const receitasVisiveis = useMemo(
    () => receitas.filter((r) => !r.cancelada),
    [receitas],
  )

  const receitasAtivas = useMemo(
    () => receitasVisiveis.filter((r) => (r.status ?? 'ATIVA') === 'ATIVA'),
    [receitasVisiveis],
  )
  const receitasRascunho = useMemo(
    () => receitasVisiveis.filter((r) => r.status === 'RASCUNHO'),
    [receitasVisiveis],
  )

  // ---- KPIs (sempre sobre ATIVAS) ----
  const kpis = useMemo(() => {
    let totalEur = 0
    let totalBrl = 0
    let recebidoEur = 0
    let recebidoBrl = 0
    let pendenteEur = 0
    let pendenteBrl = 0
    let atrasadoEur = 0
    let qtdAtrasadas = 0
    receitasAtivas.forEach((r) => {
      const cx = cambioEfetivo(r)
      r.parcelas?.forEach((p) => {
        const v = num(p.valor)
        const vBrl = num(p.valorBrl) || v * cx
        totalEur += v
        totalBrl += vBrl
        if (p.status === 'RECEBIDA' || p.status === 'PAGA') {
          recebidoEur += v
          recebidoBrl += num(p.valorBrl) || v * (num(p.cambioAplicado) || cx)
        } else if (p.status === 'PENDENTE') {
          pendenteEur += v
          pendenteBrl += vBrl
          if (isVencida(p)) {
            atrasadoEur += v
            qtdAtrasadas++
          }
        }
      })
    })
    return {
      totalEur,
      totalBrl,
      recebidoEur,
      recebidoBrl,
      pendenteEur,
      pendenteBrl,
      atrasadoEur,
      qtdAtrasadas,
    }
  }, [receitasAtivas])

  // ---- Filtro aplicado ----
  const receitasExibidas = useMemo(() => {
    if (filtro === 'rascunhos') return receitasRascunho
    if (filtro === 'todas') return receitasAtivas
    if (filtro === 'recebidas') {
      return receitasAtivas.filter((r) => {
        const tot = r.parcelas?.length || 0
        const rec = r.parcelas?.filter(
          (p) => p.status === 'RECEBIDA' || p.status === 'PAGA',
        ).length
        return tot > 0 && rec === tot
      })
    }
    return receitasAtivas.filter((r) =>
      r.parcelas?.some((p) => p.status === 'PENDENTE'),
    )
  }, [receitasAtivas, receitasRascunho, filtro])

  // ---- Pasta Documental: separa documentais × outros (espelho de Custos) ----
  const { pastaReceitas, outrasReceitas, pastaResumo } = useMemo(() => {
    const pastaReceitas = receitasExibidas.filter(isReceitaDocumental)
    const outrasReceitas = receitasExibidas.filter((r) => !isReceitaDocumental(r))
    const pessoas = new Set<number>()
    const porMoeda: Record<string, number> = {}
    let totalBrl = 0
    for (const r of pastaReceitas) {
      if (r.personId != null) pessoas.add(r.personId)
      const cx = cambioEfetivo(r)
      const orig = num(r.valor)
      totalBrl += orig * cx
      porMoeda[r.moeda] = (porMoeda[r.moeda] || 0) + orig
    }
    return {
      pastaReceitas,
      outrasReceitas,
      pastaResumo: {
        nPessoas: pessoas.size,
        nComponentes: pastaReceitas.length,
        totalBrl,
        porMoeda,
        multiMoeda: Object.keys(porMoeda).length > 1,
      },
    }
  }, [receitasExibidas])

  // Renderiza UMA linha de receita (reusada pela Pasta e pela lista normal).
  function renderReceitaRow(r: ReceitaAPI, opts?: { dentroPasta?: boolean }): React.ReactNode {
    const dentroPasta = opts?.dentroPasta === true
    const cx = cambioEfetivo(r)
    const totOrig = num(r.valor)
    const totBrl = totOrig * cx
    let recCount = 0
    r.parcelas?.forEach((p) => { if (p.status === 'RECEBIDA' || p.status === 'PAGA') recCount++ })
    const totParc = r.parcelas?.length || 0
    const pct = totParc > 0 ? (recCount / totParc) * 100 : 0
    const isQuit = totParc > 0 && recCount === totParc
    const temAtraso = r.parcelas?.some(isVencida)
    const isRascunho = r.status === 'RASCUNHO'
    const sendoExcluido = excluindoId === r.id

    let statusBadge: React.ReactNode
    if (isRascunho) statusBadge = <span className="badge" style={{ background: '#f1f5f9', color: '#475569' }}>📝 Rascunho</span>
    else if (isQuit) statusBadge = <span className="badge badge-recebida">Quitada</span>
    else if (temAtraso) statusBadge = <span className="badge badge-atrasada">Atrasada</span>
    else statusBadge = <span className="badge badge-pendente">Em aberto</span>

    const fxBadge =
      r.moeda === 'BRL' ? <span className="badge badge-pendente">BRL</span>
      : r.fxRule === 'FIXO' ? <span className="badge-fx-fixo-sm">FIXO</span>
      : <span className="badge-fx-var-sm">VAR</span>

    return (
      <tr key={r.id} style={sendoExcluido ? { opacity: 0.4 } : isRascunho ? { opacity: 0.7 } : dentroPasta ? { background: '#fcfdff' } : undefined}>
        <td style={dentroPasta ? { paddingLeft: 28 } : undefined}>{isRascunho ? '📝' : dentroPasta ? '↳' : '📑'}</td>
        <td>
          <strong>{dentroPasta ? componenteLabelR(r) : r.descricao}</strong>
          <span className="muted-xs">{dentroPasta ? `${pessoaLabelR(r)} · ${r.codigo}` : r.codigo}</span>
        </td>
        <td>{CATEGORIA_LABEL[r.categoria]}</td>
        <td>{fmtMoeda(totOrig, r.moeda)}</td>
        <td className="brl">
          <strong>{fmtBRL(totBrl)}{r.moeda !== 'BRL' && r.fxRule === 'VARIAVEL' && <span className="muted-xs">(est.)</span>}</strong>
        </td>
        <td>
          {r.moeda === 'BRL' ? <span className="muted">—</span>
            : r.fxRule === 'FIXO' ? <>{fmtFX(num(r.fxFixo))} {fxBadge}</>
            : <>{fmtFX(num(r.fxEstimado))} {fxBadge}</>}
        </td>
        <td>{recCount}/{totParc}</td>
        <td>
          <div style={{ width: 100, height: 6, background: 'var(--fpag-gray-100)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--fpag-success)', transition: 'width .3s' }} />
          </div>
          <div className="muted-xs">{pct.toFixed(0)}%</div>
        </td>
        <td>{statusBadge}</td>
        <td>
          {isRascunho ? (
            <div style={{ display: 'flex', gap: 12, whiteSpace: 'nowrap' }}>
              <button type="button" className="btn-link-sm" onClick={() => setView({ kind: 'editar', receita: r })} disabled={sendoExcluido}>Editar</button>
              <button type="button" className="btn-link-sm" style={{ color: '#dc2626' }} onClick={() => excluirRascunho(r)} disabled={sendoExcluido}>{sendoExcluido ? 'Excluindo...' : 'Excluir'}</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 12, whiteSpace: 'nowrap' }}>
              <button type="button" className="btn-link-sm" disabled title="Em desenvolvimento" style={{ opacity: 0.5, cursor: 'not-allowed' }}>Fatura</button>
              <button type="button" className="btn-link-sm" onClick={() => setView({ kind: 'detalhes', receita: r })}>Ver</button>
            </div>
          )}
        </td>
      </tr>
    )
  }

  // ---- Render por view ----
  if (view.kind === 'nova') {
    return (
      <NovaReceitaPagina
        processoId={processoId}
        fxHoje={fxHoje}
        onVoltar={() => setView({ kind: 'lista' })}
        onCriado={() => {
          setView({ kind: 'lista' })
          recarregar()
          onUpdate?.()
        }}
      />
    )
  }

  if (view.kind === 'editar') {
    return (
      <NovaReceitaPagina
        processoId={processoId}
        fxHoje={fxHoje}
        receitaInicial={view.receita}
        onVoltar={() => setView({ kind: 'lista' })}
        onCriado={() => {
          setView({ kind: 'lista' })
          recarregar()
          onUpdate?.()
        }}
      />
    )
  }

  if (view.kind === 'detalhes') {
    return (
      <DetalhesReceitaPagina
        receita={view.receita}
        fxHoje={fxHoje}
        onVoltar={() => setView({ kind: 'lista' })}
        onEditar={(r) => setView({ kind: 'editar', receita: r })}
        onLancarParcela={(parcela, entidade) =>
          setView({ kind: 'lancar', parcela, entidade })
        }
        onExcluido={() => {
          setView({ kind: 'lista' })
          recarregar()
          onUpdate?.()
        }}
      />
    )
  }

  if (view.kind === 'lancar') {
    return (
      <LancarParcelaPagina
        parcela={view.parcela}
        entidade={view.entidade}
        fxHoje={fxHoje}
        onVoltar={() => setView({ kind: 'lista' })}
        onLancado={() => {
          setView({ kind: 'lista' })
          recarregar()
          onUpdate?.()
        }}
      />
    )
  }

  // ---- View 'lista' ----
  return (
    <div className="fpag-page">
      {templateAberto && (
        <SeletorTemplate
          processoId={processoId}
          fxHoje={fxHoje}
          onFechar={() => setTemplateAberto(false)}
          onAplicado={() => {
            recarregar()
            onUpdate?.()
          }}
        />
      )}
      <div className="page-header">
        <div>
          <h1 className="page-title">Receitas</h1>
          <div className="page-subtitle">Honorários e demais entradas do processo</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn-outline"
            onClick={() => setTemplateAberto(true)}
          >
            ⚡ Template
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setView({ kind: 'nova' })}
          >
            + Nova Receita
          </button>
        </div>
      </div>

      {/* KPIs (BRL como denominador comum entre moedas) */}
      <div className="grid-4">
        <div className="kpi">
          <div className="kpi-label">📈 Total Previsto</div>
          <div className="kpi-value">{fmtBRL(kpis.totalBrl)}</div>
          <div className="kpi-sub">
            {receitasAtivas.length} {receitasAtivas.length === 1 ? 'receita' : 'receitas'}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">✓ Recebido</div>
          <div className="kpi-value pos">{fmtBRL(kpis.recebidoBrl)}</div>
          <div className="kpi-sub pos">em caixa</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">⏳ Pendente</div>
          <div className="kpi-value">{fmtBRL(kpis.pendenteBrl)}</div>
          <div className="kpi-sub">a receber</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">⚠ Inadimplente</div>
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
          className={`filter-tab ${filtro === 'todas' ? 'active' : ''}`}
          onClick={() => setFiltro('todas')}
        >
          Todas{' '}
          <span style={{ opacity: 0.6, marginLeft: 6 }}>
            ({receitasAtivas.length})
          </span>
        </button>
        <button
          type="button"
          className={`filter-tab ${filtro === 'recebidas' ? 'active' : ''}`}
          onClick={() => setFiltro('recebidas')}
        >
          Recebidas
        </button>
        <button
          type="button"
          className={`filter-tab ${filtro === 'pendentes' ? 'active' : ''}`}
          onClick={() => setFiltro('pendentes')}
        >
          Pendentes
        </button>
        <button
          type="button"
          className={`filter-tab ${filtro === 'rascunhos' ? 'active' : ''}`}
          onClick={() => setFiltro('rascunhos')}
        >
          📝 Rascunhos{' '}
          <span style={{ opacity: 0.6, marginLeft: 6 }}>
            ({receitasRascunho.length})
          </span>
        </button>
      </div>

      {/* Erro / Loading / Lista */}
      {erro && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          <i className="alert-icon">⚠</i>
          <span>{erro}</span>
        </div>
      )}

      <div className="table-card">
        {loading ? (
          <div className="empty-state">Carregando receitas...</div>
        ) : receitasExibidas.length === 0 &&
          receitasAtivas.length === 0 &&
          receitasRascunho.length === 0 ? (
          <div className="empty-state">
            Nenhuma receita cadastrada. Clique em <strong>+ Nova Receita</strong> para começar.
          </div>
        ) : receitasExibidas.length === 0 ? (
          <div className="empty-state">
            {filtro === 'rascunhos'
              ? 'Nenhum rascunho salvo.'
              : 'Nenhuma receita corresponde ao filtro.'}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 30 }}></th>
                <th>Descrição</th>
                <th>Tipo</th>
                <th>Total (orig.)</th>
                <th>Total (BRL)</th>
                <th>Câmbio</th>
                <th>Parcelas</th>
                <th>Progresso</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
                {/* Grupo: Pasta Documental (agrupador visual; receitas seguem individuais) */}
                {pastaReceitas.length > 0 && (
                  <>
                    <tr onClick={() => setPastaAberta((v) => !v)} style={{ cursor: 'pointer', background: '#f8fafc', fontWeight: 600 }}>
                      <td>{pastaAberta ? '\u25be' : '\u25b8'}</td>
                      <td>
                        <strong>\ud83d\udcc2 Pasta Documental</strong>
                        <span className="muted-xs">{pastaResumo.nPessoas} {pastaResumo.nPessoas === 1 ? 'pessoa' : 'pessoas'} \u00b7 {pastaResumo.nComponentes} {pastaResumo.nComponentes === 1 ? 'componente' : 'componentes'}</span>
                      </td>
                      <td><span className="muted">\u2014</span></td>
                      <td>{pastaResumo.multiMoeda ? <span className="muted-xs">{Object.entries(pastaResumo.porMoeda).map(([m, v]) => fmtMoeda(v, m as Moeda)).join(' + ')}</span> : <span className="muted">\u2014</span>}</td>
                      <td className="brl"><strong>{fmtBRL(pastaResumo.totalBrl)}{pastaResumo.multiMoeda && <span className="muted-xs">(conv.)</span>}</strong></td>
                      <td><span className="muted">\u2014</span></td>
                      <td><span className="muted">\u2014</span></td>
                      <td><span className="muted">\u2014</span></td>
                      <td><span className="badge badge-pendente">{pastaResumo.nComponentes} {pastaResumo.nComponentes === 1 ? 'item' : 'itens'}</span></td>
                      <td></td>
                    </tr>
                    {pastaAberta && pastaReceitas.map((r) => renderReceitaRow(r, { dentroPasta: true }))}
                  </>
                )}
                {/* Receitas não-documentais (honorários, etc.) — soltas, separadas */}
                {outrasReceitas.map((r) => renderReceitaRow(r))}
              </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default Receitas
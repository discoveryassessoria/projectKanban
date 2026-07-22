// src/components/financeiro/subabas/Receitas.tsx
// ============================================================================
// RECEITAS DO PROCESSO — painel financeiro operacional.
//
// MODELO DEFINITIVO:
//   • Os lançamentos nascem EXCLUSIVAMENTE do FinanceRuleEngine. Não há botão
//     de criação, cadastro livre, valor digitado nem moeda manual nesta tela.
//   • Mas eles NÃO são uma tabela morta: cada linha abre o MODAL FINANCEIRO
//     CENTRAL, onde o lançamento é consultável, parcelável, recebível,
//     cancelável e estornável.
//   • A MOEDA ORIGINAL é a apresentação principal. O BRL é sempre conversão
//     auxiliar — nunca substitui o valor contratual nem soma moedas diferentes.
//   • Agrupamento: FASE → subgrupo. "Pasta Documental" agrupa só lançamento
//     ligado a DOCUMENTO concreto; honorários contratuais ficam no grupo
//     comercial da fase (ex.: Genealogia → Honorários Contratuais).
//
// Toda a decisão de moeda, status, inadimplência e agrupamento vive em
// lib/financeiro/apresentacao-lancamento (fonte única, testada).
// ============================================================================

'use client'

import '@/src/styles/financeiro-paginas.css'
import { Fragment, useEffect, useState, useMemo, useCallback } from 'react'
import {
  type LancamentoView,
  type StatusLancamento,
  type TotalPorMoeda,
  STATUS_LABEL,
  agruparPorFase,
  resumoReceitas,
  statusDoLancamento,
  totaisDoLancamento,
  fmtMoeda,
  fmtBRL,
  fmtCambio,
  fmtData,
} from '@/lib/financeiro/apresentacao-lancamento'
import { ReceitaCobrancaModal } from '../ReceitaCobrancaModal'

type ReceitaAPI = LancamentoView & { faseLabel?: string | null }

type Filtro = 'todas' | 'a_vencer' | 'recebidas' | 'parciais' | 'vencidas' | 'canceladas' | 'estornadas'

const FILTROS: Array<{ key: Filtro; label: string; status?: StatusLancamento[] }> = [
  { key: 'todas', label: 'Todas' },
  { key: 'a_vencer', label: 'A vencer', status: ['A_VENCER', 'SEM_VENCIMENTO', 'PREVISTO'] },
  { key: 'recebidas', label: 'Recebidas', status: ['RECEBIDO'] },
  { key: 'parciais', label: 'Parcialmente recebidas', status: ['PARCIALMENTE_RECEBIDO'] },
  { key: 'vencidas', label: 'Vencidas', status: ['VENCIDO'] },
  { key: 'canceladas', label: 'Canceladas', status: ['CANCELADO'] },
  { key: 'estornadas', label: 'Estornadas', status: ['ESTORNADO'] },
]

const STATUS_CLASSE: Record<StatusLancamento, string> = {
  RECEBIDO: 'badge-recebida',
  VENCIDO: 'badge-atrasada',
  PARCIALMENTE_RECEBIDO: 'badge-pendente',
  A_VENCER: 'badge-pendente',
  SEM_VENCIMENTO: 'badge-pendente',
  PREVISTO: 'badge-pendente',
  CANCELADO: 'badge-pendente',
  ESTORNADO: 'badge-pendente',
}

export interface ReceitasProps {
  processoId: number
  nomeFamilia?: string
  onUpdate?: () => void
  fxHoje?: number
}

/** Aceita array direto ou wrapper — o backend devolve array. */
function parseLista(data: unknown): ReceitaAPI[] {
  if (Array.isArray(data)) return data as ReceitaAPI[]
  const d = data as { receitas?: ReceitaAPI[]; data?: ReceitaAPI[] } | null
  return d?.receitas ?? d?.data ?? []
}

/** Texto de busca de um lançamento (descrição, serviço, fase, documento, regra). */
function textoBuscavel(r: ReceitaAPI): string {
  return [
    r.descricao, r.codigo, r.faseLabel, r.phaseKey,
    r.tipoServico?.nome,
    r.pessoa ? `${r.pessoa.nome} ${r.pessoa.sobrenome ?? ''}` : '',
    r.documento?.tipo,
    r.categoria,
  ].filter(Boolean).join(' ').toLowerCase()
}

/** Totais por moeda em texto — nunca colapsa moedas diferentes num só número. */
function LinhasPorMoeda({ totais, campo }: { totais: TotalPorMoeda[]; campo: 'contratado' | 'recebido' | 'saldo' }) {
  if (totais.length === 0) return <span className="kpi-value">—</span>
  return (
    <>
      {totais.map((t, i) => (
        <div key={t.moeda} className={i === 0 ? 'kpi-value' : 'kpi-value kpi-value-extra'}>
          {fmtMoeda(t[campo], t.moeda)}
        </div>
      ))}
    </>
  )
}

export function Receitas({ processoId, onUpdate }: ReceitasProps) {
  const [receitas, setReceitas] = useState<ReceitaAPI[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [busca, setBusca] = useState('')
  const [abertos, setAbertos] = useState<Record<string, boolean>>({})
  const [lancamentoAberto, setLancamentoAberto] = useState<number | null>(null)

  const carregar = useCallback(async () => {
    setErro(null)
    try {
      const res = await fetch(`/api/financeiro/receitas?processoId=${processoId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('authToken') || ''}` },
      })
      if (!res.ok) {
        setErro(`Não foi possível carregar receitas (HTTP ${res.status}).`)
        setReceitas([])
        return
      }
      setReceitas(parseLista(await res.json()))
    } catch (err) {
      console.error('[Receitas] erro:', err)
      setErro('Erro de conexão ao carregar receitas.')
      setReceitas([])
    }
  }, [processoId])

  useEffect(() => {
    let vivo = true
    setLoading(true)
    carregar().finally(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [carregar])

  // ── câmbio de referência exibido no cabeçalho ──────────────────────────────
  const cambioRef = useMemo(() => {
    const est = receitas.find((r) => r.moeda !== 'BRL')
    if (!est) return null
    const t = totaisDoLancamento(est)
    return { moeda: est.moeda, taxa: t.cambio, data: est.fxData ?? null, estimado: t.conversaoEstimada }
  }, [receitas])

  // ── resumo (cards) — sempre sobre lançamentos vivos ────────────────────────
  const resumo = useMemo(() => resumoReceitas(receitas), [receitas])

  // ── filtro + busca ─────────────────────────────────────────────────────────
  const exibidas = useMemo(() => {
    const def = FILTROS.find((f) => f.key === filtro)
    const termo = busca.trim().toLowerCase()
    return receitas.filter((r) => {
      // Canceladas/estornadas só aparecem no filtro que as pede.
      const s = statusDoLancamento(r)
      if (!def?.status) {
        if (s === 'CANCELADO' || s === 'ESTORNADO') return false
      } else if (!def.status.includes(s)) {
        return false
      }
      if (termo && !textoBuscavel(r).includes(termo)) return false
      return true
    })
  }, [receitas, filtro, busca])

  const grupos = useMemo(() => {
    const labels: Record<string, string> = {}
    for (const r of receitas) if (r.phaseKey && r.faseLabel) labels[r.phaseKey] = r.faseLabel
    return agruparPorFase(exibidas, labels)
  }, [exibidas, receitas])

  const contarStatus = useCallback(
    (f: Filtro) => {
      const def = FILTROS.find((x) => x.key === f)
      return receitas.filter((r) => {
        const s = statusDoLancamento(r)
        if (!def?.status) return s !== 'CANCELADO' && s !== 'ESTORNADO'
        return def.status.includes(s)
      }).length
    },
    [receitas],
  )

  const alternar = (chave: string) => setAbertos((a) => ({ ...a, [chave]: a[chave] === false }))
  const estaAberto = (chave: string) => abertos[chave] !== false

  // ── linha do lançamento ────────────────────────────────────────────────────
  function LinhaLancamento({ r }: { r: ReceitaAPI }) {
    const t = totaisDoLancamento(r)
    const s = statusDoLancamento(r)
    const abrir = () => setLancamentoAberto(r.id)
    return (
      <tr
        className="rct-linha"
        onClick={abrir}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir() } }}
        tabIndex={0}
        role="button"
        aria-label={`Abrir detalhes de ${r.descricao}`}
        style={{ cursor: 'pointer' }}
      >
        <td>
          <strong>{r.descricao}</strong>
          <span className="muted-xs">
            {[r.faseLabel, r.tipoServico?.nome, r.pessoa ? `${r.pessoa.nome} ${r.pessoa.sobrenome ?? ''}`.trim() : null]
              .filter(Boolean)
              .join(' • ')}
          </span>
        </td>
        <td>{r.categoria === 'HONORARIOS' ? 'Honorários' : r.categoria === 'REEMBOLSO' ? 'Reembolso' : r.categoria === 'PASTA_DOCUMENTAL' ? 'Documental' : 'Outros'}</td>
        {/* VALOR CONTRATUAL — moeda original, apresentação principal */}
        <td><strong>{fmtMoeda(t.contratado, r.moeda)}</strong></td>
        {/* CONVERSÃO — auxiliar, sempre secundária */}
        <td>
          {r.moeda === 'BRL' ? (
            <span className="muted">—</span>
          ) : (
            <>
              <span>{fmtBRL(t.contratadoBrl)}</span>
              <span className="muted-xs">Câmbio {fmtCambio(t.cambio)}{t.conversaoEstimada ? ' (est.)' : ''}</span>
            </>
          )}
        </td>
        <td>
          {t.parcelasRecebidas}/{t.parcelasTotal}{' '}
          <span className="muted-xs">{t.parcelasRecebidas === 1 ? 'recebida' : 'recebidas'}</span>
        </td>
        <td>{fmtMoeda(t.saldo, r.moeda)}</td>
        <td>{t.proximoVencimento ? fmtData(t.proximoVencimento) : <span className="muted">A configurar</span>}</td>
        <td>
          <div style={{ width: 100, height: 6, background: 'var(--fpag-gray-100)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${t.percentualRecebido}%`, height: '100%', background: 'var(--fpag-success)', transition: 'width .3s' }} />
          </div>
          <div className="muted-xs">{t.percentualRecebido.toFixed(0)}%</div>
        </td>
        <td><span className={`badge ${STATUS_CLASSE[s]}`}>{STATUS_LABEL[s]}</span></td>
        <td>
          <button
            type="button"
            className="rct-abrir"
            onClick={(e) => { e.stopPropagation(); abrir() }}
          >
            Abrir detalhes
          </button>
        </td>
      </tr>
    )
  }

  return (
    <div className="fpag-page">
      {/* ── 1 · CABEÇALHO ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Receitas</h1>
          <div className="page-subtitle">Geradas automaticamente pelas regras financeiras do processo.</div>
        </div>
        {cambioRef && (
          <div className="rct-cambio">
            <div className="rct-cambio-taxa">1 {cambioRef.moeda} = {fmtCambio(cambioRef.taxa)} BRL</div>
            <div className="muted-xs">
              {cambioRef.data ? fmtData(cambioRef.data) : 'cotação de referência'}
              {cambioRef.estimado ? ' • estimado' : ' • congelado'}
            </div>
          </div>
        )}
      </div>

      {/* ── 2 · CARDS DE RESUMO (moeda original em destaque) ── */}
      <div className="grid-4">
        <div className="kpi">
          <div className="kpi-label">Total Contratado</div>
          <LinhasPorMoeda totais={resumo.porMoeda} campo="contratado" />
          <div className="kpi-sub">
            {resumo.multiMoeda
              ? `Total estimado em BRL: ${fmtBRL(resumo.totalEstimadoBrl)}`
              : resumo.porMoeda[0]?.moeda && resumo.porMoeda[0].moeda !== 'BRL'
                ? `Aproximadamente ${fmtBRL(resumo.totalEstimadoBrl)}`
                : ''}
          </div>
          <div className="kpi-sub">{resumo.quantidade} {resumo.quantidade === 1 ? 'receita' : 'receitas'}</div>
        </div>

        <div className="kpi">
          <div className="kpi-label">Recebido</div>
          <LinhasPorMoeda totais={resumo.porMoeda} campo="recebido" />
          <div className="kpi-sub">{fmtBRL(resumo.recebidoEstimadoBrl)} convertido</div>
          <div className="kpi-sub">
            {resumo.totalEstimadoBrl > 0
              ? `${((resumo.recebidoEstimadoBrl / resumo.totalEstimadoBrl) * 100).toFixed(0)}% do total`
              : '0% do total'}
          </div>
        </div>

        <div className="kpi">
          <div className="kpi-label">Saldo a Receber</div>
          <LinhasPorMoeda totais={resumo.porMoeda} campo="saldo" />
          <div className="kpi-sub">
            {resumo.multiMoeda
              ? `Estimado em BRL: ${fmtBRL(resumo.saldoEstimadoBrl)}`
              : `Aproximadamente ${fmtBRL(resumo.saldoEstimadoBrl)}`}
          </div>
        </div>

        {/* Situação REAL — "inadimplente" só com parcela vencida e saldo aberto */}
        <div className="kpi">
          <div className="kpi-label">Situação</div>
          <div className={`kpi-value ${resumo.situacao === 'VENCIDO' ? 'neg' : resumo.situacao === 'RECEBIDO' ? 'pos' : ''}`}>
            {STATUS_LABEL[resumo.situacao]}
          </div>
          <div className="kpi-sub">
            {resumo.situacao === 'SEM_VENCIMENTO'
              ? `${resumo.parcelasPendentes} ${resumo.parcelasPendentes === 1 ? 'parcela a configurar' : 'parcelas a configurar'}`
              : `${resumo.parcelasPendentes} ${resumo.parcelasPendentes === 1 ? 'parcela pendente' : 'parcelas pendentes'}`}
          </div>
          {resumo.inadimplente && (
            <div className="kpi-sub neg">
              {resumo.parcelasVencidas} {resumo.parcelasVencidas === 1 ? 'parcela vencida' : 'parcelas vencidas'}
            </div>
          )}
        </div>
      </div>

      {/* ── 3 · FILTROS RÁPIDOS + BUSCA ── */}
      <div className="rct-filtros">
        <div className="filter-tabs">
          {FILTROS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`filter-tab ${filtro === f.key ? 'active' : ''}`}
              onClick={() => setFiltro(f.key)}
            >
              {f.label}
              <span style={{ opacity: 0.6, marginLeft: 6 }}>({contarStatus(f.key)})</span>
            </button>
          ))}
        </div>
        <input
          type="search"
          className="rct-busca"
          placeholder="Buscar por descrição, serviço, fase, documento…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      {erro && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          <span>{erro}</span>
        </div>
      )}

      {/* ── 4 · LISTA AGRUPADA: FASE → SUBGRUPO → LANÇAMENTO ── */}
      <div className="table-card">
        {loading ? (
          <div className="empty-state">Carregando receitas…</div>
        ) : receitas.length === 0 ? (
          <div className="empty-state">
            Nenhuma receita. As receitas do processo são geradas automaticamente pelas regras financeiras.
          </div>
        ) : exibidas.length === 0 ? (
          <div className="empty-state">Nenhuma receita corresponde ao filtro.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Descrição</th>
                <th>Tipo</th>
                <th>Valor contratual</th>
                <th>Conversão</th>
                <th>Parcelas</th>
                <th>Saldo</th>
                <th>Vencimento</th>
                <th>Progresso</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => {
                const chaveFase = `fase:${g.phaseKey ?? '_'}`
                const faseAberta = estaAberto(chaveFase)
                const itensDaFase = g.subgrupos.reduce((n, s) => n + s.itens.length, 0)
                return (
                  <Fragment key={chaveFase}>
                    {/* grupo pai: FASE */}
                    <tr
                      className="rct-grupo rct-grupo-fase"
                      onClick={() => alternar(chaveFase)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td colSpan={9}>
                        <strong>{faseAberta ? '▾' : '▸'} {g.faseLabel}</strong>
                        <span className="muted-xs">{itensDaFase} {itensDaFase === 1 ? 'lançamento' : 'lançamentos'}</span>
                      </td>
                      <td />
                    </tr>

                    {faseAberta &&
                      g.subgrupos.map((sub) => {
                        const chaveSub = `${chaveFase}/${sub.key}`
                        const subAberto = estaAberto(chaveSub)
                        return (
                          <Fragment key={chaveSub}>
                            {/* subgrupo: Honorários Contratuais / Pasta Documental / … */}
                            <tr
                              className="rct-grupo rct-grupo-sub"
                              onClick={() => alternar(chaveSub)}
                              style={{ cursor: 'pointer' }}
                            >
                              <td>
                                <strong>{subAberto ? '▾' : '▸'} {sub.label}</strong>
                                <span className="muted-xs">
                                  {sub.itens.length} {sub.itens.length === 1 ? 'item' : 'itens'}
                                </span>
                              </td>
                              <td />
                              {/* total do subgrupo POR MOEDA — nunca somado entre moedas */}
                              <td>
                                {sub.totaisPorMoeda.map((tm) => (
                                  <div key={tm.moeda}><strong>{fmtMoeda(tm.contratado, tm.moeda)}</strong></div>
                                ))}
                              </td>
                              <td>
                                <span className="muted-xs">
                                  {fmtBRL(sub.totaisPorMoeda.reduce((s, tm) => s + tm.contratadoBrl, 0))} (conv.)
                                </span>
                              </td>
                              <td colSpan={6} />
                            </tr>
                            {subAberto && sub.itens.map((r) => <LinhaLancamento key={r.id} r={r as ReceitaAPI} />)}
                          </Fragment>
                        )
                      })}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── 5 · MODAL FINANCEIRO CENTRAL ── */}
      {lancamentoAberto != null && (
        <ReceitaCobrancaModal
          receitaId={lancamentoAberto}
          onClose={() => setLancamentoAberto(null)}
          onChanged={() => { void carregar(); onUpdate?.() }}
        />
      )}

      <style jsx>{`
        .rct-cambio { text-align: right; }
        .rct-cambio-taxa { font-size: 13px; font-weight: 600; color: #334155; }
        .rct-filtros { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .rct-busca { flex: 1 1 240px; min-width: 200px; max-width: 360px; font: inherit; font-size: 13px; padding: 7px 10px; border: 1px solid #cbd5e1; border-radius: 8px; }
        .rct-abrir { font: inherit; font-size: 12px; padding: 4px 10px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #475569; cursor: pointer; white-space: nowrap; }
        .rct-abrir:hover { background: #f8fafc; }
      `}</style>
    </div>
  )
}

export default Receitas

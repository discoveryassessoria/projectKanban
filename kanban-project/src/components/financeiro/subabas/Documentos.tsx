// src/components/financeiro/subabas/Documentos.tsx
//
// 🆕 Fase 3 v2.6 — Clone FIEL de `renderDocsPrem()` (linha 6503 do
// html_final_marco.html). Central de Documentos Financeiros.
//
// Documentos derivados (sem backend novo):
//   - Para cada parcela de receita gera 1 Fatura (FAT-XXXX)
//   - Se a parcela está RECEBIDA gera também 1 Recibo (REC-XXXX)
//   - Quando o backend tiver tabelas Fatura/Recibo reais, troca o useMemo
//     por fetch.

'use client'

import '@/src/styles/financeiro-paginas.css'
import { useEffect, useMemo, useState } from 'react'
import { parseLista } from '@/src/lib/financeiro/parseLista'

// ============================================================================
// Tipos
// ============================================================================

type Moeda = 'BRL' | 'EUR' | 'USD'
type FxRule = 'FIXO' | 'VARIAVEL'
type StatusParcela = 'PENDENTE' | 'RECEBIDA' | 'PAGA' | 'CANCELADA'

interface ReceitaRequerenteAPI {
  id?: number
  requerenteId?: number | null
  nome?: string | null
  percentual: number | string
  requerente?: { id: number; nome: string } | null
}

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

interface ReceitaAPI {
  id: number
  codigo: string
  descricao: string
  moeda: Moeda
  valor: number | string
  fxEstimado: number | string
  fxRule: FxRule
  fxFixo?: number | string | null
  nParcelas: number
  parcelas: ParcelaAPI[]
  requerentes?: ReceitaRequerenteAPI[]
  criadoEm?: string | null
}

export interface DocumentosProps {
  processoId: number
  codigoProcesso?: string
  fxHoje?: number
}

type DocTipo = 'fatura' | 'recibo' | 'extrato' | 'relatorio'
type DocStatus = 'paga' | 'pago' | 'aberta' | 'vencida' | 'enviada' | 'gerado'

interface Documento {
  tipo: DocTipo
  tipoLabel: string
  tipoIcon: string
  numero: string
  requerente: string
  processo: string
  valor: number | null
  valorBrl: number | null
  moeda: Moeda | null
  data: string
  status: DocStatus
  statusLabel: string
  receitaId?: number
  parcelaN?: number
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
function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso.includes('T') ? iso : iso + 'T00:00:00')
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR')
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}
function shortName(n: string): string {
  if (!n) return '—'
  const parts = n.trim().split(/\s+/)
  if (parts.length <= 2) return n
  return parts[0] + ' ' + parts[parts.length - 1]
}
function shortHash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i)
  return (Math.abs(h) % 9999).toString().padStart(4, '0')
}

// ============================================================================
// Componente
// ============================================================================

const TIPO_FILTRO_OPTIONS: Array<{ value: '' | DocTipo; label: string }> = [
  { value: '', label: 'Todos' },
  { value: 'fatura', label: 'Fatura' },
  { value: 'recibo', label: 'Recibo' },
  { value: 'extrato', label: 'Extrato' },
  { value: 'relatorio', label: 'Relatório' },
]

const PILL_TABS: Array<{ value: '' | DocTipo; label: string }> = [
  { value: '', label: 'Todos' },
  { value: 'fatura', label: 'Faturas' },
  { value: 'recibo', label: 'Recibos' },
  { value: 'extrato', label: 'Extratos' },
  { value: 'relatorio', label: 'Relatórios' },
]

const STATUS_BD: Record<DocStatus, 'green' | 'red' | 'amber' | 'blue' | 'gray'> = {
  paga: 'green',
  pago: 'green',
  aberta: 'red',
  vencida: 'red',
  enviada: 'amber',
  gerado: 'blue',
}

interface DocsFiltros {
  tipo: '' | DocTipo
  requerente: string
  moeda: '' | Moeda
  status: '' | DocStatus
  search: string
}

export function Documentos({
  processoId,
  codigoProcesso,
  fxHoje = 5.5,
}: DocumentosProps) {
  const [receitas, setReceitas] = useState<ReceitaAPI[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [pillTab, setPillTab] = useState<'' | DocTipo>('')
  const [filtros, setFiltros] = useState<DocsFiltros>({
    tipo: '',
    requerente: '',
    moeda: '',
    status: '',
    search: '',
  })
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  // ---- Load ----
  useEffect(() => {
    let cancelado = false
    async function carregar() {
      setLoading(true)
      setErro(null)
      try {
        const headers = {
          Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
        }
        const res = await fetch(
          `/api/financeiro/receitas?processoId=${processoId}`,
          { headers },
        )
        if (cancelado) return
        if (res.ok) {
          const d = await res.json()
          const lst = parseLista<ReceitaAPI>(d)
          if (!cancelado) setReceitas(Array.isArray(lst) ? lst : [])
        }
      } catch (err) {
        console.error('[Documentos] erro:', err)
        if (!cancelado) setErro('Erro de conexão ao carregar documentos.')
      } finally {
        if (!cancelado) setLoading(false)
      }
    }
    carregar()
    return () => {
      cancelado = true
    }
  }, [processoId])

  // ---- Geração de docs (clone _gerarDocs do HTML) ----
  const todos: Documento[] = useMemo(() => {
    const out: Documento[] = []
    const procLabel = codigoProcesso || `#${processoId}`
    const today = todayISO()

    for (const r of receitas) {
      const fx =
        r.moeda === 'BRL'
          ? 1
          : r.fxRule === 'FIXO'
            ? num(r.fxFixo) || num(r.fxEstimado) || fxHoje
            : num(r.fxEstimado) || fxHoje

      const reqs =
        (r.requerentes || []).map((x, idx) => ({
          idx,
          nome: x.requerente?.nome || x.nome || `Requerente ${idx + 1}`,
        })) || []
      const semReq = reqs.length === 0

      for (const p of r.parcelas) {
        const linhas = semReq ? [{ idx: 0, nome: '—' }] : reqs
        for (const reqInfo of linhas) {
          const seedF = `${r.id}-${reqInfo.idx}-${p.numero}`
          const isPaga = p.status === 'RECEBIDA' || p.status === 'PAGA'
          const venc = (p.vencimento || '').slice(0, 10)
          const atrasada = !isPaga && venc && venc < today
          const statusF: DocStatus = isPaga
            ? 'paga'
            : atrasada
              ? 'vencida'
              : 'aberta'
          const valorEur = num(p.valor)
          const valorBrl =
            num(p.valorBrl) || (r.moeda === 'BRL' ? valorEur : valorEur * fx)
          const dataDoc = (r.criadoEm || venc || today).slice(0, 10)

          // Fatura
          out.push({
            tipo: 'fatura',
            tipoLabel: 'Fatura',
            tipoIcon: '📄',
            numero: 'FAT-' + shortHash(seedF),
            requerente: reqInfo.nome,
            processo: procLabel,
            valor: valorEur,
            valorBrl,
            moeda: r.moeda,
            data: dataDoc,
            status: statusF,
            statusLabel:
              { paga: 'Paga', vencida: 'Vencida', aberta: 'Aberta' }[statusF] ||
              'Aberta',
            receitaId: r.id,
            parcelaN: p.numero,
          })

          // Recibo (só se paga)
          if (isPaga) {
            out.push({
              tipo: 'recibo',
              tipoLabel: 'Recibo',
              tipoIcon: '📜',
              numero: 'REC-' + shortHash(seedF + '-rec'),
              requerente: reqInfo.nome,
              processo: procLabel,
              valor: valorEur,
              valorBrl,
              moeda: r.moeda,
              data: (p.dataPagamento || dataDoc).slice(0, 10),
              status: 'pago',
              statusLabel: 'Pago',
              receitaId: r.id,
              parcelaN: p.numero,
            })
          }
        }
      }
    }

    return out.sort((a, b) => (b.data || '').localeCompare(a.data || ''))
  }, [receitas, processoId, codigoProcesso, fxHoje])

  // ---- Requerentes únicos (filtro) ----
  const requerentesUnicos = useMemo(() => {
    const set = new Set<string>()
    todos.forEach((d) => set.add(d.requerente))
    return Array.from(set).filter((x) => x !== '—').sort()
  }, [todos])

  // ---- KPIs (5) ----
  const kpis = useMemo(() => {
    const fat = todos.filter((d) => d.tipo === 'fatura')
    const rec = todos.filter((d) => d.tipo === 'recibo')
    const ext = todos.filter((d) => d.tipo === 'extrato')
    const fatValor = fat.reduce((s, d) => s + (d.valorBrl || 0), 0)
    const recValor = rec.reduce((s, d) => s + (d.valorBrl || 0), 0)
    const pend = fat.filter(
      (d) => d.status === 'aberta' || d.status === 'vencida',
    )
    const pendValor = pend.reduce((s, d) => s + (d.valorBrl || 0), 0)
    return {
      fatCount: fat.length,
      fatValor,
      recCount: rec.length,
      recValor,
      extCount: ext.length,
      totalDocs: todos.length,
      pendCount: pend.length,
      pendValor,
    }
  }, [todos])

  // ---- Filtros ----
  const filtrada = useMemo(() => {
    let f = todos.slice()
    const tipoEfetivo = pillTab || filtros.tipo
    if (tipoEfetivo) f = f.filter((d) => d.tipo === tipoEfetivo)
    if (filtros.requerente)
      f = f.filter((d) => d.requerente === filtros.requerente)
    if (filtros.moeda) f = f.filter((d) => d.moeda === filtros.moeda)
    if (filtros.status) f = f.filter((d) => d.status === filtros.status)
    if (filtros.search.trim()) {
      const s = filtros.search.toLowerCase()
      f = f.filter(
        (d) =>
          d.numero.toLowerCase().includes(s) ||
          d.requerente.toLowerCase().includes(s),
      )
    }
    return f
  }, [todos, pillTab, filtros])

  function limparFiltros() {
    setFiltros({ tipo: '', requerente: '', moeda: '', status: '', search: '' })
    setPillTab('')
  }

  if (loading) {
    return (
      <div className="fpag-page">
        <div className="empty-state" style={{ padding: 60 }}>
          Carregando documentos...
        </div>
      </div>
    )
  }

  return (
    <div className="fpag-page">
      <div className="pp-head">
        <div className="pp-head-l">
          <h1>Central de Documentos Financeiros</h1>
          <div className="pps">
            Visualize, baixe e gerencie todos os documentos financeiros emitidos
          </div>
        </div>
        <div className="pp-head-r">
          <button type="button" className="btn-prem" disabled>
            📁 Nova pasta
          </button>
          <button type="button" className="btn-prem primary" disabled>
            ▼ Filtros
          </button>
        </div>
      </div>

      {erro && (
        <div className="alert alert-warning" style={{ marginBottom: 16 }}>
          <i className="alert-icon">⚠</i>
          <span>{erro}</span>
        </div>
      )}

      {/* === KPIs === */}
      <div className="kpi-strip c5">
        <div className="kpi-prem">
          <div className="kpi-prem-head">
            <div className="kpi-prem-icon purple">📄</div>
            <div className="kpi-prem-label">Faturas Emitidas</div>
          </div>
          <div className="kpi-prem-value">{kpis.fatCount}</div>
          <div className="kpi-prem-sub">{fmtBRL(kpis.fatValor)}</div>
        </div>
        <div className="kpi-prem">
          <div className="kpi-prem-head">
            <div className="kpi-prem-icon green">📜</div>
            <div className="kpi-prem-label">Recibos Emitidos</div>
          </div>
          <div className="kpi-prem-value">{kpis.recCount}</div>
          <div className="kpi-prem-sub">{fmtBRL(kpis.recValor)}</div>
        </div>
        <div className="kpi-prem">
          <div className="kpi-prem-head">
            <div className="kpi-prem-icon blue">📊</div>
            <div className="kpi-prem-label">Extratos Gerados</div>
          </div>
          <div className="kpi-prem-value">{kpis.extCount}</div>
          <div className="kpi-prem-sub">Este mês</div>
        </div>
        <div className="kpi-prem">
          <div className="kpi-prem-head">
            <div className="kpi-prem-icon amber">📁</div>
            <div className="kpi-prem-label">Total de Documentos</div>
          </div>
          <div className="kpi-prem-value">{kpis.totalDocs}</div>
          <div className="kpi-prem-sub">Este mês</div>
        </div>
        <div className="kpi-prem">
          <div className="kpi-prem-head">
            <div className="kpi-prem-icon red">⚠</div>
            <div className="kpi-prem-label">Pendentes de Envio</div>
          </div>
          <div className="kpi-prem-value red">{kpis.pendCount}</div>
          <div className="kpi-prem-sub">{fmtBRL(kpis.pendValor)}</div>
        </div>
      </div>

      {/* === Filter bar === */}
      <div className="fbar">
        <div className="fbr1">
          <label>
            Tipo
            <select
              value={filtros.tipo}
              onChange={(e) =>
                setFiltros((p) => ({
                  ...p,
                  tipo: e.target.value as DocsFiltros['tipo'],
                }))
              }
            >
              {TIPO_FILTRO_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Período
            <input type="text" placeholder="📅 Período" disabled />
          </label>
          <label>
            Requerente
            <select
              value={filtros.requerente}
              onChange={(e) =>
                setFiltros((p) => ({ ...p, requerente: e.target.value }))
              }
            >
              <option value="">Todos</option>
              {requerentesUnicos.map((r) => (
                <option key={r} value={r}>
                  {shortName(r)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Processo
            <select disabled>
              <option>Todos</option>
            </select>
          </label>
          <label>
            Moeda
            <select
              value={filtros.moeda}
              onChange={(e) =>
                setFiltros((p) => ({
                  ...p,
                  moeda: e.target.value as DocsFiltros['moeda'],
                }))
              }
            >
              <option value="">Todas</option>
              <option value="EUR">EUR</option>
              <option value="BRL">BRL</option>
              <option value="USD">USD</option>
            </select>
          </label>
          <label>
            Status
            <select
              value={filtros.status}
              onChange={(e) =>
                setFiltros((p) => ({
                  ...p,
                  status: e.target.value as DocsFiltros['status'],
                }))
              }
            >
              <option value="">Todos</option>
              <option value="aberta">Aberta</option>
              <option value="paga">Paga</option>
              <option value="pago">Pago</option>
              <option value="enviada">Enviada</option>
              <option value="vencida">Vencida</option>
              <option value="gerado">Gerado</option>
            </select>
          </label>
        </div>
        <div className="fbr2">
          <input
            type="text"
            placeholder="🔍 Buscar documento..."
            value={filtros.search}
            onChange={(e) =>
              setFiltros((p) => ({ ...p, search: e.target.value }))
            }
            style={{
              flex: 1,
              padding: '9px 12px',
              border: '1px solid var(--fpag-gray-200)',
              borderRadius: 8,
              fontSize: 13,
              fontFamily: 'inherit',
            }}
          />
          <button
            type="button"
            className="fb-clear"
            onClick={limparFiltros}
            style={{ marginLeft: 14 }}
          >
            ↻ Limpar filtros
          </button>
        </div>
      </div>

      {/* === Pill tabs === */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        {PILL_TABS.map((t) => {
          const count = t.value
            ? todos.filter((d) => d.tipo === t.value).length
            : todos.length
          const active = pillTab === t.value
          return (
            <button
              key={t.value || 'todos'}
              type="button"
              onClick={() => setPillTab(t.value)}
              style={{
                padding: '8px 16px',
                borderRadius: 999,
                border: '1px solid var(--fpag-gray-200)',
                background: active ? 'var(--fpag-primary)' : '#fff',
                color: active ? '#fff' : 'var(--fpag-gray-700)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.15s',
              }}
            >
              {t.label}{' '}
              <span
                style={{
                  marginLeft: 6,
                  background: active
                    ? 'rgba(255,255,255,0.25)'
                    : 'var(--fpag-gray-100)',
                  color: active ? '#fff' : 'var(--fpag-gray-600)',
                  padding: '1px 7px',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* === Tabela === */}
      <div className="tprem">
        <table>
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Número</th>
              <th>Requerente</th>
              <th>Processo</th>
              <th>Valor</th>
              <th>Moeda</th>
              <th>Data</th>
              <th>Status</th>
              <th className="right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtrada.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="empty-state"
                  style={{ textAlign: 'center', padding: 40 }}
                >
                  Nenhum documento neste filtro.
                </td>
              </tr>
            ) : (
              filtrada.map((d, i) => {
                const isSel = selectedIdx === i
                const stBd = STATUS_BD[d.status]
                return (
                  <tr
                    key={i}
                    className={`rcp${isSel ? ' sel' : ''}`}
                    onClick={() => setSelectedIdx(i)}
                  >
                    <td>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 6,
                            background:
                              d.tipo === 'fatura'
                                ? '#e0e7ff'
                                : d.tipo === 'recibo'
                                  ? '#d1fae5'
                                  : d.tipo === 'extrato'
                                    ? '#dbeafe'
                                    : '#f1f5f9',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 13,
                          }}
                        >
                          {d.tipoIcon}
                        </span>
                        {d.tipoLabel}
                      </span>
                    </td>
                    <td>
                      <strong>{d.numero}</strong>
                    </td>
                    <td>{shortName(d.requerente)}</td>
                    <td>{d.processo}</td>
                    <td>
                      {d.valor !== null && d.moeda
                        ? fmtMoeda(d.valor, d.moeda)
                        : '—'}
                    </td>
                    <td>{d.moeda || '—'}</td>
                    <td>{fmtDate(d.data)}</td>
                    <td>
                      <span className={`bd ${stBd}`}>{d.statusLabel}</span>
                    </td>
                    <td
                      className="right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        title="Visualizar"
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: 14,
                          color: 'var(--fpag-gray-600)',
                          margin: '0 2px',
                        }}
                      >
                        👁
                      </button>
                      <button
                        type="button"
                        title="Baixar"
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: 14,
                          color: 'var(--fpag-gray-600)',
                          margin: '0 2px',
                        }}
                      >
                        ⬇
                      </button>
                      <button
                        type="button"
                        title="Mais"
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: 14,
                          color: 'var(--fpag-gray-600)',
                          margin: '0 2px',
                        }}
                      >
                        ⋯
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <div
        style={{
          marginTop: 14,
          fontSize: 12,
          color: 'var(--fpag-gray-500)',
        }}
      >
        Mostrando 1 a {filtrada.length} de {todos.length} registros
      </div>
    </div>
  )
}

export default Documentos
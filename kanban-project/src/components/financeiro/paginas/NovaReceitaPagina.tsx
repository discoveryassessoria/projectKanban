// src/components/financeiro/paginas/NovaReceitaPagina.tsx
//
// 🆕 Fase 3 v2 — Clone FIEL da #page-nova-receita do html_final_marco.html.
//
// Diferenças vs. v1 (modal):
//   - Agora é TELA interna (não modal). Usa breadcrumb + botão "← Voltar".
//   - Visual idêntico ao HTML mestre — usa as classes do CSS unificado
//     (`src/styles/financeiro-paginas.css`) e raiz `<div class="fpag-page">`.
//   - Sidebar com formato "10 × 4 req. = 40" no número de parcelas.
//   - Lógica do split entre requerentes idêntica à do HTML
//     (redistribuição automática quando edita % ou valor de uma linha).
//
// Endpoints:
//   - GET  /api/processos/:id        → carrega requerentes
//   - POST /api/financeiro/receitas  → cria Receita + parcelas
//
// Backend (schema atual): parcelas são por PERÍODO (nParc parcelas no total).
// Frontend (visual igual ao HTML): mostra split entre requerentes nas parcelas.
// Quando salva, envia `requerentes[]` com percentuais — backend gera parcelas
// consolidadas. A "expansão" por requerente fica derivada na UI.

'use client'

import { useState, useEffect, useMemo } from 'react'

// ============================================================================
// Tipos
// ============================================================================

type Moeda = 'BRL' | 'EUR' | 'USD'
type FxRule = 'fixo' | 'variavel'
type Tipo = 'Honorários' | 'Reembolso' | 'Outros'
type Divisao = 'igual' | 'personalizada'

interface RequerenteAPI {
  id: number
  nome: string
  idade?: number | null
  dataNascimento?: string | null
}

interface ReqState {
  requerenteId: number | null
  idx: number
  nome: string
  idade: number | null
  isAdulto: boolean
  participa: boolean
  percentual: number
}

export interface NovaReceitaPaginaProps {
  processoId: number
  fxHoje: number
  onVoltar: () => void
  onCriado: (receita: unknown) => void
}

// ============================================================================
// Helpers
// ============================================================================

const TIPO_TO_ENUM: Record<Tipo, string> = {
  'Honorários': 'HONORARIOS',
  'Reembolso': 'REEMBOLSO',
  'Outros': 'OUTROS',
}

function parseFloatBR(s: string): number {
  if (!s) return 0
  const limpo = String(s).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  const n = parseFloat(limpo)
  return isFinite(n) ? n : 0
}
function fmtBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function fmtMoeda(v: number, m: Moeda): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: m })
}
function moedaSimbolo(m: Moeda): string {
  return m === 'BRL' ? 'R$' : m === 'EUR' ? '€' : 'US$'
}
function fmtDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR')
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}
function addMonths(iso: string, n: number): string {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return ''
  d.setMonth(d.getMonth() + n)
  return d.toISOString().slice(0, 10)
}
function calcularIdade(dataNasc?: string | null): number | null {
  if (!dataNasc) return null
  const d = new Date(dataNasc)
  if (isNaN(d.getTime())) return null
  const hoje = new Date()
  let idade = hoje.getFullYear() - d.getFullYear()
  const m = hoje.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && hoje.getDate() < d.getDate())) idade--
  return idade
}

// ============================================================================
// Componente
// ============================================================================

export function NovaReceitaPagina({
  processoId,
  fxHoje,
  onVoltar,
  onCriado,
}: NovaReceitaPaginaProps) {
  // ---- Form ----
  const [tipo, setTipo] = useState<Tipo>('Honorários')
  const [descricao, setDescricao] = useState('')
  const [moeda] = useState<Moeda>('EUR') // disabled no HTML
  const [valor, setValor] = useState('')
  const [fxEst, setFxEst] = useState(fxHoje.toFixed(2).replace('.', ','))
  const [fxRule, setFxRule] = useState<FxRule>('fixo')
  const [fxFixo, setFxFixo] = useState(fxHoje.toFixed(2).replace('.', ','))
  const [fxData, setFxData] = useState(todayISO())
  const [forma, setForma] = useState<'Parcelado' | 'À vista'>('Parcelado')
  const [nParc, setNParc] = useState('10')
  const [data1, setData1] = useState(todayISO())
  const [requerentes, setRequerentes] = useState<ReqState[]>([])
  const [divisao, setDivisao] = useState<Divisao>('igual')

  // ---- UI ----
  const [loadingReq, setLoadingReq] = useState(false)
  const [erroReq, setErroReq] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // ---- Carregar requerentes ----
  useEffect(() => {
    let cancelado = false
    async function carregar() {
      setLoadingReq(true)
      setErroReq(null)
      try {
        const res = await fetch(`/api/processos/${processoId}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('authToken') || ''}` },
        })
        if (cancelado) return
        let lista: RequerenteAPI[] = []
        if (res.ok) {
          const data = await res.json()
          lista =
            data?.requerentes ||
            data?.processo?.requerentes ||
            data?.data?.requerentes ||
            []
        } else {
          setErroReq(`Falha ao carregar requerentes (HTTP ${res.status}).`)
        }
        if (!Array.isArray(lista)) lista = []
        const reqs: ReqState[] = lista.map((r, i) => {
          const idade = r.idade ?? calcularIdade(r.dataNascimento)
          const isAdulto = idade == null ? true : idade >= 18
          return {
            requerenteId: r.id,
            idx: i,
            nome: r.nome || `Requerente ${i + 1}`,
            idade,
            isAdulto,
            participa: isAdulto,
            percentual: 0,
          }
        })
        const adultos = reqs.filter((r) => r.participa).length
        if (adultos > 0) {
          const cada = 100 / adultos
          reqs.forEach((r) => {
            r.percentual = r.participa ? cada : 0
          })
        }
        if (!cancelado) setRequerentes(reqs)
      } catch (err) {
        console.error('[NovaReceitaPagina] erro:', err)
        if (!cancelado) {
          setErroReq('Erro de conexão ao carregar requerentes.')
          setRequerentes([])
        }
      } finally {
        if (!cancelado) setLoadingReq(false)
      }
    }
    carregar()
    return () => {
      cancelado = true
    }
  }, [processoId])

  // ---- Toggles ----
  useEffect(() => {
    if (forma === 'À vista') setNParc('1')
  }, [forma])

  // ---- Computed ----
  const valorNum = parseFloatBR(valor)
  const fxEstNum = parseFloatBR(fxEst) || fxHoje
  const fxFixoNum = parseFloatBR(fxFixo) || fxEstNum
  const nParcNum = Math.max(1, parseInt(nParc) || 1)
  const fxAtual = moeda === 'BRL' ? 1 : fxRule === 'fixo' ? fxFixoNum : fxEstNum
  const totalBrl = valorNum * fxAtual
  const valorBrlEst = valorNum * fxEstNum
  const valorBrlFixo = valorNum * fxFixoNum
  const parcMoeda = valorNum / nParcNum
  const parcBrl = parcMoeda * fxAtual
  const adultos = requerentes.filter((r) => r.participa).length
  const totalParcelasIndiv = adultos * nParcNum
  const parcEurPorReq = adultos > 0 ? parcMoeda / adultos : 0
  const parcBrlPorReq = adultos > 0 ? parcBrl / adultos : 0

  const somaPct = useMemo(
    () =>
      requerentes.filter((r) => r.participa).reduce((s, r) => s + r.percentual, 0),
    [requerentes],
  )
  const somaOk = Math.abs(somaPct - 100) < 0.01

  // ---- Divisão / participação ----
  function setDivisaoMode(d: Divisao) {
    setDivisao(d)
    if (d === 'igual') {
      setRequerentes((prev) => {
        const partic = prev.filter((r) => r.participa)
        const cada = partic.length > 0 ? 100 / partic.length : 0
        return prev.map((r) => ({ ...r, percentual: r.participa ? cada : 0 }))
      })
    }
  }

  function onParticipaChange(idx: number, checked: boolean) {
    setRequerentes((prev) => {
      const novo = prev.map((r) =>
        r.idx === idx
          ? { ...r, participa: checked, percentual: checked ? r.percentual : 0 }
          : r,
      )
      const partic = novo.filter((r) => r.participa)
      if (partic.length === 0) return novo
      const cada = 100 / partic.length
      return novo.map((r) => (r.participa ? { ...r, percentual: cada } : r))
    })
  }

  // Quando user edita o % de um requerente: redistribui o restante entre os outros
  function onPctChange(idx: number, valStr: string) {
    if (divisao !== 'personalizada') return
    const v = parseFloatBR(valStr)
    setRequerentes((prev) => {
      const r = prev.find((x) => x.idx === idx)
      if (!r || !r.participa) return prev
      const pctClamp = Math.max(0, Math.min(100, v))
      const restante = Math.max(0, 100 - pctClamp)
      const outros = prev.filter((x) => x.participa && x.idx !== idx)
      const cadaOutro = outros.length > 0 ? restante / outros.length : 0
      return prev.map((x) => {
        if (x.idx === idx) return { ...x, percentual: pctClamp }
        if (x.participa) return { ...x, percentual: cadaOutro }
        return x
      })
    })
  }

  function onValorReqChange(idx: number, valStr: string) {
    if (divisao !== 'personalizada') return
    if (valorNum <= 0) return
    const v = parseFloatBR(valStr)
    const novoPct = (v / valorNum) * 100
    onPctChange(idx, novoPct.toString())
  }

  // ---- Submit ----
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (!descricao.trim()) {
      setErro('Descrição obrigatória.')
      return
    }
    if (valorNum <= 0) {
      setErro('Valor deve ser maior que zero.')
      return
    }
    const participantes = requerentes.filter((r) => r.participa && r.percentual > 0)
    if (participantes.length === 0) {
      setErro('Marque ao menos 1 requerente com % maior que zero.')
      return
    }
    if (!somaOk) {
      setErro(`Soma dos percentuais deve ser 100%. Atual: ${somaPct.toFixed(2)}%.`)
      return
    }

    setSalvando(true)
    try {
      const body = {
        processoId,
        categoria: TIPO_TO_ENUM[tipo],
        descricao: descricao.trim(),
        moeda,
        valor: valorNum,
        fxEstimado: moeda === 'BRL' ? 1 : fxEstNum,
        fxRule: moeda === 'BRL' ? 'FIXO' : fxRule.toUpperCase(),
        fxFixo: fxRule === 'fixo' && moeda !== 'BRL' ? fxFixoNum : null,
        fxData: fxRule === 'fixo' && moeda !== 'BRL' ? fxData : null,
        nParcelas: nParcNum,
        data1,
        periodicidade: 'Mensal',
        requerentes: participantes.map((r) => ({
          idx: r.idx,
          nome: r.nome,
          idade: r.idade,
          statusFamiliar: r.isAdulto ? 'Adulto' : 'Menor',
          percentual: r.percentual,
          requerenteId: r.requerenteId,
        })),
      }
      const res = await fetch('/api/financeiro/receitas', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const msg =
          data?.error ||
          data?.details?.issues?.[0]?.message ||
          `Erro ${res.status}: falha ao criar receita.`
        setErro(msg)
        return
      }
      const novaReceita = await res.json()
      onCriado(novaReceita)
    } catch (err) {
      console.error('[NovaReceitaPagina] submit erro:', err)
      setErro('Erro de conexão. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  // ---- Render ----
  return (
    <div className="fpag-page">
      <div className="breadcrumb">
        <a onClick={onVoltar}>Financeiro</a>
        <span className="breadcrumb-sep">›</span>
        <a onClick={onVoltar}>Receitas</a>
        <span className="breadcrumb-sep">›</span>
        <span>Nova Receita</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Nova Receita</h1>
          <div className="page-subtitle">Cadastre uma nova receita para este processo</div>
        </div>
        <button type="button" className="btn-outline" onClick={onVoltar}>
          ← Voltar para Receitas
        </button>
      </div>

      {erro && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          <i className="alert-icon">⚠</i>
          <span>{erro}</span>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="detail-layout">
          <div>
            {/* === 1. Dados === */}
            <div className="form-card">
              <div className="form-card-title">1. Dados da Receita</div>

              <div className="form-grid-3">
                <div className="form-field">
                  <label className="form-label">Tipo de Receita</label>
                  <select
                    className="form-select"
                    value={tipo}
                    onChange={(e) => setTipo(e.target.value as Tipo)}
                  >
                    <option>Honorários</option>
                    <option>Reembolso</option>
                    <option>Outros</option>
                  </select>
                </div>
                <div className="form-field form-field-full" style={{ gridColumn: 'span 2' }}>
                  <label className="form-label">Descrição</label>
                  <input
                    className="form-input"
                    value={descricao}
                    onChange={(e) => setDescricao(e.target.value)}
                    placeholder="Ex.: Honorários advocatícios"
                  />
                </div>
              </div>

              <div className="form-grid-4" style={{ marginTop: 14 }}>
                <div className="form-field">
                  <label className="form-label">
                    Moeda base <i className="info-i" title="Moeda em que o valor é expresso">i</i>
                  </label>
                  <select className="form-select" disabled value="EUR">
                    <option value="EUR">EUR — Euro (€)</option>
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label">Valor total em EUR</label>
                  <input
                    className="form-input"
                    type="text"
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                    placeholder="€ 0,00"
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">
                    Câmbio estimado (EUR → BRL){' '}
                    <i className="info-i" title="Câmbio de referência usado para projeção">i</i>
                  </label>
                  <input
                    className="form-input"
                    type="text"
                    value={fxEst}
                    onChange={(e) => setFxEst(e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">Valor estimado em BRL</label>
                  <input
                    className="form-input form-input-readonly"
                    readOnly
                    value={fmtBRL(valorBrlEst)}
                  />
                </div>
              </div>
            </div>

            {/* === 2. Regra de Câmbio === */}
            <div className="form-card">
              <div className="form-card-title">
                2. Regra de Câmbio{' '}
                <i className="info-i" title="Define se o câmbio é fixado agora ou variável">i</i>
              </div>
              <div className="exchange-rule-cards">
                <div
                  className={`exchange-rule-card ${fxRule === 'fixo' ? 'selected' : ''}`}
                  onClick={() => setFxRule('fixo')}
                >
                  <div className="exchange-rule-card-head">
                    <div className="exchange-rule-radio" />
                    <div className="exchange-rule-card-title">
                      Câmbio fixo para todas as parcelas
                    </div>
                  </div>
                  <div className="exchange-rule-card-desc">
                    Você define o câmbio agora e todas as parcelas serão fixas em reais.
                  </div>
                  <div className="exchange-rule-body" onClick={(e) => e.stopPropagation()}>
                    <div className="exchange-rule-body-grid">
                      <div className="form-field">
                        <label className="form-label">Câmbio fixado (EUR → BRL)</label>
                        <input
                          className="form-input"
                          type="text"
                          value={fxFixo}
                          onChange={(e) => setFxFixo(e.target.value)}
                        />
                      </div>
                      <div className="form-field">
                        <label className="form-label">Data da fixação</label>
                        <input
                          className="form-input"
                          type="date"
                          value={fxData}
                          onChange={(e) => setFxData(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="fx-fixo-result">
                      <div className="fx-fixo-result-icon">✓</div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--fpag-gray-600)' }}>
                          Valor total em BRL (fixo)
                        </div>
                        <div
                          style={{
                            fontSize: 18,
                            fontWeight: 700,
                            color: 'var(--fpag-success-dark)',
                          }}
                        >
                          {fmtBRL(valorBrlFixo)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  className={`exchange-rule-card ${fxRule === 'variavel' ? 'selected' : ''}`}
                  onClick={() => setFxRule('variavel')}
                >
                  <div className="exchange-rule-card-head">
                    <div className="exchange-rule-radio" />
                    <div className="exchange-rule-card-title">
                      Câmbio variável por recebimento
                    </div>
                  </div>
                  <div className="exchange-rule-card-desc">
                    O câmbio será informado em cada recebimento (baixa).
                  </div>
                  <div className="exchange-rule-body">
                    <div className="fx-var-info">
                      <span>ⓘ</span>
                      <span>
                        O valor em reais será definido no momento de cada recebimento, conforme o
                        câmbio do dia.
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* === 3. Condições === */}
            <div className="form-card">
              <div className="form-card-title">3. Condições de Pagamento</div>
              <div className="form-grid-4">
                <div className="form-field">
                  <label className="form-label">Forma de pagamento</label>
                  <select
                    className="form-select"
                    value={forma}
                    onChange={(e) => setForma(e.target.value as 'Parcelado' | 'À vista')}
                  >
                    <option>Parcelado</option>
                    <option>À vista</option>
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label">Número de parcelas</label>
                  <input
                    className="form-input"
                    type="number"
                    min={1}
                    max={120}
                    value={nParc}
                    onChange={(e) => setNParc(e.target.value)}
                    disabled={forma === 'À vista'}
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">Data da 1ª parcela</label>
                  <input
                    className="form-input"
                    type="date"
                    value={data1}
                    onChange={(e) => setData1(e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">Periodicidade</label>
                  <select className="form-select" disabled defaultValue="Mensal">
                    <option>Mensal</option>
                  </select>
                </div>
              </div>
              <div className="alert alert-info mb-0" style={{ marginTop: 14 }}>
                <i className="alert-icon">ⓘ</i>
                <span>Todas as parcelas serão geradas automaticamente.</span>
              </div>
            </div>

            {/* === 4. Distribuição === */}
            <div className="form-card">
              <div className="form-card-title">4. Distribuição entre Requerentes</div>
              <div className="division-cards">
                <div
                  className={`division-card ${divisao === 'igual' ? 'selected' : ''}`}
                  onClick={() => setDivisaoMode('igual')}
                >
                  <div className="division-card-head">
                    <div className="exchange-rule-radio" />
                    <div className="division-card-title">Divisão igual</div>
                  </div>
                  <div className="division-card-desc">
                    Divide igualmente o valor entre os requerentes adultos.
                  </div>
                </div>
                <div
                  className={`division-card ${divisao === 'personalizada' ? 'selected' : ''}`}
                  onClick={() => setDivisaoMode('personalizada')}
                >
                  <div className="division-card-head">
                    <div className="exchange-rule-radio" />
                    <div className="division-card-title">Divisão personalizada</div>
                  </div>
                  <div className="division-card-desc">
                    Permite definir percentuais ou valores específicos para cada requerente.
                  </div>
                </div>
              </div>

              {erroReq ? (
                <div className="alert alert-warning" style={{ marginBottom: 14 }}>
                  <i className="alert-icon">⚠</i>
                  <span>{erroReq}</span>
                </div>
              ) : (
                <div className="alert alert-success mb-0" style={{ marginBottom: 14 }}>
                  <i className="alert-icon">✓</i>
                  <span>
                    {adultos} requerente(s) adulto(s) selecionado(s)
                    {requerentes.length > adultos
                      ? '. Menores de idade não foram incluídos na divisão.'
                      : '.'}
                  </span>
                </div>
              )}

              {loadingReq ? (
                <div className="empty-state">Carregando requerentes...</div>
              ) : requerentes.length === 0 ? (
                <div className="empty-state">Nenhum requerente carregado.</div>
              ) : (
                <>
                  <table className="req-table">
                    <thead>
                      <tr>
                        <th>REQUERENTE</th>
                        <th>IDADE</th>
                        <th>STATUS</th>
                        <th>PERCENTUAL</th>
                        <th>VALOR TOTAL ({moedaSimbolo(moeda)})</th>
                        <th>VALOR POR PARCELA ({moedaSimbolo(moeda)})</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requerentes.map((r) => {
                        const totalReq = (valorNum * r.percentual) / 100
                        const parcReq = nParcNum > 0 ? totalReq / nParcNum : 0
                        const isMenor = !r.isAdulto
                        const naoParticipa = !r.participa
                        const inputDisabled =
                          divisao === 'igual' || isMenor || naoParticipa
                        const cbDisabled = isMenor
                        let badge: React.ReactNode
                        if (isMenor) badge = <span className="badge badge-pendente">Menor</span>
                        else if (!r.participa)
                          badge = <span className="badge badge-pendente">Não participa</span>
                        else
                          badge = <span className="badge badge-fx-fixo-sm">Participa</span>
                        return (
                          <tr key={r.idx} style={naoParticipa ? { opacity: 0.4 } : undefined}>
                            <td>
                              <input
                                type="checkbox"
                                checked={r.participa}
                                disabled={cbDisabled}
                                onChange={(e) => onParticipaChange(r.idx, e.target.checked)}
                                style={{
                                  width: 16,
                                  height: 16,
                                  accentColor: 'var(--fpag-primary)',
                                  cursor: cbDisabled ? 'not-allowed' : 'pointer',
                                  marginRight: 8,
                                  verticalAlign: 'middle',
                                }}
                              />{' '}
                              {r.nome}
                            </td>
                            <td>{r.idade ?? '—'}</td>
                            <td>{badge}</td>
                            <td>
                              <input
                                className="req-input-pct"
                                type="number"
                                step="0.01"
                                min={0}
                                max={100}
                                value={r.percentual.toFixed(2)}
                                disabled={inputDisabled}
                                onChange={(e) => onPctChange(r.idx, e.target.value)}
                              />{' '}
                              %
                            </td>
                            <td>
                              <input
                                className="req-input-pct"
                                style={{ width: 120, textAlign: 'right' }}
                                type="text"
                                value={totalReq.toFixed(2).replace('.', ',')}
                                disabled={inputDisabled}
                                onChange={(e) => onValorReqChange(r.idx, e.target.value)}
                              />
                            </td>
                            <td>
                              {naoParticipa ? (
                                <span className="muted">—</span>
                              ) : (
                                fmtMoeda(parcReq, moeda)
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>

                  <div
                    style={{
                      marginTop: 10,
                      padding: '8px 12px',
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      textAlign: 'center',
                      background: somaOk
                        ? '#d1fae5'
                        : somaPct < 100
                          ? '#fef3c7'
                          : '#fee2e2',
                      color: somaOk
                        ? '#065f46'
                        : somaPct < 100
                          ? '#92400e'
                          : '#991b1b',
                    }}
                  >
                    {somaOk
                      ? `✓ Soma: 100,00% — divisão completa (${fmtMoeda(valorNum, moeda)})`
                      : somaPct < 100
                        ? `⚠ Soma: ${somaPct.toFixed(2)}% — faltam ${(100 - somaPct).toFixed(2)}% (${fmtMoeda((valorNum * (100 - somaPct)) / 100, moeda)})`
                        : `⚠ Soma: ${somaPct.toFixed(2)}% — excede em ${(somaPct - 100).toFixed(2)}% (${fmtMoeda((valorNum * (somaPct - 100)) / 100, moeda)})`}
                  </div>
                </>
              )}
            </div>

            {/* === Actions === */}
            <div className="actions-bar">
              <button type="button" className="btn-outline" disabled>
                📝 Salvar como rascunho
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={salvando || !somaOk || valorNum <= 0 || !descricao.trim()}
              >
                {salvando ? 'Criando...' : '✓ Criar Receita'}
              </button>
            </div>
          </div>

          {/* === Sidebar === */}
          <aside>
            <div className="sidebar-resumo">
              <div className="sidebar-resumo-title">Resumo da Receita</div>

              <div className={`fx-rule-box ${fxRule === 'fixo' ? 'fixo' : 'variavel'}`}>
                <div className="fx-rule-box-head">
                  <div className="fx-rule-box-title">📑 Regra de câmbio</div>
                  <span
                    className={`badge ${fxRule === 'fixo' ? 'badge-fx-fixo' : 'badge-fx-var'}`}
                  >
                    {fxRule === 'fixo' ? 'CÂMBIO FIXO' : 'CÂMBIO VARIÁVEL'}
                  </span>
                </div>
                <div className="fx-rule-box-info">
                  {fxRule === 'fixo' ? (
                    <>
                      Câmbio fixado: {moedaSimbolo(moeda)}1 = {fmtBRL(fxFixoNum)}
                      <br />
                      Data da fixação: {fmtDate(fxData)}
                    </>
                  ) : (
                    <>
                      Câmbio estimado: {moedaSimbolo(moeda)}1 = {fmtBRL(fxEstNum)}
                      <br />
                      Valores reais a cada recebimento.
                    </>
                  )}
                </div>
              </div>

              <div className="resumo-row">
                <span>Valor total ({moeda})</span>
                <strong>{fmtMoeda(valorNum, moeda)}</strong>
              </div>
              <div className="resumo-row">
                <span>
                  {moeda === 'BRL'
                    ? 'Valor total (Real)'
                    : fxRule === 'fixo'
                      ? 'Valor total em BRL (fixo)'
                      : 'Valor total em BRL (estimado)'}
                </span>
                <strong className="brl">
                  {fmtBRL(totalBrl)}
                  {moeda !== 'BRL' && fxRule === 'variavel' ? ' (est.)' : ''}
                </strong>
              </div>
              <div className="resumo-row">
                <span>Número de parcelas</span>
                <strong>
                  {nParcNum}
                  {adultos > 0 ? ` × ${adultos} req. = ${totalParcelasIndiv}` : ''}
                </strong>
              </div>
              <div className="resumo-row">
                <span>Valor por parcela ({moeda})</span>
                <strong>{fmtMoeda(parcEurPorReq, moeda)}</strong>
              </div>
              <div className="resumo-row">
                <span>Valor por parcela (BRL)</span>
                <strong className="brl">
                  {fmtBRL(parcBrlPorReq)}
                  {moeda !== 'BRL' && fxRule === 'variavel' ? ' (est.)' : ''}
                </strong>
              </div>
              <div className="resumo-row">
                <span>Requerentes</span>
                <strong>{adultos} adulto{adultos === 1 ? '' : 's'}</strong>
              </div>
              <div className="resumo-row">
                <span>Tipo de receita</span>
                <strong>{tipo}</strong>
              </div>
              <div className="resumo-row">
                <span>Periodicidade</span>
                <strong>Mensal</strong>
              </div>
              <div className="resumo-row">
                <span>Data da 1ª parcela</span>
                <strong>{fmtDate(data1)}</strong>
              </div>
              <div className="resumo-row">
                <span>Última parcela</span>
                <strong>{fmtDate(addMonths(data1, nParcNum - 1))}</strong>
              </div>

              <div className="alert alert-warning mb-0" style={{ marginTop: 14 }}>
                <i className="alert-icon">⚠</i>
                <span>
                  <strong>Importante</strong>
                  <br />
                  {moeda === 'BRL' || fxRule === 'fixo'
                    ? `${adultos} adulto(s) × ${nParcNum} parcelas = ${totalParcelasIndiv} parcelas individuais.`
                    : `Valores BRL definidos a cada recebimento. ${adultos} adulto(s) × ${nParcNum} parcelas = ${totalParcelasIndiv} parcelas individuais.`}
                </span>
              </div>
            </div>
          </aside>
        </div>
      </form>
    </div>
  )
}

export default NovaReceitaPagina
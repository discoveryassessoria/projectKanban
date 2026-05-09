// src/components/financeiro/paginas/NovoCustoPagina.tsx
//
// 🆕 Fase 3 v2 — Clone FIEL da #page-novo-custo do html_final_marco.html.

'use client'

import { useState, useEffect } from 'react'

// ============================================================================
// Tipos
// ============================================================================

type Moeda = 'BRL' | 'EUR' | 'USD'
type FxRule = 'fixo' | 'variavel'

type TipoLabel = 'Serviço' | 'Imposto' | 'Documento' | 'Despesa'
type CategoriaLabel =
  | 'Traduções e juramentações'
  | 'Apostilamentos'
  | 'Honorários do escritório'
  | 'Taxas consulares'
  | 'Outros'
type FormaLabel =
  | 'Transferência bancária'
  | 'PIX'
  | 'Boleto'
  | 'Cartão'

const TIPO_TO_ENUM: Record<TipoLabel, string> = {
  'Serviço': 'SERVICO',
  'Imposto': 'IMPOSTO',
  'Documento': 'DOCUMENTO',
  'Despesa': 'DESPESA',
}
const CAT_TO_ENUM: Record<CategoriaLabel, string> = {
  'Traduções e juramentações': 'TRADUCOES_JURAMENTACOES',
  'Apostilamentos': 'APOSTILAMENTOS',
  'Honorários do escritório': 'HONORARIOS_ESCRITORIO',
  'Taxas consulares': 'TAXAS_CONSULARES',
  'Outros': 'OUTROS',
}
const FORMA_TO_ENUM: Record<FormaLabel, string> = {
  'Transferência bancária': 'TRANSFERENCIA',
  'PIX': 'PIX',
  'Boleto': 'BOLETO',
  'Cartão': 'CARTAO_CREDITO',
}

export interface NovoCustoPaginaProps {
  processoId: number
  fxHoje: number
  onVoltar: () => void
  onCriado: (custo: unknown) => void
}

// ============================================================================
// Helpers
// ============================================================================

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

// ============================================================================
// Componente
// ============================================================================

export function NovoCustoPagina({
  processoId,
  fxHoje,
  onVoltar,
  onCriado,
}: NovoCustoPaginaProps) {
  const [tipo, setTipo] = useState<TipoLabel>('Serviço')
  const [categoria, setCategoria] = useState<CategoriaLabel>('Traduções e juramentações')
  const [descricao, setDescricao] = useState('')
  const [fornecedor, setFornecedor] = useState('')
  const [dataCusto, setDataCusto] = useState(todayISO())
  const [moeda] = useState<Moeda>('EUR') // disabled no HTML
  const [valor, setValor] = useState('')
  const [fxEst, setFxEst] = useState(fxHoje.toFixed(2).replace('.', ','))
  const [fxRule, setFxRule] = useState<FxRule>('fixo')
  const [fxFixo, setFxFixo] = useState(fxHoje.toFixed(2).replace('.', ','))
  const [fxData, setFxData] = useState(todayISO())
  const [situacao, setSituacao] = useState<'A pagar' | 'Pago'>('A pagar')
  const [forma, setForma] = useState<FormaLabel>('Transferência bancária')
  const [vencimento, setVencimento] = useState(todayISO())
  const [parcelamento, setParcelamento] = useState('1')

  // Vínculo do Custo
  const [operacional, setOperacional] = useState(false)
  const [vincCategoria, setVincCategoria] = useState<'Honorários' | 'Reembolso' | 'Outros'>(
    'Honorários',
  )
  const [vincPct, setVincPct] = useState('100')

  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // ---- Computed ----
  const valorNum = parseFloatBR(valor)
  const fxEstNum = parseFloatBR(fxEst) || fxHoje
  const fxFixoNum = parseFloatBR(fxFixo) || fxEstNum
  const nParcNum = Math.max(1, parseInt(parcelamento) || 1)
  const fxAtual = moeda === 'BRL' ? 1 : fxRule === 'fixo' ? fxFixoNum : fxEstNum
  const totalBrl = valorNum * fxAtual
  const valorBrlEst = valorNum * fxEstNum
  const valorBrlFixo = valorNum * fxFixoNum
  const parcMoeda = valorNum / nParcNum
  const parcBrl = parcMoeda * fxAtual

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

    setSalvando(true)
    try {
      const body = {
        processoId,
        tipo: TIPO_TO_ENUM[tipo],
        categoria: CAT_TO_ENUM[categoria],
        descricao: descricao.trim(),
        fornecedor: fornecedor.trim() || null,
        moeda,
        valor: valorNum,
        fxEstimado: moeda === 'BRL' ? 1 : fxEstNum,
        fxRule: moeda === 'BRL' ? 'FIXO' : fxRule.toUpperCase(),
        fxFixo: fxRule === 'fixo' && moeda !== 'BRL' ? fxFixoNum : null,
        fxData: fxRule === 'fixo' && moeda !== 'BRL' ? fxData : null,
        nParcelas: nParcNum,
        vencimento,
        custoOperacional: operacional,
        // Vínculo (só quando NÃO é operacional)
        vinculoCategoria: operacional ? null : vincCategoria,
        vinculoPercentual: operacional ? null : Math.max(0, Math.min(100, parseInt(vincPct) || 100)),
        formaPagamento: FORMA_TO_ENUM[forma],
      }
      const res = await fetch('/api/financeiro/custos', {
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
          `Erro ${res.status}: falha ao criar custo.`
        setErro(msg)
        return
      }
      const novoCusto = await res.json()
      onCriado(novoCusto)
    } catch (err) {
      console.error('[NovoCustoPagina] submit erro:', err)
      setErro('Erro de conexão. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="fpag-page">
      <div className="breadcrumb">
        <a onClick={onVoltar}>Financeiro</a>
        <span className="breadcrumb-sep">›</span>
        <a onClick={onVoltar}>Custos</a>
        <span className="breadcrumb-sep">›</span>
        <span>Novo Custo</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Novo Custo</h1>
          <div className="page-subtitle">
            Cadastre um novo custo ou despesa do processo
          </div>
        </div>
        <button type="button" className="btn-outline" onClick={onVoltar}>
          ← Voltar para Custos
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
            {/* === Vínculo do Custo === */}
            <div className="form-card">
              <div className="form-card-title">Vínculo do Custo</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    cursor: 'pointer',
                    fontSize: 14,
                    color: 'var(--fpag-gray-700)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={operacional}
                    onChange={(e) => setOperacional(e.target.checked)}
                    style={{
                      width: 16,
                      height: 16,
                      cursor: 'pointer',
                      accentColor: 'var(--fpag-primary)',
                    }}
                  />
                  <span>
                    <strong>Custo operacional</strong>{' '}
                    <span style={{ color: 'var(--fpag-gray-500)' }}>
                      (não vinculado a uma receita específica)
                    </span>
                  </span>
                </label>

                {!operacional && (
                  <div
                    style={{
                      display: 'flex',
                      gap: 14,
                      background: 'var(--fpag-gray-50)',
                      padding: 14,
                      borderRadius: 8,
                      border: '1px solid var(--fpag-gray-100)',
                    }}
                  >
                    <div className="form-field" style={{ flex: 2 }}>
                      <label className="form-label">Categoria de receita vinculada</label>
                      <select
                        className="form-select"
                        value={vincCategoria}
                        onChange={(e) =>
                          setVincCategoria(e.target.value as 'Honorários' | 'Reembolso' | 'Outros')
                        }
                      >
                        <option>Honorários</option>
                        <option>Reembolso</option>
                        <option>Outros</option>
                      </select>
                    </div>
                    <div className="form-field" style={{ flex: 1 }}>
                      <label className="form-label">% vinculado</label>
                      <input
                        type="number"
                        className="form-input"
                        value={vincPct}
                        min={0}
                        max={100}
                        onChange={(e) => setVincPct(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--fpag-gray-600)',
                    lineHeight: 1.5,
                    background: '#fef3c7',
                    padding: '10px 12px',
                    borderRadius: 8,
                    borderLeft: '3px solid var(--fpag-warning)',
                  }}
                >
                  ℹ <strong>Custo vinculado:</strong> abate proporcionalmente o lucro daquela
                  categoria de receita.
                  <br />
                  <strong>Custo operacional:</strong> conta como custo geral do processo (não
                  vincula a receita específica).
                </div>
              </div>
            </div>

            {/* === 1. Dados === */}
            <div className="form-card">
              <div className="form-card-title">1. Dados do Custo</div>
              <div className="form-grid-3">
                <div className="form-field">
                  <label className="form-label">Tipo de custo</label>
                  <select
                    className="form-select"
                    value={tipo}
                    onChange={(e) => setTipo(e.target.value as TipoLabel)}
                  >
                    <option>Serviço</option>
                    <option>Imposto</option>
                    <option>Documento</option>
                    <option>Despesa</option>
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label">Categoria</label>
                  <select
                    className="form-select"
                    value={categoria}
                    onChange={(e) => setCategoria(e.target.value as CategoriaLabel)}
                  >
                    <option>Traduções e juramentações</option>
                    <option>Apostilamentos</option>
                    <option>Honorários do escritório</option>
                    <option>Taxas consulares</option>
                    <option>Outros</option>
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label">Descrição</label>
                  <input
                    className="form-input"
                    value={descricao}
                    onChange={(e) => setDescricao(e.target.value)}
                    placeholder="Ex.: Tradução juramentada de documentos"
                  />
                </div>
              </div>

              <div className="form-grid-4" style={{ marginTop: 14 }}>
                <div className="form-field">
                  <label className="form-label">Fornecedor</label>
                  <input
                    className="form-input"
                    value={fornecedor}
                    onChange={(e) => setFornecedor(e.target.value)}
                    placeholder="Ex.: Tradux Juramentadas"
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">Data do custo</label>
                  <input
                    className="form-input"
                    type="date"
                    value={dataCusto}
                    onChange={(e) => setDataCusto(e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">Moeda base do custo</label>
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
              </div>

              <div className="form-grid" style={{ marginTop: 14 }}>
                <div className="form-field">
                  <label className="form-label">
                    Câmbio estimado (EUR → BRL){' '}
                    <i className="info-i" title="Câmbio de referência">i</i>
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
                2. Regra de Câmbio <i className="info-i">i</i>
              </div>
              <div className="exchange-rule-cards">
                <div
                  className={`exchange-rule-card ${fxRule === 'fixo' ? 'selected' : ''}`}
                  onClick={() => setFxRule('fixo')}
                >
                  <div className="exchange-rule-card-head">
                    <div className="exchange-rule-radio" />
                    <div className="exchange-rule-card-title">
                      Câmbio fixo para todos os pagamentos
                    </div>
                  </div>
                  <div className="exchange-rule-card-desc">
                    Você define o câmbio agora e todos os pagamentos serão fixos em reais.
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
                      Câmbio variável por pagamento
                    </div>
                  </div>
                  <div className="exchange-rule-card-desc">
                    O câmbio será informado em cada pagamento (baixa).
                  </div>
                  <div className="exchange-rule-body">
                    <div className="fx-var-info">
                      <span>ⓘ</span>
                      <span>
                        O valor em reais será definido no momento de cada pagamento, conforme o
                        câmbio do dia.
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* === 3. Classificação === */}
            <div className="form-card">
              <div className="form-card-title">
                3. Classificação e Condições de Pagamento
              </div>
              <div className="form-grid-4">
                <div className="form-field">
                  <label className="form-label">Situação</label>
                  <select
                    className="form-select"
                    value={situacao}
                    onChange={(e) => setSituacao(e.target.value as 'A pagar' | 'Pago')}
                  >
                    <option>A pagar</option>
                    <option>Pago</option>
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label">Forma de pagamento prevista</label>
                  <select
                    className="form-select"
                    value={forma}
                    onChange={(e) => setForma(e.target.value as FormaLabel)}
                  >
                    <option>Transferência bancária</option>
                    <option>PIX</option>
                    <option>Boleto</option>
                    <option>Cartão</option>
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label">Vencimento</label>
                  <input
                    className="form-input"
                    type="date"
                    value={vencimento}
                    onChange={(e) => setVencimento(e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">Parcelamento</label>
                  <select
                    className="form-select"
                    value={parcelamento}
                    onChange={(e) => setParcelamento(e.target.value)}
                  >
                    <option value="1">À vista (1 parcela)</option>
                    <option value="2">2 parcelas</option>
                    <option value="3">3 parcelas</option>
                    <option value="6">6 parcelas</option>
                    <option value="12">12 parcelas</option>
                  </select>
                </div>
              </div>
              <div className="alert alert-info mb-0" style={{ marginTop: 14 }}>
                <i className="alert-icon">ⓘ</i>
                <span>
                  O custo será pago conforme parcelamento e vencimento informados.
                </span>
              </div>
            </div>

            <div className="actions-bar">
              <button type="button" className="btn-outline" disabled>
                📝 Salvar como rascunho
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={salvando || valorNum <= 0 || !descricao.trim()}
              >
                {salvando ? 'Salvando...' : '✓ Salvar Custo'}
              </button>
            </div>
          </div>

          {/* === Sidebar === */}
          <aside>
            <div className="sidebar-resumo">
              <div className="sidebar-resumo-title">📊 Resumo do Custo</div>
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
                <strong>{nParcNum}</strong>
              </div>
              <div className="resumo-row">
                <span>Valor da parcela ({moeda})</span>
                <strong>{fmtMoeda(parcMoeda, moeda)}</strong>
              </div>
              <div className="resumo-row">
                <span>Valor da parcela (BRL)</span>
                <strong className="brl">
                  {fmtBRL(parcBrl)}
                  {moeda !== 'BRL' && fxRule === 'variavel' ? ' (est.)' : ''}
                </strong>
              </div>
              <div className="resumo-row">
                <span>Fornecedor</span>
                <strong>{fornecedor || '—'}</strong>
              </div>
              <div className="resumo-row">
                <span>Categoria</span>
                <strong>{categoria}</strong>
              </div>
              <div className="resumo-row">
                <span>Tipo de custo</span>
                <strong>{tipo}</strong>
              </div>
              <div className="resumo-row">
                <span>Vínculo</span>
                <strong>
                  {operacional
                    ? 'Operacional'
                    : `${vincCategoria} (${parseInt(vincPct) || 0}%)`}
                </strong>
              </div>
              <div className="resumo-row">
                <span>Regra de câmbio</span>
                <span
                  className={`badge ${fxRule === 'fixo' ? 'badge-fx-fixo' : 'badge-fx-var'}`}
                >
                  {fxRule === 'fixo' ? 'CÂMBIO FIXO' : 'CÂMBIO VARIÁVEL'}
                </span>
              </div>
              <div className="resumo-row">
                <span>Data de criação</span>
                <strong>{fmtDate(dataCusto)}</strong>
              </div>
            </div>

            <div className="sidebar-resumo">
              <div className="sidebar-resumo-title">📅 Próximo Pagamento Previsto</div>
              <div className="resumo-row">
                <span>Vencimento</span>
                <strong>{fmtDate(vencimento)}</strong>
              </div>
              <div className="resumo-row">
                <span>Valor em EUR</span>
                <strong>{fmtMoeda(parcMoeda, moeda)}</strong>
              </div>
              <div className="resumo-row">
                <span>Valor em BRL</span>
                <strong className="brl">{fmtBRL(parcBrl)}</strong>
              </div>
            </div>
          </aside>
        </div>
      </form>
    </div>
  )
}

export default NovoCustoPagina
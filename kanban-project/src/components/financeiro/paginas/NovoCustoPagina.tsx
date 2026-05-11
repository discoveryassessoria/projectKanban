// src/components/financeiro/paginas/NovoCustoPagina.tsx
//
// 🆕 Fase 3 v4 — Clone FIEL da #page-novo-custo do html_final_marco.html.
//
// Mudanças vs. v3:
//   - Aceita prop `custoInicial` (opcional). Quando presente, a tela vira
//     "Editar Rascunho": preenche todos os campos com os dados do rascunho,
//     muda o título/breadcrumb e troca o método do submit pra PATCH.
//   - Botão "Salvar como rascunho" agora é funcional (envia status: 'RASCUNHO',
//     validação relaxada — só descrição é obrigatória).
//   - Fix do BRL (mesmo do Receita): em vez de mandar null em fxFixo/fxData
//     quando moeda === 'BRL', manda valores neutros (1 e vencimento). Isso
//     evita que o Zod rejeite os campos como inválidos.
//   - PATCH manda só campos simples (sem processoId). O handler atual em
//     /api/financeiro/custos/[id] usa prisma.custo.update direto com o body.
//
// ⚠️ Premissa: CriarCustoSchema e EditarCustoSchema em lib/financeiro/validacao.ts
// aceitam o campo `status` (paralelo ao Receita). Se não aceitarem, o backend
// vai ignorar silenciosamente e o rascunho não funciona.

'use client'

import { useState } from 'react'

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

type VincCategoriaLabel = 'Honorários' | 'Reembolso' | 'Outros'

const TIPO_TO_ENUM: Record<TipoLabel, string> = {
  'Serviço': 'SERVICO',
  'Imposto': 'IMPOSTO',
  'Documento': 'DOCUMENTO',
  'Despesa': 'DESPESA',
}
const ENUM_TO_TIPO: Record<string, TipoLabel> = {
  SERVICO: 'Serviço',
  IMPOSTO: 'Imposto',
  DOCUMENTO: 'Documento',
  DESPESA: 'Despesa',
}

const CAT_TO_ENUM: Record<CategoriaLabel, string> = {
  'Traduções e juramentações': 'TRADUCOES_JURAMENTACOES',
  'Apostilamentos': 'APOSTILAMENTOS',
  'Honorários do escritório': 'HONORARIOS_ESCRITORIO',
  'Taxas consulares': 'TAXAS_CONSULARES',
  'Outros': 'OUTROS',
}
const ENUM_TO_CAT: Record<string, CategoriaLabel> = {
  TRADUCOES_JURAMENTACOES: 'Traduções e juramentações',
  APOSTILAMENTOS: 'Apostilamentos',
  HONORARIOS_ESCRITORIO: 'Honorários do escritório',
  TAXAS_CONSULARES: 'Taxas consulares',
  OUTROS: 'Outros',
}

const FORMA_TO_ENUM: Record<FormaLabel, string> = {
  'Transferência bancária': 'TRANSFERENCIA',
  'PIX': 'PIX',
  'Boleto': 'BOLETO',
  'Cartão': 'CARTAO_CREDITO',
}
const ENUM_TO_FORMA: Record<string, FormaLabel> = {
  TRANSFERENCIA: 'Transferência bancária',
  PIX: 'PIX',
  BOLETO: 'Boleto',
  CARTAO_CREDITO: 'Cartão',
}

// Mapeamento PT-BR → CategoriaReceitaEnum (backend)
// Obs.: Pasta Documental NÃO entra como vínculo (decisão Marco 30/04).
const VINC_CAT_TO_ENUM: Record<VincCategoriaLabel, string> = {
  'Honorários': 'HONORARIOS',
  'Reembolso': 'REEMBOLSO',
  'Outros': 'OUTROS',
}
const ENUM_TO_VINC_CAT: Record<string, VincCategoriaLabel> = {
  HONORARIOS: 'Honorários',
  REEMBOLSO: 'Reembolso',
  OUTROS: 'Outros',
}

// 🆕 Tipo do custo existente passado pra edição (estrutura permissiva)
export interface CustoInicial {
  id: number
  tipo: string
  categoria: string
  descricao: string
  fornecedor?: string | null
  moeda: Moeda
  valor: number | string
  fxEstimado: number | string
  fxRule: 'FIXO' | 'VARIAVEL'
  fxFixo?: number | string | null
  fxData?: string | null
  nParcelas: number
  vencimento: string
  custoOperacional?: boolean
  categoriaVinculada?: string | null
  percentualVinculado?: number | null
  formaPagamento?: string | null
  status?: string
}

export interface NovoCustoPaginaProps {
  processoId: number
  fxHoje: number
  custoInicial?: CustoInicial | null
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
function toNumber(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'number') return isFinite(v) ? v : 0
  const s = String(v).replace(',', '.')
  const n = parseFloat(s)
  return isFinite(n) ? n : 0
}
function toStringBR(v: number, decimals = 2): string {
  return v.toFixed(decimals).replace('.', ',')
}
function dateOnly(iso?: string | null): string {
  if (!iso) return todayISO()
  return String(iso).slice(0, 10)
}

// ============================================================================
// Componente
// ============================================================================

export function NovoCustoPagina({
  processoId,
  fxHoje,
  custoInicial,
  onVoltar,
  onCriado,
}: NovoCustoPaginaProps) {
  const isEdicao = !!custoInicial
  const ini = custoInicial

  // ---- Form (states com fallback ao `ini` se for edição) ----
  const [tipo, setTipo] = useState<TipoLabel>(() => {
    if (!ini) return 'Serviço'
    return ENUM_TO_TIPO[ini.tipo] || 'Serviço'
  })
  const [categoria, setCategoria] = useState<CategoriaLabel>(() => {
    if (!ini) return 'Traduções e juramentações'
    return ENUM_TO_CAT[ini.categoria] || 'Traduções e juramentações'
  })
  const [descricao, setDescricao] = useState(() => ini?.descricao || '')
  const [fornecedor, setFornecedor] = useState(() => ini?.fornecedor || '')
  const [dataCusto, setDataCusto] = useState(todayISO())
  const [moeda, setMoeda] = useState<Moeda>(() => ini?.moeda || 'EUR')
  const [valor, setValor] = useState(() => {
    if (!ini) return ''
    const v = toNumber(ini.valor)
    return v > 0 ? toStringBR(v) : ''
  })
  const [fxEst, setFxEst] = useState(() => {
    const v = toNumber(ini?.fxEstimado) || fxHoje
    return toStringBR(v)
  })
  const [fxRule, setFxRule] = useState<FxRule>(() => {
    if (!ini) return 'fixo'
    return ini.fxRule === 'VARIAVEL' ? 'variavel' : 'fixo'
  })
  const [fxFixo, setFxFixo] = useState(() => {
    const v = toNumber(ini?.fxFixo) || toNumber(ini?.fxEstimado) || fxHoje
    return toStringBR(v)
  })
  const [fxData, setFxData] = useState(() => dateOnly(ini?.fxData))
  const [situacao, setSituacao] = useState<'A pagar' | 'Pago'>('A pagar')
  const [forma, setForma] = useState<FormaLabel>(() => {
    if (!ini?.formaPagamento) return 'Transferência bancária'
    return ENUM_TO_FORMA[ini.formaPagamento] || 'Transferência bancária'
  })
  const [vencimento, setVencimento] = useState(() => dateOnly(ini?.vencimento))
  const [parcelamento, setParcelamento] = useState(() => String(ini?.nParcelas || 1))

  // Vínculo do Custo
  const [operacional, setOperacional] = useState(() => !!ini?.custoOperacional)
  const [vincCategoria, setVincCategoria] = useState<VincCategoriaLabel>(() => {
    if (!ini?.categoriaVinculada) return 'Honorários'
    return ENUM_TO_VINC_CAT[ini.categoriaVinculada] || 'Honorários'
  })
  const [vincPct, setVincPct] = useState(() => {
    const v = ini?.percentualVinculado
    if (v == null) return '100'
    return String(v)
  })

  const [salvando, setSalvando] = useState(false)
  const [salvandoRascunho, setSalvandoRascunho] = useState(false)
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
  async function handleSubmit(
    e: React.FormEvent | React.MouseEvent,
    asRascunho: boolean = false,
  ) {
    e.preventDefault()
    setErro(null)

    if (!descricao.trim()) {
      setErro('Descrição obrigatória.')
      return
    }

    if (!asRascunho) {
      if (valorNum <= 0) {
        setErro('Valor deve ser maior que zero.')
        return
      }
    }

    if (asRascunho) setSalvandoRascunho(true)
    else setSalvando(true)

    try {
      // Campos comuns aos dois fluxos (POST cria / PATCH edita)
      const commonBody = {
        tipo: TIPO_TO_ENUM[tipo],
        categoria: CAT_TO_ENUM[categoria],
        descricao: descricao.trim(),
        fornecedor: fornecedor.trim() || null,
        moeda,
        valor: valorNum,
        fxEstimado: moeda === 'BRL' ? 1 : fxEstNum,
        fxRule: moeda === 'BRL' ? 'FIXO' : fxRule.toUpperCase(),
        // Fix do BRL (mesmo do Receita): valores neutros em vez de null
        fxFixo: moeda === 'BRL' ? 1 : fxRule === 'fixo' ? fxFixoNum : 1,
        fxData: moeda === 'BRL' ? vencimento : fxRule === 'fixo' ? fxData : vencimento,
        nParcelas: nParcNum,
        vencimento,
        custoOperacional: operacional,
        // Vínculo (só quando NÃO é operacional)
        categoriaVinculada: operacional ? null : VINC_CAT_TO_ENUM[vincCategoria],
        percentualVinculado: operacional
          ? null
          : Math.max(0, Math.min(100, parseInt(vincPct) || 100)),
        formaPagamento: FORMA_TO_ENUM[forma],
        status: asRascunho ? 'RASCUNHO' : 'ATIVA',
      }

      // POST inclui processoId; PATCH só campos simples
      const body = isEdicao ? commonBody : { ...commonBody, processoId }

      const url = isEdicao
        ? `/api/financeiro/custos/${ini!.id}`
        : '/api/financeiro/custos'
      const method = isEdicao ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
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
          `Erro ${res.status}: falha ao ${asRascunho ? 'salvar rascunho' : isEdicao ? 'atualizar custo' : 'criar custo'}.`
        setErro(msg)
        return
      }
      const custoResp = await res.json()
      onCriado(custoResp)
    } catch (err) {
      console.error('[NovoCustoPagina] submit erro:', err)
      setErro('Erro de conexão. Tente novamente.')
    } finally {
      setSalvando(false)
      setSalvandoRascunho(false)
    }
  }

  const algumSalvando = salvando || salvandoRascunho

  // Labels dinâmicos pra modo edição
  const tituloPagina = isEdicao ? 'Editar Rascunho' : 'Novo Custo'
  const subtituloPagina = isEdicao
    ? 'Edite os dados do rascunho. Salve novamente como rascunho ou finalize como custo.'
    : 'Cadastre um novo custo ou despesa do processo'
  const labelBtnPrincipal = isEdicao ? '✓ Salvar como Custo' : '✓ Salvar Custo'
  const labelBtnPrincipalSalvando = 'Salvando...'

  return (
    <div className="fpag-page">
      <div className="breadcrumb">
        <a onClick={onVoltar}>Financeiro</a>
        <span className="breadcrumb-sep">›</span>
        <a onClick={onVoltar}>Custos</a>
        <span className="breadcrumb-sep">›</span>
        <span>{tituloPagina}</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{tituloPagina}</h1>
          <div className="page-subtitle">{subtituloPagina}</div>
        </div>
        <button type="button" className="btn-outline" onClick={onVoltar}>
          ← Voltar para Custos
        </button>
      </div>

      {isEdicao && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          <i className="alert-icon">ⓘ</i>
          <span>
            <strong>Editando rascunho.</strong> Você pode alterar qualquer campo e
            salvar de novo como rascunho ou finalizar como custo ativo.
          </span>
        </div>
      )}

      {erro && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          <i className="alert-icon">⚠</i>
          <span>{erro}</span>
        </div>
      )}

      <form onSubmit={(e) => handleSubmit(e, false)}>
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
                          setVincCategoria(e.target.value as VincCategoriaLabel)
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
                  <select
                    className="form-select"
                    value={moeda}
                    onChange={(e) => setMoeda(e.target.value as Moeda)}
                  >
                    <option value="EUR">EUR — Euro (€)</option>
                    <option value="BRL">BRL — Real (R$)</option>
                    <option value="USD">USD — Dólar (US$)</option>
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label">Valor total em {moeda}</label>
                  <input
                    className="form-input"
                    type="text"
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                    placeholder={`${moedaSimbolo(moeda)} 0,00`}
                  />
                </div>
              </div>

              {moeda !== 'BRL' && (
                <div className="form-grid" style={{ marginTop: 14 }}>
                  <div className="form-field">
                    <label className="form-label">
                      Câmbio estimado ({moeda} → BRL){' '}
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
              )}
            </div>

            {/* === 2. Regra de Câmbio (só faz sentido se moeda !== BRL) === */}
            {moeda !== 'BRL' && (
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
                          <label className="form-label">Câmbio fixado ({moeda} → BRL)</label>
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
            )}

            {/* === 3. Classificação === */}
            <div className="form-card">
              <div className="form-card-title">
                {moeda === 'BRL' ? '2' : '3'}. Classificação e Condições de Pagamento
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
              <button
                type="button"
                className="btn-outline"
                onClick={(e) => handleSubmit(e, true)}
                disabled={algumSalvando || !descricao.trim()}
              >
                {salvandoRascunho ? 'Salvando...' : '📝 Salvar como rascunho'}
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={algumSalvando || valorNum <= 0 || !descricao.trim()}
              >
                {salvando ? labelBtnPrincipalSalvando : labelBtnPrincipal}
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
              {moeda !== 'BRL' && (
                <div className="resumo-row">
                  <span>
                    {fxRule === 'fixo'
                      ? 'Valor total em BRL (fixo)'
                      : 'Valor total em BRL (estimado)'}
                  </span>
                  <strong className="brl">
                    {fmtBRL(totalBrl)}
                    {fxRule === 'variavel' ? ' (est.)' : ''}
                  </strong>
                </div>
              )}
              <div className="resumo-row">
                <span>Número de parcelas</span>
                <strong>{nParcNum}</strong>
              </div>
              <div className="resumo-row">
                <span>Valor da parcela ({moeda})</span>
                <strong>{fmtMoeda(parcMoeda, moeda)}</strong>
              </div>
              {moeda !== 'BRL' && (
                <div className="resumo-row">
                  <span>Valor da parcela (BRL)</span>
                  <strong className="brl">
                    {fmtBRL(parcBrl)}
                    {fxRule === 'variavel' ? ' (est.)' : ''}
                  </strong>
                </div>
              )}
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
              {moeda !== 'BRL' && (
                <div className="resumo-row">
                  <span>Regra de câmbio</span>
                  <span
                    className={`badge ${fxRule === 'fixo' ? 'badge-fx-fixo' : 'badge-fx-var'}`}
                  >
                    {fxRule === 'fixo' ? 'CÂMBIO FIXO' : 'CÂMBIO VARIÁVEL'}
                  </span>
                </div>
              )}
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
                <span>Valor em {moeda}</span>
                <strong>{fmtMoeda(parcMoeda, moeda)}</strong>
              </div>
              {moeda !== 'BRL' && (
                <div className="resumo-row">
                  <span>Valor em BRL</span>
                  <strong className="brl">{fmtBRL(parcBrl)}</strong>
                </div>
              )}
            </div>
          </aside>
        </div>
      </form>
    </div>
  )
}

export default NovoCustoPagina
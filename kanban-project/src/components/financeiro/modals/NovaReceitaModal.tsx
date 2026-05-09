// src/components/financeiro/modals/NovaReceitaModal.tsx
//
// 🆕 Fase 3 — Criação de Receita (modelo novo do schema reformado).
//
// Replica visual e funcionalmente a página #page-nova-receita do
// html_final_marco.html, adaptada para um modal dentro do
// ProcessoFinanceiro. Layout 2 colunas (form + sidebar de resumo).
//
// Endpoints:
//   - GET  /api/processos/:id           → tenta carregar requerentes
//   - POST /api/financeiro/receitas     → cria Receita + parcelas + requerentes
//
// Decisões alinhadas com o schema:
//   - Parcelas são por período (não por requerente). O split é
//     reconstruído na UI a partir de ReceitaRequerente.percentual.
//   - "Forma de pagamento" no HTML (Parcelado/À vista) é apenas UX —
//     controla nParcelas. Não é enviado ao back.
//   - Mapeia "Honorários/Reembolso/Outros" → enum CategoriaReceita.

'use client'

import { useState, useEffect, useMemo } from 'react'
import { X, Save, AlertCircle, Info, Check } from 'lucide-react'

// ============================================================================
// Tipos
// ============================================================================

type Moeda = 'BRL' | 'EUR' | 'USD'
type FxRule = 'FIXO' | 'VARIAVEL'
type Categoria = 'HONORARIOS' | 'REEMBOLSO' | 'OUTROS'
type Divisao = 'igual' | 'personalizada'

interface RequerenteAPI {
  id: number
  nome: string
  idade?: number | null
  dataNascimento?: string | null
}

interface ReqState {
  /** FK pra Requerente real (quando vem da API) */
  requerenteId: number | null
  idx: number
  nome: string
  idade: number | null
  isAdulto: boolean
  participa: boolean
  percentual: number
}

export interface NovaReceitaModalProps {
  processoId: number
  isOpen: boolean
  onClose: () => void
  onSuccess: (receita: unknown) => void
}

// ============================================================================
// Constantes
// ============================================================================

const FX_HOJE_FALLBACK = 5.5

const CATEGORIAS: { value: Categoria; label: string }[] = [
  { value: 'HONORARIOS', label: 'Honorários' },
  { value: 'REEMBOLSO', label: 'Reembolso' },
  { value: 'OUTROS', label: 'Outros' },
]

// ============================================================================
// Helpers
// ============================================================================

function parseFloatBR(s: string): number {
  if (!s) return 0
  const limpo = s.toString().replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  const n = parseFloat(limpo)
  return isFinite(n) ? n : 0
}

function fmtBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtMoeda(v: number, moeda: Moeda): string {
  const code = moeda === 'BRL' ? 'BRL' : moeda
  return v.toLocaleString('pt-BR', { style: 'currency', currency: code })
}

function moedaSimbolo(m: Moeda): string {
  return m === 'BRL' ? 'R$' : m === 'EUR' ? '€' : 'US$'
}

function fmtFX(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—'
  return v.toFixed(4).replace('.', ',')
}

function fmtDateBR(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR')
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function addMonthsISO(iso: string, n: number): string {
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

export function NovaReceitaModal({
  processoId,
  isOpen,
  onClose,
  onSuccess,
}: NovaReceitaModalProps) {
  // ---- Form state ----
  const [categoria, setCategoria] = useState<Categoria>('HONORARIOS')
  const [descricao, setDescricao] = useState('')
  const [moeda, setMoeda] = useState<Moeda>('EUR')
  const [valor, setValor] = useState('')
  const [fxEst, setFxEst] = useState(FX_HOJE_FALLBACK.toFixed(2).replace('.', ','))
  const [fxRule, setFxRule] = useState<FxRule>('FIXO')
  const [fxFixo, setFxFixo] = useState(FX_HOJE_FALLBACK.toFixed(2).replace('.', ','))
  const [fxData, setFxData] = useState(todayISO())
  const [forma, setForma] = useState<'Parcelado' | 'À vista'>('Parcelado')
  const [nParc, setNParc] = useState('10')
  const [data1, setData1] = useState(todayISO())
  const [requerentes, setRequerentes] = useState<ReqState[]>([])
  const [divisao, setDivisao] = useState<Divisao>('igual')
  const [observacoes, setObservacoes] = useState('')

  // ---- UI state ----
  const [loadingReq, setLoadingReq] = useState(false)
  const [erroReq, setErroReq] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // ---- Reset ao abrir ----
  useEffect(() => {
    if (!isOpen) return
    setCategoria('HONORARIOS')
    setDescricao('')
    setMoeda('EUR')
    setValor('')
    setFxEst(FX_HOJE_FALLBACK.toFixed(2).replace('.', ','))
    setFxRule('FIXO')
    setFxFixo(FX_HOJE_FALLBACK.toFixed(2).replace('.', ','))
    setFxData(todayISO())
    setForma('Parcelado')
    setNParc('10')
    setData1(todayISO())
    setDivisao('igual')
    setObservacoes('')
    setErro(null)
    setErroReq(null)
  }, [isOpen])

  // ---- Carregar requerentes do processo ----
  useEffect(() => {
    if (!isOpen) return
    let cancelado = false
    async function carregar() {
      setLoadingReq(true)
      setErroReq(null)
      try {
        const res = await fetch(`/api/processos/${processoId}`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
          },
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
          setErroReq(
            `Não foi possível carregar requerentes (HTTP ${res.status}). Adicione manualmente abaixo.`,
          )
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
        const adultos = reqs.filter((r) => r.isAdulto && r.participa).length
        if (adultos > 0) {
          const cada = 100 / adultos
          reqs.forEach((r) => {
            r.percentual = r.isAdulto && r.participa ? cada : 0
          })
        }
        if (!cancelado) setRequerentes(reqs)
      } catch (err) {
        console.error('[NovaReceitaModal] erro requerentes:', err)
        if (!cancelado) {
          setErroReq('Erro ao carregar requerentes. Adicione manualmente abaixo.')
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
  }, [isOpen, processoId])

  // ---- "Forma de pagamento" controla nParcelas ----
  useEffect(() => {
    if (forma === 'À vista') setNParc('1')
  }, [forma])

  // ---- Computed ----
  const valorNum = parseFloatBR(valor)
  const fxEstNum = parseFloatBR(fxEst) || FX_HOJE_FALLBACK
  const fxFixoNum = parseFloatBR(fxFixo) || fxEstNum
  const nParcNum = Math.max(1, parseInt(nParc) || 1)
  const fxAtual = moeda === 'BRL' ? 1 : fxRule === 'FIXO' ? fxFixoNum : fxEstNum
  const totalBrl = valorNum * fxAtual
  const parcEur = valorNum / nParcNum
  const parcBrl = parcEur * fxAtual

  const participantes = useMemo(
    () => requerentes.filter((r) => r.participa && r.percentual > 0),
    [requerentes],
  )
  const adultosParticipam = requerentes.filter((r) => r.participa).length

  const somaPct = useMemo(
    () => requerentes.filter((r) => r.participa).reduce((s, r) => s + r.percentual, 0),
    [requerentes],
  )
  const somaOk = Math.abs(somaPct - 100) < 0.01

  // ---- Handlers de divisão ----
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

  function toggleParticipa(idx: number, checked: boolean) {
    setRequerentes((prev) => {
      const novo = prev.map((r) =>
        r.idx === idx
          ? { ...r, participa: checked, percentual: checked ? r.percentual : 0 }
          : r,
      )
      // Após toggle, redistribui igual entre os que participam
      const partic = novo.filter((r) => r.participa)
      if (partic.length === 0) return novo
      const cada = 100 / partic.length
      return novo.map((r) => (r.participa ? { ...r, percentual: cada } : r))
    })
  }

  function setPercentual(idx: number, novoPct: number) {
    if (divisao !== 'personalizada') return
    setRequerentes((prev) => {
      const r = prev.find((x) => x.idx === idx)
      if (!r || !r.participa) return prev
      const pctClamp = Math.max(0, Math.min(100, novoPct))
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

  function setValorReq(idx: number, novoVal: number) {
    if (divisao !== 'personalizada') return
    if (valorNum <= 0) return
    const novoPct = (novoVal / valorNum) * 100
    setPercentual(idx, novoPct)
  }

  // ---- Adicionar requerente manual (fallback quando API falha) ----
  function addManualReq() {
    setRequerentes((prev) => {
      const proxIdx = prev.length === 0 ? 0 : Math.max(...prev.map((r) => r.idx)) + 1
      const novo: ReqState = {
        requerenteId: null,
        idx: proxIdx,
        nome: `Requerente ${proxIdx + 1}`,
        idade: null,
        isAdulto: true,
        participa: true,
        percentual: 0,
      }
      const lista = [...prev, novo]
      const partic = lista.filter((r) => r.participa)
      const cada = 100 / partic.length
      return lista.map((r) => (r.participa ? { ...r, percentual: cada } : r))
    })
  }

  function setNomeManual(idx: number, nome: string) {
    setRequerentes((prev) => prev.map((r) => (r.idx === idx ? { ...r, nome } : r)))
  }

  function removeManualReq(idx: number) {
    setRequerentes((prev) => {
      const lista = prev.filter((r) => r.idx !== idx)
      const partic = lista.filter((r) => r.participa)
      if (partic.length > 0) {
        const cada = 100 / partic.length
        return lista.map((r) => (r.participa ? { ...r, percentual: cada } : r))
      }
      return lista
    })
  }

  // ---- Submit ----
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)

    if (!descricao.trim()) {
      setErro('Descrição é obrigatória.')
      return
    }
    if (valorNum <= 0) {
      setErro('Valor deve ser maior que zero.')
      return
    }
    if (participantes.length === 0) {
      setErro('Selecione ao menos um requerente com percentual maior que zero.')
      return
    }
    if (!somaOk) {
      setErro(`Soma dos percentuais deve ser 100%. Atual: ${somaPct.toFixed(2)}%.`)
      return
    }
    if (fxRule === 'FIXO' && moeda !== 'BRL' && fxFixoNum <= 0) {
      setErro('Câmbio fixo é obrigatório quando regra = Fixo.')
      return
    }

    setSalvando(true)
    try {
      const body = {
        processoId,
        categoria,
        descricao: descricao.trim(),
        moeda,
        valor: valorNum,
        fxEstimado: moeda === 'BRL' ? 1 : fxEstNum,
        fxRule: moeda === 'BRL' ? 'FIXO' : fxRule,
        fxFixo: fxRule === 'FIXO' && moeda !== 'BRL' ? fxFixoNum : null,
        fxData: fxRule === 'FIXO' && moeda !== 'BRL' ? fxData : null,
        nParcelas: nParcNum,
        data1,
        periodicidade: 'Mensal',
        observacoes: observacoes.trim() || null,
        requerentes: participantes.map((r) => ({
          idx: r.idx,
          nome: r.nome,
          idade: r.idade,
          statusFamiliar: r.isAdulto ? ('Adulto' as const) : ('Menor' as const),
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
      onSuccess(novaReceita)
      onClose()
    } catch (err) {
      console.error('[NovaReceitaModal] erro submit:', err)
      setErro('Erro de conexão. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  if (!isOpen) return null

  // ---- Render ----
  return (
    <div className="nr-overlay" onClick={onClose}>
      <div
        className="nr-box"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Nova Receita"
      >
        {/* HEADER */}
        <div className="nr-header">
          <div>
            <h2 className="nr-title">+ Nova Receita</h2>
            <div className="nr-subtitle">Cadastre uma nova receita para este processo</div>
          </div>
          <button type="button" className="nr-close" onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="nr-body">
          {erro && (
            <div className="nr-erro-geral">
              <AlertCircle className="nr-erro-icon" />
              <span>{erro}</span>
            </div>
          )}

          <div className="nr-grid">
            {/* ============ COLUNA PRINCIPAL ============ */}
            <div className="nr-main">
              {/* === 1. Dados === */}
              <section className="nr-card">
                <h3 className="nr-card-title">1. Dados da Receita</h3>
                <div className="nr-row-3">
                  <div className="nr-field">
                    <label>Tipo de Receita</label>
                    <select
                      value={categoria}
                      onChange={(e) => setCategoria(e.target.value as Categoria)}
                    >
                      {CATEGORIAS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="nr-field nr-field--span2">
                    <label>Descrição *</label>
                    <input
                      type="text"
                      value={descricao}
                      onChange={(e) => setDescricao(e.target.value)}
                      placeholder="Ex.: Honorários advocatícios"
                    />
                  </div>
                </div>

                <div className="nr-row-4">
                  <div className="nr-field">
                    <label>Moeda</label>
                    <select value={moeda} onChange={(e) => setMoeda(e.target.value as Moeda)}>
                      <option value="EUR">EUR — Euro (€)</option>
                      <option value="BRL">BRL — Real (R$)</option>
                      <option value="USD">USD — Dólar (US$)</option>
                    </select>
                  </div>
                  <div className="nr-field">
                    <label>Valor total ({moedaSimbolo(moeda)}) *</label>
                    <input
                      type="text"
                      value={valor}
                      onChange={(e) => setValor(e.target.value)}
                      placeholder="0,00"
                    />
                  </div>
                  {moeda !== 'BRL' && (
                    <>
                      <div className="nr-field">
                        <label>Câmbio estimado ({moeda} → BRL)</label>
                        <input
                          type="text"
                          value={fxEst}
                          onChange={(e) => setFxEst(e.target.value)}
                        />
                      </div>
                      <div className="nr-field">
                        <label>Valor estimado em BRL</label>
                        <input
                          type="text"
                          value={fmtBRL(valorNum * fxEstNum)}
                          readOnly
                          className="nr-readonly"
                        />
                      </div>
                    </>
                  )}
                </div>
              </section>

              {/* === 2. Regra de Câmbio === */}
              {moeda !== 'BRL' && (
                <section className="nr-card">
                  <h3 className="nr-card-title">2. Regra de Câmbio</h3>
                  <div className="nr-fxcards">
                    <div
                      className={`nr-fxcard ${fxRule === 'FIXO' ? 'selected' : ''}`}
                      onClick={() => setFxRule('FIXO')}
                    >
                      <div className="nr-fxcard-head">
                        <div className="nr-radio" data-on={fxRule === 'FIXO'} />
                        <strong>Câmbio fixo para todas as parcelas</strong>
                      </div>
                      <p>Você define o câmbio agora e todas as parcelas ficam fixas em reais.</p>
                      {fxRule === 'FIXO' && (
                        <div className="nr-fxcard-body" onClick={(e) => e.stopPropagation()}>
                          <div className="nr-row-2">
                            <div className="nr-field">
                              <label>Câmbio fixado</label>
                              <input
                                type="text"
                                value={fxFixo}
                                onChange={(e) => setFxFixo(e.target.value)}
                              />
                            </div>
                            <div className="nr-field">
                              <label>Data da fixação</label>
                              <input
                                type="date"
                                value={fxData}
                                onChange={(e) => setFxData(e.target.value)}
                              />
                            </div>
                          </div>
                          <div className="nr-fxresult">
                            <Check className="nr-fxresult-icon" />
                            <div>
                              <small>Valor total em BRL (fixo)</small>
                              <strong>{fmtBRL(valorNum * fxFixoNum)}</strong>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div
                      className={`nr-fxcard ${fxRule === 'VARIAVEL' ? 'selected' : ''}`}
                      onClick={() => setFxRule('VARIAVEL')}
                    >
                      <div className="nr-fxcard-head">
                        <div className="nr-radio" data-on={fxRule === 'VARIAVEL'} />
                        <strong>Câmbio variável por recebimento</strong>
                      </div>
                      <p>O câmbio será informado em cada recebimento (baixa).</p>
                      {fxRule === 'VARIAVEL' && (
                        <div className="nr-fxcard-body">
                          <div className="nr-fxvar-info">
                            <Info className="nr-fxvar-icon" />
                            <span>
                              O valor em reais será definido no momento de cada recebimento,
                              conforme o câmbio do dia.
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {/* === 3. Condições === */}
              <section className="nr-card">
                <h3 className="nr-card-title">
                  {moeda === 'BRL' ? '2.' : '3.'} Condições de Pagamento
                </h3>
                <div className="nr-row-4">
                  <div className="nr-field">
                    <label>Forma de pagamento</label>
                    <select
                      value={forma}
                      onChange={(e) =>
                        setForma(e.target.value as 'Parcelado' | 'À vista')
                      }
                    >
                      <option value="Parcelado">Parcelado</option>
                      <option value="À vista">À vista</option>
                    </select>
                  </div>
                  <div className="nr-field">
                    <label>Número de parcelas</label>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={nParc}
                      onChange={(e) => setNParc(e.target.value)}
                      disabled={forma === 'À vista'}
                    />
                  </div>
                  <div className="nr-field">
                    <label>Data da 1ª parcela</label>
                    <input
                      type="date"
                      value={data1}
                      onChange={(e) => setData1(e.target.value)}
                    />
                  </div>
                  <div className="nr-field">
                    <label>Periodicidade</label>
                    <select disabled defaultValue="Mensal">
                      <option>Mensal</option>
                    </select>
                  </div>
                </div>
                <div className="nr-alert-info">
                  <Info className="nr-alert-icon" />
                  <span>Todas as parcelas serão geradas automaticamente.</span>
                </div>
              </section>

              {/* === 4. Distribuição === */}
              <section className="nr-card">
                <h3 className="nr-card-title">
                  {moeda === 'BRL' ? '3.' : '4.'} Distribuição entre Requerentes
                </h3>

                <div className="nr-divcards">
                  <div
                    className={`nr-divcard ${divisao === 'igual' ? 'selected' : ''}`}
                    onClick={() => setDivisaoMode('igual')}
                  >
                    <div className="nr-divcard-head">
                      <div className="nr-radio" data-on={divisao === 'igual'} />
                      <strong>Divisão igual</strong>
                    </div>
                    <p>Divide igualmente o valor entre os requerentes participantes.</p>
                  </div>
                  <div
                    className={`nr-divcard ${divisao === 'personalizada' ? 'selected' : ''}`}
                    onClick={() => setDivisaoMode('personalizada')}
                  >
                    <div className="nr-divcard-head">
                      <div className="nr-radio" data-on={divisao === 'personalizada'} />
                      <strong>Divisão personalizada</strong>
                    </div>
                    <p>Define percentuais ou valores específicos para cada requerente.</p>
                  </div>
                </div>

                {erroReq && (
                  <div className="nr-alert-warn">
                    <AlertCircle className="nr-alert-icon" />
                    <span>{erroReq}</span>
                  </div>
                )}

                {loadingReq ? (
                  <div className="nr-loading">Carregando requerentes...</div>
                ) : requerentes.length === 0 ? (
                  <div className="nr-empty">
                    Nenhum requerente carregado.
                    <button
                      type="button"
                      className="nr-btn-link"
                      onClick={addManualReq}
                    >
                      + Adicionar manualmente
                    </button>
                  </div>
                ) : (
                  <>
                    <table className="nr-reqtable">
                      <thead>
                        <tr>
                          <th>REQUERENTE</th>
                          <th>IDADE</th>
                          <th>STATUS</th>
                          <th>%</th>
                          <th>VALOR TOTAL ({moedaSimbolo(moeda)})</th>
                          <th>VALOR/PARCELA ({moedaSimbolo(moeda)})</th>
                          {requerentes.some((r) => r.requerenteId == null) && <th></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {requerentes.map((r) => {
                          const total = (valorNum * r.percentual) / 100
                          const parc = total / nParcNum
                          const isMenor = !r.isAdulto
                          const inputDisabled =
                            divisao === 'igual' || isMenor || !r.participa
                          const cbDisabled = isMenor
                          const naoParticipa = !r.participa
                          let badge: React.ReactNode
                          if (isMenor)
                            badge = <span className="nr-badge nr-badge--neutro">Menor</span>
                          else if (!r.participa)
                            badge = (
                              <span className="nr-badge nr-badge--neutro">Não participa</span>
                            )
                          else
                            badge = <span className="nr-badge nr-badge--ok">Participa</span>
                          return (
                            <tr
                              key={r.idx}
                              style={naoParticipa ? { opacity: 0.45 } : undefined}
                            >
                              <td>
                                <label className="nr-cb-row">
                                  <input
                                    type="checkbox"
                                    checked={r.participa}
                                    disabled={cbDisabled}
                                    onChange={(e) =>
                                      toggleParticipa(r.idx, e.target.checked)
                                    }
                                  />
                                  {r.requerenteId == null ? (
                                    <input
                                      type="text"
                                      className="nr-name-input"
                                      value={r.nome}
                                      onChange={(e) =>
                                        setNomeManual(r.idx, e.target.value)
                                      }
                                    />
                                  ) : (
                                    <span>{r.nome}</span>
                                  )}
                                </label>
                              </td>
                              <td>{r.idade ?? '—'}</td>
                              <td>{badge}</td>
                              <td>
                                <input
                                  type="number"
                                  className="nr-pct-input"
                                  step="0.01"
                                  min={0}
                                  max={100}
                                  value={r.percentual.toFixed(2)}
                                  disabled={inputDisabled}
                                  onChange={(e) =>
                                    setPercentual(r.idx, parseFloat(e.target.value) || 0)
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  type="text"
                                  className="nr-val-input"
                                  value={total.toFixed(2).replace('.', ',')}
                                  disabled={inputDisabled}
                                  onChange={(e) =>
                                    setValorReq(r.idx, parseFloatBR(e.target.value))
                                  }
                                />
                              </td>
                              <td className="nr-cell-num">
                                {naoParticipa ? '—' : fmtMoeda(parc, moeda)}
                              </td>
                              {requerentes.some((x) => x.requerenteId == null) && (
                                <td>
                                  {r.requerenteId == null && (
                                    <button
                                      type="button"
                                      className="nr-row-del"
                                      onClick={() => removeManualReq(r.idx)}
                                      title="Remover"
                                    >
                                      <X />
                                    </button>
                                  )}
                                </td>
                              )}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>

                    {/* Soma dos percentuais */}
                    <div
                      className={`nr-sum ${
                        somaOk
                          ? 'ok'
                          : somaPct < 100
                            ? 'warn'
                            : 'err'
                      }`}
                    >
                      {somaOk
                        ? `✓ Soma: 100,00% — divisão completa (${fmtMoeda(valorNum, moeda)})`
                        : somaPct < 100
                          ? `⚠ Soma: ${somaPct.toFixed(2)}% — faltam ${(100 - somaPct).toFixed(
                              2,
                            )}%`
                          : `⚠ Soma: ${somaPct.toFixed(2)}% — excede em ${(somaPct - 100).toFixed(
                              2,
                            )}%`}
                    </div>

                    {erroReq && (
                      <button
                        type="button"
                        className="nr-btn-link"
                        onClick={addManualReq}
                      >
                        + Adicionar requerente manualmente
                      </button>
                    )}
                  </>
                )}
              </section>

              {/* === Observações === */}
              <section className="nr-card">
                <h3 className="nr-card-title">Observações</h3>
                <textarea
                  className="nr-textarea"
                  rows={3}
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                  placeholder="Opcional"
                />
              </section>
            </div>

            {/* ============ SIDEBAR ============ */}
            <aside className="nr-aside">
              <div className="nr-aside-card">
                <h4 className="nr-aside-title">Resumo da Receita</h4>

                {moeda !== 'BRL' && (
                  <div className={`nr-fxbox nr-fxbox--${fxRule.toLowerCase()}`}>
                    <div className="nr-fxbox-head">
                      <span>📑 Regra de câmbio</span>
                      <span
                        className={`nr-badge ${
                          fxRule === 'FIXO' ? 'nr-badge--fx' : 'nr-badge--fxvar'
                        }`}
                      >
                        {fxRule === 'FIXO' ? 'CÂMBIO FIXO' : 'CÂMBIO VARIÁVEL'}
                      </span>
                    </div>
                    <div className="nr-fxbox-info">
                      {fxRule === 'FIXO' ? (
                        <>
                          Câmbio fixado: {moedaSimbolo(moeda)}1 = {fmtBRL(fxFixoNum)}
                          <br />
                          Data: {fmtDateBR(fxData)}
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
                )}

                <div className="nr-resrow">
                  <span>Valor total ({moedaSimbolo(moeda)})</span>
                  <strong>{fmtMoeda(valorNum, moeda)}</strong>
                </div>
                <div className="nr-resrow">
                  <span>
                    Valor total em BRL{' '}
                    {moeda !== 'BRL' && (fxRule === 'FIXO' ? '(fixo)' : '(estimado)')}
                  </span>
                  <strong className="nr-brl">
                    {fmtBRL(totalBrl)}
                    {moeda !== 'BRL' && fxRule === 'VARIAVEL' && ' (est.)'}
                  </strong>
                </div>
                <div className="nr-resrow">
                  <span>Número de parcelas</span>
                  <strong>{nParcNum}</strong>
                </div>
                <div className="nr-resrow">
                  <span>Valor por parcela ({moedaSimbolo(moeda)})</span>
                  <strong>{fmtMoeda(parcEur, moeda)}</strong>
                </div>
                <div className="nr-resrow">
                  <span>Valor por parcela (BRL)</span>
                  <strong className="nr-brl">
                    {fmtBRL(parcBrl)}
                    {moeda !== 'BRL' && fxRule === 'VARIAVEL' && ' (est.)'}
                  </strong>
                </div>
                <div className="nr-resrow">
                  <span>Requerentes</span>
                  <strong>
                    {adultosParticipam} {adultosParticipam === 1 ? 'participante' : 'participantes'}
                  </strong>
                </div>
                <div className="nr-resrow">
                  <span>Tipo de receita</span>
                  <strong>
                    {CATEGORIAS.find((c) => c.value === categoria)?.label || categoria}
                  </strong>
                </div>
                <div className="nr-resrow">
                  <span>Data da 1ª parcela</span>
                  <strong>{fmtDateBR(data1)}</strong>
                </div>
                <div className="nr-resrow">
                  <span>Última parcela</span>
                  <strong>{fmtDateBR(addMonthsISO(data1, nParcNum - 1))}</strong>
                </div>

                <div className="nr-aside-alert">
                  <strong>Importante</strong>
                  <br />
                  {moeda === 'BRL'
                    ? `${adultosParticipam} participante(s) × ${nParcNum} parcela(s) = ${
                        adultosParticipam * nParcNum
                      } recebimentos individuais.`
                    : fxRule === 'FIXO'
                      ? `Parcelas em reais fixadas pelo câmbio informado. ${adultosParticipam} × ${nParcNum} = ${
                          adultosParticipam * nParcNum
                        } recebimentos.`
                      : `Valores em BRL definidos a cada recebimento. ${adultosParticipam} × ${nParcNum} = ${
                          adultosParticipam * nParcNum
                        } recebimentos.`}
                </div>
              </div>
            </aside>
          </div>

          {/* FOOTER */}
          <div className="nr-footer">
            <button
              type="button"
              className="nr-btn nr-btn--ghost"
              onClick={onClose}
              disabled={salvando}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="nr-btn nr-btn--primary"
              disabled={salvando || !somaOk || valorNum <= 0 || !descricao.trim()}
            >
              <Save className="nr-btn-icon" />
              {salvando ? 'Criando...' : 'Criar Receita'}
            </button>
          </div>
        </form>
      </div>

      {/* ====================== STYLES ====================== */}
      <style jsx>{`
        .nr-overlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.55);
          backdrop-filter: blur(2px);
          z-index: 1000;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 30px 20px;
          overflow-y: auto;
        }
        .nr-box {
          background: #fff;
          border-radius: 14px;
          width: 100%;
          max-width: 1180px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .nr-header {
          padding: 20px 24px 16px;
          border-bottom: 1px solid #f1f5f9;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
        }
        .nr-title {
          margin: 0;
          font-size: 20px;
          font-weight: 700;
          color: #18181b;
          letter-spacing: -0.02em;
        }
        .nr-subtitle {
          font-size: 12.5px;
          color: #71717a;
          margin-top: 2px;
        }
        .nr-close {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          color: #64748b;
          flex-shrink: 0;
        }
        .nr-close:hover { background: #f1f5f9; color: #18181b; }
        .nr-close :global(svg) { width: 18px; height: 18px; }
        .nr-body {
          padding: 18px 24px 18px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          max-height: calc(100vh - 100px);
          overflow-y: auto;
        }

        /* Erro geral */
        .nr-erro-geral {
          padding: 11px 14px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 8px;
          color: #991b1b;
          font-size: 13px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .nr-erro-icon { width: 16px; height: 16px; flex-shrink: 0; }

        /* Layout 2 colunas */
        .nr-grid {
          display: grid;
          grid-template-columns: 1fr 320px;
          gap: 16px;
          align-items: start;
        }
        @media (max-width: 1100px) {
          .nr-grid { grid-template-columns: 1fr; }
        }
        .nr-main { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
        .nr-aside { position: sticky; top: 0; }

        /* Cards */
        .nr-card {
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 18px 20px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
        }
        .nr-card-title {
          margin: 0 0 14px;
          font-size: 14px;
          font-weight: 700;
          color: #18181b;
          letter-spacing: -0.01em;
        }

        /* Form rows */
        .nr-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .nr-row-3 { display: grid; grid-template-columns: 1fr 2fr; gap: 12px; }
        .nr-row-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 12px; }
        .nr-row-3:first-of-type { margin-top: 0; }
        @media (max-width: 700px) {
          .nr-row-2, .nr-row-3, .nr-row-4 { grid-template-columns: 1fr; }
        }
        .nr-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .nr-field--span2 { grid-column: span 2; }
        @media (max-width: 700px) { .nr-field--span2 { grid-column: span 1; } }
        .nr-field label {
          font-size: 11.5px;
          font-weight: 600;
          color: #475569;
          letter-spacing: 0.01em;
        }
        .nr-field input,
        .nr-field select,
        .nr-textarea {
          padding: 9px 12px;
          font-size: 13.5px;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          background: #fff;
          color: #18181b;
          font-family: inherit;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .nr-field input:focus,
        .nr-field select:focus,
        .nr-textarea:focus {
          border-color: #7c3aed;
          box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1);
        }
        .nr-readonly { background: #f8fafc !important; color: #475569 !important; }
        .nr-textarea { width: 100%; resize: vertical; min-height: 70px; }

        /* FX cards */
        .nr-fxcards { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        @media (max-width: 700px) { .nr-fxcards { grid-template-columns: 1fr; } }
        .nr-fxcard {
          border: 2px solid #e5e7eb;
          border-radius: 10px;
          padding: 14px;
          cursor: pointer;
          background: #fff;
          transition: all 0.15s;
        }
        .nr-fxcard:hover { border-color: #cbd5e1; }
        .nr-fxcard.selected { border-color: #7c3aed; background: #faf5ff; }
        .nr-fxcard-head {
          display: flex; align-items: center; gap: 10px; margin-bottom: 6px;
        }
        .nr-fxcard p { margin: 0; font-size: 12px; color: #64748b; }
        .nr-fxcard-body { margin-top: 12px; }
        .nr-radio {
          width: 16px; height: 16px;
          border: 2px solid #cbd5e1;
          border-radius: 50%;
          flex-shrink: 0;
          transition: all 0.15s;
        }
        .nr-radio[data-on='true'] {
          border-color: #7c3aed;
          background: radial-gradient(circle, #7c3aed 40%, #fff 45%);
        }
        .nr-fxresult {
          margin-top: 12px;
          padding: 10px 12px;
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          border-radius: 8px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .nr-fxresult-icon { width: 18px; height: 18px; color: #16a34a; flex-shrink: 0; }
        .nr-fxresult small {
          display: block;
          font-size: 11px;
          color: #71717a;
        }
        .nr-fxresult strong {
          display: block;
          font-size: 16px;
          font-weight: 700;
          color: #14532d;
        }
        .nr-fxvar-info {
          padding: 10px 12px;
          background: #fffbeb;
          border: 1px solid #fde68a;
          border-radius: 8px;
          font-size: 12px;
          color: #92400e;
          display: flex;
          align-items: flex-start;
          gap: 8px;
        }
        .nr-fxvar-icon { width: 14px; height: 14px; flex-shrink: 0; margin-top: 1px; }

        /* Alerts inline */
        .nr-alert-info,
        .nr-alert-warn {
          margin-top: 12px;
          padding: 10px 12px;
          border-radius: 8px;
          font-size: 12.5px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .nr-alert-info { background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af; }
        .nr-alert-warn { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
        .nr-alert-icon { width: 14px; height: 14px; flex-shrink: 0; }

        /* Divisão cards */
        .nr-divcards { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
        @media (max-width: 700px) { .nr-divcards { grid-template-columns: 1fr; } }
        .nr-divcard {
          border: 2px solid #e5e7eb;
          border-radius: 10px;
          padding: 12px 14px;
          cursor: pointer;
          background: #fff;
          transition: all 0.15s;
        }
        .nr-divcard:hover { border-color: #cbd5e1; }
        .nr-divcard.selected { border-color: #7c3aed; background: #faf5ff; }
        .nr-divcard-head {
          display: flex; align-items: center; gap: 10px; margin-bottom: 4px;
        }
        .nr-divcard p { margin: 0; font-size: 11.5px; color: #64748b; }

        /* Tabela de requerentes */
        .nr-reqtable {
          width: 100%;
          border-collapse: collapse;
          margin-top: 10px;
          font-size: 12.5px;
        }
        .nr-reqtable th {
          text-align: left;
          padding: 8px 10px;
          font-size: 10.5px;
          font-weight: 700;
          color: #71717a;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          border-bottom: 1px solid #e5e7eb;
          background: #f9fafb;
        }
        .nr-reqtable td {
          padding: 8px 10px;
          border-bottom: 1px solid #f1f5f9;
          color: #18181b;
        }
        .nr-cell-num { font-variant-numeric: tabular-nums; text-align: right; }
        .nr-cb-row { display: flex; align-items: center; gap: 8px; cursor: pointer; }
        .nr-cb-row input[type='checkbox'] { width: 15px; height: 15px; accent-color: #7c3aed; cursor: pointer; }
        .nr-pct-input,
        .nr-val-input {
          width: 90px;
          padding: 5px 8px;
          font-size: 12.5px;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          font-family: inherit;
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
        .nr-pct-input:focus,
        .nr-val-input:focus,
        .nr-name-input:focus {
          border-color: #7c3aed;
          outline: none;
          box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.1);
        }
        .nr-pct-input:disabled,
        .nr-val-input:disabled {
          background: #f8fafc;
          color: #94a3b8;
          cursor: not-allowed;
        }
        .nr-name-input {
          padding: 5px 8px;
          font-size: 12.5px;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          font-family: inherit;
          width: 100%;
          max-width: 220px;
        }
        .nr-row-del {
          width: 24px; height: 24px;
          background: transparent; border: none; padding: 0;
          color: #94a3b8; cursor: pointer; border-radius: 4px;
        }
        .nr-row-del:hover { background: #fee2e2; color: #dc2626; }
        .nr-row-del :global(svg) { width: 14px; height: 14px; }

        .nr-badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.02em;
        }
        .nr-badge--ok { background: #dcfce7; color: #15803d; }
        .nr-badge--neutro { background: #f1f5f9; color: #64748b; }
        .nr-badge--fx { background: #ede9fe; color: #6d28d9; }
        .nr-badge--fxvar { background: #fef3c7; color: #b45309; }

        /* Soma */
        .nr-sum {
          margin-top: 10px;
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 12.5px;
          font-weight: 600;
          text-align: center;
        }
        .nr-sum.ok { background: #dcfce7; color: #166534; }
        .nr-sum.warn { background: #fef3c7; color: #92400e; }
        .nr-sum.err { background: #fee2e2; color: #991b1b; }

        /* Loading / empty states */
        .nr-loading,
        .nr-empty {
          padding: 24px;
          text-align: center;
          color: #71717a;
          font-size: 13px;
          background: #f9fafb;
          border: 1px dashed #e5e7eb;
          border-radius: 8px;
        }
        .nr-empty { display: flex; flex-direction: column; gap: 8px; align-items: center; }
        .nr-btn-link {
          background: transparent; border: none; padding: 4px 8px;
          color: #7c3aed; font-size: 12.5px; font-weight: 600; cursor: pointer;
          font-family: inherit;
        }
        .nr-btn-link:hover { text-decoration: underline; }

        /* Sidebar */
        .nr-aside-card {
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 16px 18px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
        }
        .nr-aside-title {
          margin: 0 0 14px;
          font-size: 13px;
          font-weight: 700;
          color: #18181b;
          letter-spacing: 0.02em;
        }
        .nr-resrow {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          font-size: 12px;
          padding: 6px 0;
          border-bottom: 1px dashed #f1f5f9;
        }
        .nr-resrow:last-child { border-bottom: none; }
        .nr-resrow span { color: #64748b; }
        .nr-resrow strong {
          color: #18181b;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          text-align: right;
        }
        .nr-brl { color: #15803d !important; }

        .nr-fxbox {
          margin: -4px -2px 12px;
          padding: 10px 12px;
          border-radius: 8px;
          font-size: 11.5px;
          color: #475569;
        }
        .nr-fxbox--fixo { background: #f0fdf4; border: 1px solid #bbf7d0; }
        .nr-fxbox--variavel { background: #fffbeb; border: 1px solid #fde68a; }
        .nr-fxbox-head {
          display: flex; justify-content: space-between; align-items: center;
          gap: 8px; margin-bottom: 4px;
          font-size: 11px; font-weight: 700; color: #18181b;
        }
        .nr-fxbox-info { line-height: 1.5; }

        .nr-aside-alert {
          margin-top: 12px;
          padding: 10px 12px;
          background: #fffbeb;
          border: 1px solid #fde68a;
          border-radius: 8px;
          font-size: 11.5px;
          color: #92400e;
          line-height: 1.5;
        }

        /* Footer */
        .nr-footer {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          padding-top: 12px;
          border-top: 1px solid #f1f5f9;
        }
        .nr-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 9px 18px;
          font-size: 14px;
          font-weight: 600;
          border-radius: 8px;
          cursor: pointer;
          border: 1px solid transparent;
          font-family: inherit;
          transition: background 0.15s, opacity 0.15s;
        }
        .nr-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .nr-btn-icon { width: 14px; height: 14px; }
        .nr-btn--ghost {
          background: #fff;
          border-color: #cbd5e1;
          color: #475569;
        }
        .nr-btn--ghost:hover:not(:disabled) { background: #f1f5f9; }
        .nr-btn--primary {
          background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
          color: #fff;
          box-shadow: 0 2px 6px rgba(124, 58, 237, 0.3);
        }
        .nr-btn--primary:hover:not(:disabled) {
          background: linear-gradient(135deg, #6d28d9 0%, #5b21b6 100%);
          box-shadow: 0 4px 10px rgba(124, 58, 237, 0.4);
        }
      `}</style>
    </div>
  )
}

export default NovaReceitaModal
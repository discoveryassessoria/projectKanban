// src/components/financeiro/modals/NovoCustoModal.tsx
//
// 🆕 Fase 3 — Criação de Custo (modelo novo do schema reformado).
//
// Replica visual e funcionalmente a página #page-novo-custo do
// html_final_marco.html, adaptada como modal dentro do
// ProcessoFinanceiro. Layout 2 colunas (form + sidebar de resumo).
//
// Endpoint: POST /api/financeiro/custos
//
// Decisões alinhadas com o schema:
//   - Custo não tem split por requerente (é despesa da empresa).
//   - "Custo operacional" exige categoriaVinculada + percentualVinculado.
//     Lógica: imposto sobre Honorários de uma categoria de receita.
//   - Mapeia labels HTML → enums TipoCusto/CategoriaCusto/FormaPagamento.

'use client'

import { useState, useEffect } from 'react'
import { X, Save, AlertCircle, Info, Check } from 'lucide-react'

// ============================================================================
// Tipos / Constantes
// ============================================================================

type Moeda = 'BRL' | 'EUR' | 'USD'
type FxRule = 'FIXO' | 'VARIAVEL'

type TipoCusto = 'SERVICO' | 'IMPOSTO' | 'DOCUMENTO' | 'DESPESA'
type CategoriaCusto =
  | 'TRADUCOES_JURAMENTACOES'
  | 'APOSTILAMENTOS'
  | 'HONORARIOS_ESCRITORIO'
  | 'TAXAS_CONSULARES'
  | 'OUTROS'
type CategoriaReceita = 'HONORARIOS' | 'REEMBOLSO' | 'PASTA_DOCUMENTAL' | 'OUTROS'
type FormaPagamento =
  | 'PIX'
  | 'CARTAO_CREDITO'
  | 'CARTAO_DEBITO'
  | 'BOLETO'
  | 'TRANSFERENCIA'
  | 'DINHEIRO'
  | 'CHEQUE'
  | 'OUTRO'

const TIPOS: { value: TipoCusto; label: string }[] = [
  { value: 'SERVICO', label: 'Serviço' },
  { value: 'IMPOSTO', label: 'Imposto' },
  { value: 'DOCUMENTO', label: 'Documento' },
  { value: 'DESPESA', label: 'Despesa' },
]

const CATEGORIAS: { value: CategoriaCusto; label: string }[] = [
  { value: 'TRADUCOES_JURAMENTACOES', label: 'Traduções e juramentações' },
  { value: 'APOSTILAMENTOS', label: 'Apostilamentos' },
  { value: 'HONORARIOS_ESCRITORIO', label: 'Honorários do escritório' },
  { value: 'TAXAS_CONSULARES', label: 'Taxas consulares' },
  { value: 'OUTROS', label: 'Outros' },
]

const CATEGORIAS_RECEITA: { value: CategoriaReceita; label: string }[] = [
  { value: 'HONORARIOS', label: 'Honorários' },
  { value: 'REEMBOLSO', label: 'Reembolso' },
  { value: 'PASTA_DOCUMENTAL', label: 'Pasta Documental' },
  { value: 'OUTROS', label: 'Outros' },
]

const FORMAS: { value: FormaPagamento; label: string }[] = [
  { value: 'TRANSFERENCIA', label: 'Transferência bancária' },
  { value: 'PIX', label: 'PIX' },
  { value: 'BOLETO', label: 'Boleto' },
  { value: 'CARTAO_CREDITO', label: 'Cartão de crédito' },
  { value: 'CARTAO_DEBITO', label: 'Cartão de débito' },
  { value: 'DINHEIRO', label: 'Dinheiro' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'OUTRO', label: 'Outro' },
]

const PARCELAMENTOS = [1, 2, 3, 6, 12]
const FX_HOJE_FALLBACK = 5.5

// ============================================================================
// Helpers (duplicados aqui pra deixar o arquivo auto-contido)
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
  return v.toLocaleString('pt-BR', { style: 'currency', currency: moeda })
}
function moedaSimbolo(m: Moeda): string {
  return m === 'BRL' ? 'R$' : m === 'EUR' ? '€' : 'US$'
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

// ============================================================================
// Props
// ============================================================================

export interface NovoCustoModalProps {
  processoId: number
  isOpen: boolean
  onClose: () => void
  onSuccess: (custo: unknown) => void
}

// ============================================================================
// Componente
// ============================================================================

export function NovoCustoModal({
  processoId,
  isOpen,
  onClose,
  onSuccess,
}: NovoCustoModalProps) {
  const [tipo, setTipo] = useState<TipoCusto>('SERVICO')
  const [categoria, setCategoria] = useState<CategoriaCusto>('OUTROS')
  const [descricao, setDescricao] = useState('')
  const [fornecedor, setFornecedor] = useState('')
  const [dataCusto, setDataCusto] = useState(todayISO())
  const [moeda, setMoeda] = useState<Moeda>('EUR')
  const [valor, setValor] = useState('')
  const [fxEst, setFxEst] = useState(FX_HOJE_FALLBACK.toFixed(2).replace('.', ','))
  const [fxRule, setFxRule] = useState<FxRule>('FIXO')
  const [fxFixo, setFxFixo] = useState(FX_HOJE_FALLBACK.toFixed(2).replace('.', ','))
  const [fxData, setFxData] = useState(todayISO())
  const [forma, setForma] = useState<FormaPagamento>('TRANSFERENCIA')
  const [vencimento, setVencimento] = useState(todayISO())
  const [parcelamento, setParcelamento] = useState(1)
  const [observacoes, setObservacoes] = useState('')

  // Custo operacional (vincula a categoria de receita)
  const [custoOperacional, setCustoOperacional] = useState(false)
  const [categoriaVinc, setCategoriaVinc] = useState<CategoriaReceita>('HONORARIOS')
  const [pctVinc, setPctVinc] = useState('100')

  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // ---- Reset ao abrir ----
  useEffect(() => {
    if (!isOpen) return
    setTipo('SERVICO')
    setCategoria('OUTROS')
    setDescricao('')
    setFornecedor('')
    setDataCusto(todayISO())
    setMoeda('EUR')
    setValor('')
    setFxEst(FX_HOJE_FALLBACK.toFixed(2).replace('.', ','))
    setFxRule('FIXO')
    setFxFixo(FX_HOJE_FALLBACK.toFixed(2).replace('.', ','))
    setFxData(todayISO())
    setForma('TRANSFERENCIA')
    setVencimento(todayISO())
    setParcelamento(1)
    setObservacoes('')
    setCustoOperacional(false)
    setCategoriaVinc('HONORARIOS')
    setPctVinc('100')
    setErro(null)
  }, [isOpen])

  // ---- Computed ----
  const valorNum = parseFloatBR(valor)
  const fxEstNum = parseFloatBR(fxEst) || FX_HOJE_FALLBACK
  const fxFixoNum = parseFloatBR(fxFixo) || fxEstNum
  const pctVincNum = Math.max(0, Math.min(100, parseFloatBR(pctVinc) || 0))
  const fxAtual = moeda === 'BRL' ? 1 : fxRule === 'FIXO' ? fxFixoNum : fxEstNum
  const totalBrl = valorNum * fxAtual
  const parcMoeda = valorNum / parcelamento
  const parcBrl = parcMoeda * fxAtual

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
    if (!vencimento) {
      setErro('Data de vencimento é obrigatória.')
      return
    }
    if (fxRule === 'FIXO' && moeda !== 'BRL' && fxFixoNum <= 0) {
      setErro('Câmbio fixo é obrigatório quando regra = Fixo.')
      return
    }
    if (custoOperacional && (!categoriaVinc || pctVincNum <= 0)) {
      setErro('Custo operacional exige categoria vinculada e percentual > 0.')
      return
    }

    setSalvando(true)
    try {
      const body = {
        processoId,
        tipo,
        categoria,
        descricao: descricao.trim(),
        fornecedor: fornecedor.trim() || null,
        moeda,
        valor: valorNum,
        fxEstimado: moeda === 'BRL' ? 1 : fxEstNum,
        fxRule: moeda === 'BRL' ? 'FIXO' : fxRule,
        fxFixo: fxRule === 'FIXO' && moeda !== 'BRL' ? fxFixoNum : null,
        fxData: fxRule === 'FIXO' && moeda !== 'BRL' ? fxData : null,
        nParcelas: parcelamento,
        vencimento,
        custoOperacional,
        categoriaVinculada: custoOperacional ? categoriaVinc : null,
        percentualVinculado: custoOperacional ? pctVincNum : null,
        formaPagamento: forma,
        observacoes: observacoes.trim() || null,
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
      onSuccess(novoCusto)
      onClose()
    } catch (err) {
      console.error('[NovoCustoModal] erro submit:', err)
      setErro('Erro de conexão. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="nc-overlay" onClick={onClose}>
      <div
        className="nc-box"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Novo Custo"
      >
        <div className="nc-header">
          <div>
            <h2 className="nc-title">+ Novo Custo</h2>
            <div className="nc-subtitle">
              Cadastre um novo custo ou despesa do processo
            </div>
          </div>
          <button type="button" className="nc-close" onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="nc-body">
          {erro && (
            <div className="nc-erro-geral">
              <AlertCircle className="nc-erro-icon" />
              <span>{erro}</span>
            </div>
          )}

          <div className="nc-grid">
            {/* === MAIN === */}
            <div className="nc-main">
              {/* 1. Dados */}
              <section className="nc-card">
                <h3 className="nc-card-title">1. Dados do Custo</h3>
                <div className="nc-row-3">
                  <div className="nc-field">
                    <label>Tipo</label>
                    <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoCusto)}>
                      {TIPOS.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="nc-field">
                    <label>Categoria</label>
                    <select
                      value={categoria}
                      onChange={(e) => setCategoria(e.target.value as CategoriaCusto)}
                    >
                      {CATEGORIAS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="nc-field">
                    <label>Descrição *</label>
                    <input
                      type="text"
                      value={descricao}
                      onChange={(e) => setDescricao(e.target.value)}
                      placeholder="Ex.: Tradução juramentada"
                    />
                  </div>
                </div>

                <div className="nc-row-4">
                  <div className="nc-field">
                    <label>Fornecedor</label>
                    <input
                      type="text"
                      value={fornecedor}
                      onChange={(e) => setFornecedor(e.target.value)}
                      placeholder="Ex.: Tradux Juramentadas"
                    />
                  </div>
                  <div className="nc-field">
                    <label>Data do custo</label>
                    <input
                      type="date"
                      value={dataCusto}
                      onChange={(e) => setDataCusto(e.target.value)}
                    />
                  </div>
                  <div className="nc-field">
                    <label>Moeda</label>
                    <select value={moeda} onChange={(e) => setMoeda(e.target.value as Moeda)}>
                      <option value="EUR">EUR — Euro (€)</option>
                      <option value="BRL">BRL — Real (R$)</option>
                      <option value="USD">USD — Dólar (US$)</option>
                    </select>
                  </div>
                  <div className="nc-field">
                    <label>Valor total ({moedaSimbolo(moeda)}) *</label>
                    <input
                      type="text"
                      value={valor}
                      onChange={(e) => setValor(e.target.value)}
                      placeholder="0,00"
                    />
                  </div>
                </div>

                {moeda !== 'BRL' && (
                  <div className="nc-row-2 nc-mt">
                    <div className="nc-field">
                      <label>Câmbio estimado ({moeda} → BRL)</label>
                      <input
                        type="text"
                        value={fxEst}
                        onChange={(e) => setFxEst(e.target.value)}
                      />
                    </div>
                    <div className="nc-field">
                      <label>Valor estimado em BRL</label>
                      <input
                        type="text"
                        value={fmtBRL(valorNum * fxEstNum)}
                        readOnly
                        className="nc-readonly"
                      />
                    </div>
                  </div>
                )}
              </section>

              {/* 2. Regra de Câmbio */}
              {moeda !== 'BRL' && (
                <section className="nc-card">
                  <h3 className="nc-card-title">2. Regra de Câmbio</h3>
                  <div className="nc-fxcards">
                    <div
                      className={`nc-fxcard ${fxRule === 'FIXO' ? 'selected' : ''}`}
                      onClick={() => setFxRule('FIXO')}
                    >
                      <div className="nc-fxcard-head">
                        <div className="nc-radio" data-on={fxRule === 'FIXO'} />
                        <strong>Câmbio fixo para todos os pagamentos</strong>
                      </div>
                      <p>Câmbio definido agora; pagamentos ficam fixos em reais.</p>
                      {fxRule === 'FIXO' && (
                        <div className="nc-fxcard-body" onClick={(e) => e.stopPropagation()}>
                          <div className="nc-row-2">
                            <div className="nc-field">
                              <label>Câmbio fixado</label>
                              <input
                                type="text"
                                value={fxFixo}
                                onChange={(e) => setFxFixo(e.target.value)}
                              />
                            </div>
                            <div className="nc-field">
                              <label>Data da fixação</label>
                              <input
                                type="date"
                                value={fxData}
                                onChange={(e) => setFxData(e.target.value)}
                              />
                            </div>
                          </div>
                          <div className="nc-fxresult">
                            <Check className="nc-fxresult-icon" />
                            <div>
                              <small>Valor total em BRL (fixo)</small>
                              <strong>{fmtBRL(valorNum * fxFixoNum)}</strong>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div
                      className={`nc-fxcard ${fxRule === 'VARIAVEL' ? 'selected' : ''}`}
                      onClick={() => setFxRule('VARIAVEL')}
                    >
                      <div className="nc-fxcard-head">
                        <div className="nc-radio" data-on={fxRule === 'VARIAVEL'} />
                        <strong>Câmbio variável por pagamento</strong>
                      </div>
                      <p>O câmbio será informado em cada pagamento (baixa).</p>
                      {fxRule === 'VARIAVEL' && (
                        <div className="nc-fxcard-body">
                          <div className="nc-fxvar-info">
                            <Info className="nc-fxvar-icon" />
                            <span>
                              O valor em reais será definido no momento de cada pagamento,
                              conforme o câmbio do dia.
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {/* 3. Condições */}
              <section className="nc-card">
                <h3 className="nc-card-title">
                  {moeda === 'BRL' ? '2.' : '3.'} Condições de Pagamento
                </h3>
                <div className="nc-row-3">
                  <div className="nc-field">
                    <label>Forma de pagamento</label>
                    <select
                      value={forma}
                      onChange={(e) => setForma(e.target.value as FormaPagamento)}
                    >
                      {FORMAS.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="nc-field">
                    <label>Vencimento *</label>
                    <input
                      type="date"
                      value={vencimento}
                      onChange={(e) => setVencimento(e.target.value)}
                    />
                  </div>
                  <div className="nc-field">
                    <label>Parcelamento</label>
                    <select
                      value={parcelamento}
                      onChange={(e) => setParcelamento(parseInt(e.target.value))}
                    >
                      {PARCELAMENTOS.map((n) => (
                        <option key={n} value={n}>
                          {n === 1 ? 'À vista (1 parcela)' : `${n} parcelas`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              {/* 4. Custo operacional */}
              <section className="nc-card">
                <h3 className="nc-card-title">
                  {moeda === 'BRL' ? '3.' : '4.'} Vínculo com Receita (opcional)
                </h3>
                <label className="nc-check">
                  <input
                    type="checkbox"
                    checked={custoOperacional}
                    onChange={(e) => setCustoOperacional(e.target.checked)}
                  />
                  <span>
                    <strong>Custo operacional vinculado a uma categoria de receita</strong>
                    <small>
                      Ex: imposto de 12% sobre Honorários — o custo segue o percentual
                      da categoria de receita escolhida.
                    </small>
                  </span>
                </label>

                {custoOperacional && (
                  <div className="nc-row-2 nc-mt">
                    <div className="nc-field">
                      <label>Categoria de receita vinculada *</label>
                      <select
                        value={categoriaVinc}
                        onChange={(e) =>
                          setCategoriaVinc(e.target.value as CategoriaReceita)
                        }
                      >
                        {CATEGORIAS_RECEITA.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="nc-field">
                      <label>Percentual sobre receita (%) *</label>
                      <input
                        type="text"
                        value={pctVinc}
                        onChange={(e) => setPctVinc(e.target.value)}
                        placeholder="12"
                      />
                    </div>
                  </div>
                )}
              </section>

              {/* Observações */}
              <section className="nc-card">
                <h3 className="nc-card-title">Observações</h3>
                <textarea
                  className="nc-textarea"
                  rows={3}
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                  placeholder="Opcional"
                />
              </section>
            </div>

            {/* === SIDEBAR === */}
            <aside className="nc-aside">
              <div className="nc-aside-card">
                <h4 className="nc-aside-title">📊 Resumo do Custo</h4>

                {moeda !== 'BRL' && (
                  <div className={`nc-fxbox nc-fxbox--${fxRule.toLowerCase()}`}>
                    <div className="nc-fxbox-head">
                      <span>📑 Regra de câmbio</span>
                      <span
                        className={`nc-badge ${
                          fxRule === 'FIXO' ? 'nc-badge--fx' : 'nc-badge--fxvar'
                        }`}
                      >
                        {fxRule === 'FIXO' ? 'CÂMBIO FIXO' : 'CÂMBIO VARIÁVEL'}
                      </span>
                    </div>
                    <div className="nc-fxbox-info">
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
                          Valores reais a cada pagamento.
                        </>
                      )}
                    </div>
                  </div>
                )}

                <div className="nc-resrow">
                  <span>Valor total ({moedaSimbolo(moeda)})</span>
                  <strong>{fmtMoeda(valorNum, moeda)}</strong>
                </div>
                <div className="nc-resrow">
                  <span>
                    Valor total em BRL{' '}
                    {moeda !== 'BRL' && (fxRule === 'FIXO' ? '(fixo)' : '(estimado)')}
                  </span>
                  <strong className="nc-brl">
                    {fmtBRL(totalBrl)}
                    {moeda !== 'BRL' && fxRule === 'VARIAVEL' && ' (est.)'}
                  </strong>
                </div>
                <div className="nc-resrow">
                  <span>Número de parcelas</span>
                  <strong>{parcelamento}</strong>
                </div>
                <div className="nc-resrow">
                  <span>Valor da parcela ({moedaSimbolo(moeda)})</span>
                  <strong>{fmtMoeda(parcMoeda, moeda)}</strong>
                </div>
                <div className="nc-resrow">
                  <span>Valor da parcela (BRL)</span>
                  <strong className="nc-brl">
                    {fmtBRL(parcBrl)}
                    {moeda !== 'BRL' && fxRule === 'VARIAVEL' && ' (est.)'}
                  </strong>
                </div>
                <div className="nc-resrow">
                  <span>Fornecedor</span>
                  <strong>{fornecedor || '—'}</strong>
                </div>
                <div className="nc-resrow">
                  <span>Categoria</span>
                  <strong>
                    {CATEGORIAS.find((c) => c.value === categoria)?.label || categoria}
                  </strong>
                </div>
                <div className="nc-resrow">
                  <span>Tipo</span>
                  <strong>{TIPOS.find((t) => t.value === tipo)?.label || tipo}</strong>
                </div>
                <div className="nc-resrow">
                  <span>1º vencimento</span>
                  <strong>{fmtDateBR(vencimento)}</strong>
                </div>
                {parcelamento > 1 && (
                  <div className="nc-resrow">
                    <span>Último vencimento</span>
                    <strong>{fmtDateBR(addMonthsISO(vencimento, parcelamento - 1))}</strong>
                  </div>
                )}

                {custoOperacional && (
                  <div className="nc-aside-vinc">
                    <small>VÍNCULO OPERACIONAL</small>
                    <div>
                      {pctVincNum.toFixed(2)}% sobre{' '}
                      {CATEGORIAS_RECEITA.find((c) => c.value === categoriaVinc)?.label}
                    </div>
                  </div>
                )}
              </div>
            </aside>
          </div>

          <div className="nc-footer">
            <button
              type="button"
              className="nc-btn nc-btn--ghost"
              onClick={onClose}
              disabled={salvando}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="nc-btn nc-btn--primary"
              disabled={salvando || valorNum <= 0 || !descricao.trim()}
            >
              <Save className="nc-btn-icon" />
              {salvando ? 'Salvando...' : 'Salvar Custo'}
            </button>
          </div>
        </form>
      </div>

      <style jsx>{`
        .nc-overlay {
          position: fixed; inset: 0;
          background: rgba(15, 23, 42, 0.55);
          backdrop-filter: blur(2px);
          z-index: 1000;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 30px 20px;
          overflow-y: auto;
        }
        .nc-box {
          background: #fff;
          border-radius: 14px;
          width: 100%;
          max-width: 1100px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .nc-header {
          padding: 20px 24px 16px;
          border-bottom: 1px solid #f1f5f9;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
        }
        .nc-title {
          margin: 0;
          font-size: 20px;
          font-weight: 700;
          color: #18181b;
          letter-spacing: -0.02em;
        }
        .nc-subtitle { font-size: 12.5px; color: #71717a; margin-top: 2px; }
        .nc-close {
          width: 32px; height: 32px;
          display: flex; align-items: center; justify-content: center;
          background: transparent; border: none;
          border-radius: 6px; cursor: pointer; color: #64748b;
          flex-shrink: 0;
        }
        .nc-close:hover { background: #f1f5f9; color: #18181b; }
        .nc-close :global(svg) { width: 18px; height: 18px; }
        .nc-body {
          padding: 18px 24px 18px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          max-height: calc(100vh - 100px);
          overflow-y: auto;
        }

        .nc-erro-geral {
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
        .nc-erro-icon { width: 16px; height: 16px; flex-shrink: 0; }

        .nc-grid {
          display: grid;
          grid-template-columns: 1fr 320px;
          gap: 16px;
          align-items: start;
        }
        @media (max-width: 1100px) { .nc-grid { grid-template-columns: 1fr; } }
        .nc-main { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
        .nc-aside { position: sticky; top: 0; }

        .nc-card {
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 18px 20px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
        }
        .nc-card-title {
          margin: 0 0 14px;
          font-size: 14px;
          font-weight: 700;
          color: #18181b;
          letter-spacing: -0.01em;
        }

        .nc-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .nc-row-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .nc-row-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 12px; }
        .nc-mt { margin-top: 12px; }
        @media (max-width: 700px) {
          .nc-row-2, .nc-row-3, .nc-row-4 { grid-template-columns: 1fr; }
        }
        .nc-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .nc-field label {
          font-size: 11.5px; font-weight: 600; color: #475569;
        }
        .nc-field input,
        .nc-field select,
        .nc-textarea {
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
        .nc-field input:focus,
        .nc-field select:focus,
        .nc-textarea:focus {
          border-color: #7c3aed;
          box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1);
        }
        .nc-readonly { background: #f8fafc !important; color: #475569 !important; }
        .nc-textarea { width: 100%; resize: vertical; min-height: 70px; }

        .nc-fxcards { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        @media (max-width: 700px) { .nc-fxcards { grid-template-columns: 1fr; } }
        .nc-fxcard {
          border: 2px solid #e5e7eb;
          border-radius: 10px;
          padding: 14px;
          cursor: pointer;
          background: #fff;
          transition: all 0.15s;
        }
        .nc-fxcard:hover { border-color: #cbd5e1; }
        .nc-fxcard.selected { border-color: #7c3aed; background: #faf5ff; }
        .nc-fxcard-head {
          display: flex; align-items: center; gap: 10px; margin-bottom: 6px;
        }
        .nc-fxcard p { margin: 0; font-size: 12px; color: #64748b; }
        .nc-fxcard-body { margin-top: 12px; }
        .nc-radio {
          width: 16px; height: 16px;
          border: 2px solid #cbd5e1;
          border-radius: 50%;
          flex-shrink: 0;
          transition: all 0.15s;
        }
        .nc-radio[data-on='true'] {
          border-color: #7c3aed;
          background: radial-gradient(circle, #7c3aed 40%, #fff 45%);
        }
        .nc-fxresult {
          margin-top: 12px;
          padding: 10px 12px;
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          border-radius: 8px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .nc-fxresult-icon { width: 18px; height: 18px; color: #16a34a; flex-shrink: 0; }
        .nc-fxresult small { display: block; font-size: 11px; color: #71717a; }
        .nc-fxresult strong { display: block; font-size: 16px; font-weight: 700; color: #14532d; }
        .nc-fxvar-info {
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
        .nc-fxvar-icon { width: 14px; height: 14px; flex-shrink: 0; margin-top: 1px; }

        .nc-check {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 12px;
          background: #f8fafc;
          border-radius: 8px;
          cursor: pointer;
        }
        .nc-check input { width: 16px; height: 16px; margin-top: 2px; cursor: pointer; }
        .nc-check span { flex: 1; }
        .nc-check strong { display: block; font-size: 13px; color: #18181b; margin-bottom: 2px; }
        .nc-check small { display: block; font-size: 11.5px; color: #64748b; line-height: 1.45; }

        .nc-aside-card {
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 16px 18px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
        }
        .nc-aside-title {
          margin: 0 0 14px;
          font-size: 13px;
          font-weight: 700;
          color: #18181b;
          letter-spacing: 0.02em;
        }
        .nc-resrow {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          font-size: 12px;
          padding: 6px 0;
          border-bottom: 1px dashed #f1f5f9;
        }
        .nc-resrow:last-child { border-bottom: none; }
        .nc-resrow span { color: #64748b; }
        .nc-resrow strong {
          color: #18181b;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          text-align: right;
        }
        .nc-brl { color: #15803d !important; }

        .nc-fxbox {
          margin: -4px -2px 12px;
          padding: 10px 12px;
          border-radius: 8px;
          font-size: 11.5px;
          color: #475569;
        }
        .nc-fxbox--fixo { background: #f0fdf4; border: 1px solid #bbf7d0; }
        .nc-fxbox--variavel { background: #fffbeb; border: 1px solid #fde68a; }
        .nc-fxbox-head {
          display: flex; justify-content: space-between; align-items: center;
          gap: 8px; margin-bottom: 4px;
          font-size: 11px; font-weight: 700; color: #18181b;
        }
        .nc-fxbox-info { line-height: 1.5; }

        .nc-badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 10.5px;
          font-weight: 700;
        }
        .nc-badge--fx { background: #ede9fe; color: #6d28d9; }
        .nc-badge--fxvar { background: #fef3c7; color: #b45309; }

        .nc-aside-vinc {
          margin-top: 12px;
          padding: 10px 12px;
          background: #f0f9ff;
          border: 1px solid #bae6fd;
          border-radius: 8px;
          font-size: 12px;
          color: #075985;
        }
        .nc-aside-vinc small {
          display: block;
          font-size: 10px;
          font-weight: 700;
          color: #0369a1;
          letter-spacing: 0.06em;
          margin-bottom: 4px;
        }

        .nc-footer {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          padding-top: 12px;
          border-top: 1px solid #f1f5f9;
        }
        .nc-btn {
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
        .nc-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .nc-btn-icon { width: 14px; height: 14px; }
        .nc-btn--ghost {
          background: #fff;
          border-color: #cbd5e1;
          color: #475569;
        }
        .nc-btn--ghost:hover:not(:disabled) { background: #f1f5f9; }
        .nc-btn--primary {
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          color: #fff;
          box-shadow: 0 2px 6px rgba(217, 119, 6, 0.3);
        }
        .nc-btn--primary:hover:not(:disabled) {
          background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
          box-shadow: 0 4px 10px rgba(217, 119, 6, 0.4);
        }
      `}</style>
    </div>
  )
}

export default NovoCustoModal
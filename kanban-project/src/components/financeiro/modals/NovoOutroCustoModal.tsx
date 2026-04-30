// src/components/financeiro/modals/NovoOutroCustoModal.tsx
//
// 🆕 LOTE 5: Modal para criar OU editar um OutroCusto.
//
// 🆕 Atualização Marco 30/04/2026:
//   Aba COBRAR (receber do cliente) NÃO tem mais:
//     - Câmbio (cliente paga em parcelas, câmbio se define no momento de
//       cada pagamento parcial)
//     - Vencimento (honorário não tem vencimento fixo)
//     - "Já recebido" (sempre lança como pendente, paga depois)
//   Aba REPASSAR continua com câmbio + vencimento + "já pago" (faz sentido
//   pra fatura de fornecedor com data real).
//
//   Novo campo "Etapa" em AMBAS as naturezas:
//     dropdown com as etapas do processo (Genealogia / Emissão / etc),
//     pra que cada lançamento apareça vinculado à sua etapa na Visão
//     Geral (bloco "Custos por etapa").
//
// Modos:
//   - CRIAR (modo padrão, sem prop `editando`)
//     POST /api/processos/:processoId/outros-custos
//   - EDITAR (passa prop `editando` com dados do OutroCusto)
//     PUT /api/outros-custos/:id

'use client'

import { useState, useEffect } from 'react'
import { X, Save, AlertCircle } from 'lucide-react'
import {
  TIPOS_COBRAR,
  TIPOS_REPASSAR,
  type OutroCustoData,
  type NaturezaOutroCusto,
  type Moeda,
} from '@/src/types/outros-custos'
import {
  validarFormOutroCusto,
  type ErrosFormOutroCusto,
} from '@/src/lib/financeiro/outros-custos-helpers'

// ============================================================================
// Constantes
// ============================================================================

// 🆕 Lista de etapas do processo (mesma fonte do VisaoGeral.tsx).
// Quando o sistema tiver um endpoint /api/etapas, trocar por fetch.
const ETAPAS = [
  { id: 'fechamen', label: 'Fechamento do Contrato' },
  { id: 'genealog', label: 'Genealogia' },
  { id: 'busca', label: 'Busca Documental' },
  { id: 'emissao', label: 'Emissão de Documentos' },
  { id: 'analise', label: 'Análise Documental' },
  { id: 'retifica', label: 'Retificação' },
  { id: 'traducao', label: 'Tradução Juramentada' },
  { id: 'apostila', label: 'Apostilamento' },
  { id: 'aguardan', label: 'Aguardando Protocolo' },
  { id: 'protocol', label: 'Protocolado' },
  { id: 'transcri', label: 'Transcrição' },
  { id: 'finaliza', label: 'Finalizado' },
]

// ============================================================================
// Props
// ============================================================================

export interface NovoOutroCustoModalProps {
  processoId: number
  isOpen: boolean
  onClose: () => void
  onSuccess: (outroCusto: OutroCustoData) => void
  // Se passado, modal abre em modo edição
  editando?: OutroCustoData | null
  // Natureza padrão (útil quando o user clica num botão "Novo Custo a Repassar"
  // ou "Nova Receita Honorários" — pra abrir já com a natureza certa)
  naturezaPadrao?: NaturezaOutroCusto
}

// ============================================================================
// Componente
// ============================================================================

export function NovoOutroCustoModal({
  processoId,
  isOpen,
  onClose,
  onSuccess,
  editando,
  naturezaPadrao = 'REPASSAR',
}: NovoOutroCustoModalProps) {
  const ehEdicao = !!editando

  // ---- Estado do form ----
  const [natureza, setNatureza] = useState<NaturezaOutroCusto>(naturezaPadrao)
  const [tipo, setTipo] = useState('')
  const [tipoCustom, setTipoCustom] = useState('') // se o user escolheu "Outros"
  const [descricao, setDescricao] = useState('')
  const [fornecedor, setFornecedor] = useState('')
  const [valor, setValor] = useState<string>('')
  const [moeda, setMoeda] = useState<Moeda>('BRL')
  const [cambio, setCambio] = useState<string>('')
  const [vencimento, setVencimento] = useState('')
  const [interno, setInterno] = useState(false)
  const [pago, setPago] = useState(false)
  const [observacao, setObservacao] = useState('')
  // 🆕 Etapa do processo (Marco 30/04/2026)
  const [etapa, setEtapa] = useState('')

  // ---- Estado de UI ----
  const [erros, setErros] = useState<ErrosFormOutroCusto>({})
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // ---- Reset/preenchimento ao abrir ----
  useEffect(() => {
    if (!isOpen) return

    if (editando) {
      // Modo edição: pré-preenche
      setNatureza(editando.natureza)
      const tiposLista =
        editando.natureza === 'COBRAR' ? TIPOS_COBRAR : TIPOS_REPASSAR
      const tipoEncontrado = (tiposLista as readonly string[]).includes(
        editando.tipo,
      )
      if (tipoEncontrado) {
        setTipo(editando.tipo)
        setTipoCustom('')
      } else {
        setTipo('Outros')
        setTipoCustom(editando.tipo)
      }
      setDescricao(editando.descricao)
      setFornecedor(editando.fornecedor || '')
      setValor(String(editando.valor))
      setMoeda(editando.moeda)
      setCambio(editando.cambio ? String(editando.cambio) : '')
      setVencimento(
        editando.vencimento ? editando.vencimento.slice(0, 10) : '',
      )
      setInterno(editando.interno)
      setPago(editando.pago)
      setObservacao(editando.observacao || '')
      // @ts-expect-error - etapa pode ainda não existir no OutroCustoData (campo novo)
      setEtapa(editando.etapa || '')
    } else {
      // Modo criação: limpa
      setNatureza(naturezaPadrao)
      setTipo('')
      setTipoCustom('')
      setDescricao('')
      setFornecedor('')
      setValor('')
      setMoeda('BRL')
      setCambio('')
      setVencimento('')
      setInterno(false)
      setPago(false)
      setObservacao('')
      setEtapa('')
    }

    setErros({})
    setErroGeral(null)
  }, [isOpen, editando, naturezaPadrao])

  // ---- Lista de tipos baseada na natureza ----
  const tiposDisponiveis =
    natureza === 'COBRAR' ? TIPOS_COBRAR : TIPOS_REPASSAR

  // Se mudar natureza e o tipo atual não estiver na lista nova, reseta
  useEffect(() => {
    if (
      tipo &&
      !(tiposDisponiveis as readonly string[]).includes(tipo) &&
      tipo !== 'Outros'
    ) {
      setTipo('')
    }
  }, [natureza, tipo, tiposDisponiveis])

  // 🆕 Marco 30/04/2026: ao trocar pra COBRAR, limpar campos que não
  // existem mais nessa natureza pra não enviar lixo no submit.
  useEffect(() => {
    if (natureza === 'COBRAR') {
      // COBRAR não tem câmbio (cliente paga em parcelas, câmbio se define
      // no momento do pagamento parcial)
      setCambio('')
      // COBRAR não tem vencimento
      setVencimento('')
      // COBRAR não tem "já recebido" — sempre lança como pendente
      setPago(false)
      // COBRAR não tem flag "interno"
      setInterno(false)
    }
  }, [natureza])

  // ---- Handler de submit ----
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErroGeral(null)

    const tipoFinal = tipo === 'Outros' ? tipoCustom.trim() : tipo

    // 🆕 Validação: COBRAR não exige câmbio (não tem mais o campo)
    const errosValidacao = validarFormOutroCusto({
      natureza,
      tipo: tipoFinal,
      descricao,
      valor: Number(valor),
      moeda,
      cambio:
        natureza === 'REPASSAR' && moeda !== 'BRL'
          ? Number(cambio)
          : undefined,
    })

    if (Object.keys(errosValidacao).length > 0) {
      setErros(errosValidacao)
      return
    }

    setSalvando(true)
    try {
      const body = {
        natureza,
        tipo: tipoFinal,
        descricao: descricao.trim(),
        fornecedor: natureza === 'REPASSAR' ? fornecedor.trim() || null : null,
        valor: Number(valor),
        moeda,
        // 🆕 Câmbio só faz sentido em REPASSAR (e quando moeda != BRL)
        cambio:
          natureza === 'REPASSAR' && moeda !== 'BRL'
            ? Number(cambio)
            : null,
        // 🆕 Vencimento só em REPASSAR
        vencimento: natureza === 'REPASSAR' ? vencimento || null : null,
        interno: natureza === 'REPASSAR' ? interno : false,
        // 🆕 "Já pago" só em REPASSAR
        pago: natureza === 'REPASSAR' ? pago : false,
        observacao: observacao.trim() || null,
        // 🆕 Etapa (vale pras duas naturezas)
        etapa: etapa || null,
      }

      const url = ehEdicao
        ? `/api/outros-custos/${editando!.id}`
        : `/api/processos/${processoId}/outros-custos`

      const res = await fetch(url, {
        method: ehEdicao ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErroGeral(data?.erro || `Erro ${res.status}: falha ao salvar`)
        setSalvando(false)
        return
      }

      const data = await res.json()
      const novo: OutroCustoData = data.outroCusto
      onSuccess(novo)
      onClose()
    } catch (err) {
      console.error('[NovoOutroCustoModal] erro:', err)
      setErroGeral('Erro de conexão. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  if (!isOpen) return null

  const ehCobrar = natureza === 'COBRAR'

  // ---- Render ----
  return (
    <div className="oc-modal-overlay" onClick={onClose}>
      <div
        className="oc-modal-box"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="oc-modal-header">
          <h2 className="oc-modal-title">
            {ehEdicao ? '✎ Editar Lançamento' : '+ Novo Lançamento'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="oc-modal-close"
            aria-label="Fechar"
          >
            <X />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="oc-modal-body">
          {erroGeral && (
            <div className="oc-erro-geral">
              <AlertCircle className="oc-erro-geral__icon" />
              <span>{erroGeral}</span>
            </div>
          )}

          {/* Natureza — toggle no topo */}
          <div className="oc-natureza-toggle">
            <button
              type="button"
              className={`oc-nat-btn oc-nat-btn--cobrar ${
                ehCobrar ? 'is-active' : ''
              }`}
              onClick={() => setNatureza('COBRAR')}
            >
              <span className="oc-nat-btn__icon">↙</span>
              <div>
                <strong>Cobrar do cliente</strong>
                <small>Receita do processo</small>
              </div>
            </button>
            <button
              type="button"
              className={`oc-nat-btn oc-nat-btn--repassar ${
                !ehCobrar ? 'is-active' : ''
              }`}
              onClick={() => setNatureza('REPASSAR')}
            >
              <span className="oc-nat-btn__icon">↗</span>
              <div>
                <strong>Repassar a terceiro</strong>
                <small>Despesa a pagar</small>
              </div>
            </button>
          </div>

          {/* Tipo */}
          <div className="oc-form-row">
            <label className="oc-form-label">
              Tipo <span className="oc-required">*</span>
            </label>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className={`oc-form-input ${erros.tipo ? 'has-error' : ''}`}
            >
              <option value="">Selecione um tipo...</option>
              {tiposDisponiveis.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {erros.tipo && <span className="oc-form-error">{erros.tipo}</span>}
          </div>

          {/* Tipo customizado (só se "Outros") */}
          {tipo === 'Outros' && (
            <div className="oc-form-row">
              <label className="oc-form-label">
                Especifique <span className="oc-required">*</span>
              </label>
              <input
                type="text"
                value={tipoCustom}
                onChange={(e) => setTipoCustom(e.target.value)}
                placeholder="Ex: Tradutor reserva, Despesa de viagem..."
                className="oc-form-input"
              />
            </div>
          )}

          {/* Descrição */}
          <div className="oc-form-row">
            <label className="oc-form-label">
              Descrição <span className="oc-required">*</span>
            </label>
            <input
              type="text"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Ex: Pagamento ao Dr. Marco Bianchi referente a recurso..."
              className={`oc-form-input ${erros.descricao ? 'has-error' : ''}`}
            />
            {erros.descricao && (
              <span className="oc-form-error">{erros.descricao}</span>
            )}
          </div>

          {/* Fornecedor (só REPASSAR) */}
          {!ehCobrar && (
            <div className="oc-form-row">
              <label className="oc-form-label">
                Fornecedor / Pagador a terceiro
              </label>
              <input
                type="text"
                value={fornecedor}
                onChange={(e) => setFornecedor(e.target.value)}
                placeholder="Ex: Dr. Marco Bianchi - Roma"
                className="oc-form-input"
              />
            </div>
          )}

          {/* 🆕 Etapa (ambas naturezas — Marco 30/04/2026) */}
          <div className="oc-form-row">
            <label className="oc-form-label">Etapa do processo</label>
            <select
              value={etapa}
              onChange={(e) => setEtapa(e.target.value)}
              className="oc-form-input"
            >
              <option value="">Selecione uma etapa...</option>
              {ETAPAS.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
            <span className="oc-form-hint">
              Aparecerá vinculado a esta etapa na Visão Geral.
            </span>
          </div>

          {/* ===== Valor + Moeda + Câmbio =====
              🆕 Câmbio só aparece em REPASSAR (Marco 30/04/2026):
              em COBRAR, o câmbio é definido na hora de cada pagamento
              parcial recebido — não fixado no lançamento. */}
          <div className={ehCobrar ? 'oc-form-grid-2' : 'oc-form-grid-3'}>
            <div className="oc-form-row">
              <label className="oc-form-label">
                Valor <span className="oc-required">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="0,00"
                className={`oc-form-input ${erros.valor ? 'has-error' : ''}`}
              />
              {erros.valor && (
                <span className="oc-form-error">{erros.valor}</span>
              )}
            </div>

            <div className="oc-form-row">
              <label className="oc-form-label">Moeda</label>
              <select
                value={moeda}
                onChange={(e) => setMoeda(e.target.value as Moeda)}
                className="oc-form-input"
              >
                <option value="BRL">R$ Real</option>
                <option value="EUR">€ Euro</option>
                <option value="USD">US$ Dólar</option>
              </select>
            </div>

            {/* Câmbio: só REPASSAR + moeda estrangeira */}
            {!ehCobrar && moeda !== 'BRL' && (
              <div className="oc-form-row">
                <label className="oc-form-label">
                  Câmbio (1 {moeda} = R$){' '}
                  <span className="oc-required">*</span>
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={cambio}
                  onChange={(e) => setCambio(e.target.value)}
                  placeholder={moeda === 'EUR' ? '5,80' : '5,00'}
                  className={`oc-form-input ${erros.cambio ? 'has-error' : ''}`}
                />
                {erros.cambio && (
                  <span className="oc-form-error">{erros.cambio}</span>
                )}
              </div>
            )}
          </div>

          {/* Total em BRL — só REPASSAR (em COBRAR não fixamos câmbio aqui) */}
          {!ehCobrar &&
            moeda !== 'BRL' &&
            Number(valor) > 0 &&
            Number(cambio) > 0 && (
              <div className="oc-conversao">
                <span>Total em BRL:</span>
                <strong>
                  R${' '}
                  {(Number(valor) * Number(cambio)).toLocaleString('pt-BR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </strong>
              </div>
            )}

          {/* 🆕 Aviso em COBRAR + moeda estrangeira: explica que câmbio
              vem no momento do pagamento */}
          {ehCobrar && moeda !== 'BRL' && (
            <div className="oc-info-aviso">
              💡 O câmbio será informado no momento de cada pagamento parcial
              recebido do cliente, e não aqui no lançamento.
            </div>
          )}

          {/* Vencimento — 🆕 só REPASSAR */}
          {!ehCobrar && (
            <div className="oc-form-row">
              <label className="oc-form-label">Vencimento (opcional)</label>
              <input
                type="date"
                value={vencimento}
                onChange={(e) => setVencimento(e.target.value)}
                className="oc-form-input"
              />
            </div>
          )}

          {/* Flags — 🆕 só REPASSAR (COBRAR não tem "já recebido" nem "interno") */}
          {!ehCobrar && (
            <div className="oc-flags">
              <label className="oc-checkbox">
                <input
                  type="checkbox"
                  checked={interno}
                  onChange={(e) => setInterno(e.target.checked)}
                />
                <span>
                  <strong>Custo interno</strong>
                  <small>Não será repassado ao cliente</small>
                </span>
              </label>
              <label className="oc-checkbox">
                <input
                  type="checkbox"
                  checked={pago}
                  onChange={(e) => setPago(e.target.checked)}
                />
                <span>
                  <strong>Já pago</strong>
                  <small>Marca como quitado sem registrar pagamento</small>
                </span>
              </label>
            </div>
          )}

          {/* Observação */}
          <div className="oc-form-row">
            <label className="oc-form-label">Observação</label>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Informações adicionais..."
              rows={3}
              className="oc-form-input oc-form-textarea"
            />
          </div>

          {/* Botões */}
          <div className="oc-modal-footer">
            <button
              type="button"
              onClick={onClose}
              className="oc-btn oc-btn--ghost"
              disabled={salvando}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="oc-btn oc-btn--primary"
              disabled={salvando}
            >
              <Save className="oc-btn__icon" />
              {salvando ? 'Salvando...' : ehEdicao ? 'Salvar' : 'Criar'}
            </button>
          </div>
        </form>
      </div>

      <style jsx>{`
        .oc-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.55);
          backdrop-filter: blur(2px);
          z-index: 1000;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 40px 20px;
          overflow-y: auto;
        }
        .oc-modal-box {
          background: #fff;
          border-radius: 12px;
          width: 100%;
          max-width: 640px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          display: flex;
          flex-direction: column;
        }
        .oc-modal-header {
          padding: 20px 24px 16px;
          border-bottom: 1px solid #f1f5f9;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .oc-modal-title {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
          color: #1f2937;
        }
        .oc-modal-close {
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
        }
        .oc-modal-close:hover {
          background: #f1f5f9;
          color: #1f2937;
        }
        .oc-modal-close :global(svg) {
          width: 18px;
          height: 18px;
        }
        .oc-modal-body {
          padding: 20px 24px 24px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .oc-erro-geral {
          padding: 12px 14px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 8px;
          color: #991b1b;
          font-size: 13px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .oc-erro-geral__icon {
          width: 16px;
          height: 16px;
          flex-shrink: 0;
        }

        /* === Natureza toggle === */
        .oc-natureza-toggle {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .oc-nat-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 14px;
          background: #fff;
          border: 2px solid #e2e8f0;
          border-radius: 10px;
          cursor: pointer;
          text-align: left;
          transition: all 0.15s;
          font-family: inherit;
        }
        .oc-nat-btn:hover {
          border-color: #cbd5e1;
        }
        .oc-nat-btn__icon {
          font-size: 22px;
          line-height: 1;
        }
        .oc-nat-btn strong {
          display: block;
          font-size: 13px;
          color: #1f2937;
        }
        .oc-nat-btn small {
          display: block;
          font-size: 11px;
          color: #64748b;
        }
        .oc-nat-btn--cobrar.is-active {
          background: #f0fdf4;
          border-color: #16a34a;
        }
        .oc-nat-btn--cobrar.is-active strong {
          color: #15803d;
        }
        .oc-nat-btn--repassar.is-active {
          background: #fef3c7;
          border-color: #d97706;
        }
        .oc-nat-btn--repassar.is-active strong {
          color: #b45309;
        }

        /* === Form === */
        .oc-form-row {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .oc-form-grid-3 {
          display: grid;
          grid-template-columns: 1.4fr 1fr 1.2fr;
          gap: 10px;
        }
        .oc-form-grid-2 {
          display: grid;
          grid-template-columns: 1.4fr 1fr;
          gap: 10px;
        }
        @media (max-width: 600px) {
          .oc-form-grid-3,
          .oc-form-grid-2 {
            grid-template-columns: 1fr;
          }
        }
        .oc-form-label {
          font-size: 12px;
          font-weight: 600;
          color: #475569;
        }
        .oc-form-hint {
          font-size: 11px;
          color: #94a3b8;
          margin-top: 2px;
        }
        .oc-required {
          color: #dc2626;
        }
        .oc-form-input {
          padding: 9px 12px;
          font-size: 14px;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          background: #fff;
          color: #1f2937;
          font-family: inherit;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .oc-form-input:focus {
          border-color: #7c3aed;
          box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1);
        }
        .oc-form-input.has-error {
          border-color: #dc2626;
        }
        .oc-form-textarea {
          resize: vertical;
          min-height: 64px;
        }
        .oc-form-error {
          font-size: 11px;
          color: #dc2626;
        }

        .oc-conversao {
          padding: 8px 12px;
          background: #faf5ff;
          border: 1px solid #e9d5ff;
          border-radius: 6px;
          font-size: 13px;
          color: #6b21a8;
          display: flex;
          justify-content: space-between;
        }

        /* 🆕 Aviso de câmbio em COBRAR */
        .oc-info-aviso {
          padding: 10px 12px;
          background: #f0f9ff;
          border: 1px solid #bae6fd;
          border-radius: 8px;
          font-size: 12.5px;
          color: #075985;
          line-height: 1.5;
        }

        /* === Flags === */
        .oc-flags {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px;
          background: #f8fafc;
          border-radius: 8px;
        }
        .oc-checkbox {
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
        }
        .oc-checkbox input {
          width: 16px;
          height: 16px;
          cursor: pointer;
        }
        .oc-checkbox span {
          flex: 1;
        }
        .oc-checkbox strong {
          display: block;
          font-size: 13px;
          color: #1f2937;
        }
        .oc-checkbox small {
          display: block;
          font-size: 11px;
          color: #64748b;
        }

        /* === Footer === */
        .oc-modal-footer {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          padding-top: 12px;
          margin-top: 4px;
          border-top: 1px solid #f1f5f9;
        }
        .oc-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 9px 18px;
          font-size: 14px;
          font-weight: 500;
          border-radius: 8px;
          cursor: pointer;
          border: 1px solid transparent;
          font-family: inherit;
          transition: background 0.15s, opacity 0.15s;
        }
        .oc-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .oc-btn__icon {
          width: 14px;
          height: 14px;
        }
        .oc-btn--ghost {
          background: #fff;
          border-color: #cbd5e1;
          color: #475569;
        }
        .oc-btn--ghost:hover:not(:disabled) {
          background: #f1f5f9;
        }
        .oc-btn--primary {
          background: #7c3aed;
          color: #fff;
        }
        .oc-btn--primary:hover:not(:disabled) {
          background: #6d28d9;
        }
      `}</style>
    </div>
  )
}

export default NovoOutroCustoModal
// src/components/kanban/ProcessoFaturas.tsx

"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { 
  Plus,
  DollarSign,
  Calendar,
  Check,
  X,
  AlertCircle,
  Clock,
  Trash2,
  Receipt,
  TrendingDown,
  ChevronDown,
  ChevronUp
} from "lucide-react"
import { TabelaCustos } from "./TabelaCustos"
import { DatePickerField } from "@/components/ui/date-picker-field"

interface Pagamento {
  id: number
  valor: number | string
  data: string
  formaPagamento: string | null
  comprovanteUrl: string | null
  comprovanteNome: string | null
  observacao: string | null
}

interface Fatura {
  id: number
  processoId: number
  descricao: string
  valor: number | string
  status: 'PENDENTE' | 'PAGO' | 'VENCIDO' | 'PARCIAL'
  dataEmissao: string
  dataVencimento: string | null
  observacoes: string | null
  // Calculados
  valorPago: number
  valorRestante: number
  // Histórico de pagamentos
  pagamentos: Pagamento[]
}

interface Totais {
  total: number
  pago: number
  pendente: number
  vencido: number
}

interface ProcessoFaturasProps {
  processoId: number
  nomeFamilia?: string
  onUpdate?: () => void
}

const STATUS_CONFIG = {
  PENDENTE: { 
    label: 'Pendente', 
    color: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    icon: Clock 
  },
  PAGO: { 
    label: 'Pago', 
    color: 'bg-green-100 text-green-700 border-green-200',
    icon: Check 
  },
  VENCIDO: { 
    label: 'Vencido', 
    color: 'bg-red-100 text-red-700 border-red-200',
    icon: AlertCircle 
  },
  PARCIAL: { 
    label: 'Parcial', 
    color: 'bg-orange-100 text-orange-700 border-orange-200',
    icon: TrendingDown 
  },
}

const FORMAS_PAGAMENTO = [
  { value: 'PIX', label: 'PIX' },
  { value: 'CARTAO_CREDITO', label: 'Cartão de Crédito' },
  { value: 'CARTAO_DEBITO', label: 'Cartão de Débito' },
  { value: 'BOLETO', label: 'Boleto' },
  { value: 'TRANSFERENCIA', label: 'Transferência' },
  { value: 'DINHEIRO', label: 'Dinheiro' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'OUTRO', label: 'Outro' },
]

export function ProcessoFaturas({ processoId, nomeFamilia, onUpdate }: ProcessoFaturasProps) {
  const [faturas, setFaturas] = useState<Fatura[]>([])
  const [totais, setTotais] = useState<Totais>({ total: 0, pago: 0, pendente: 0, vencido: 0 })
  const [loading, setLoading] = useState(true)
  
  // Controle de seções
  const [showCustos, setShowCustos] = useState(true)
  const [showFaturas, setShowFaturas] = useState(true)
  
  // Modais
  const [showNovaFatura, setShowNovaFatura] = useState(false)
  const [showPagar, setShowPagar] = useState<Fatura | null>(null)
  const [expandedFatura, setExpandedFatura] = useState<number | null>(null)
  
  // Form nova fatura
  const [novaDescricao, setNovaDescricao] = useState('')
  const [novaValor, setNovaValor] = useState('')
  const [novaVencimento, setNovaVencimento] = useState('')
  const [novaObservacao, setNovaObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  
  // Form pagar
  const [pagarForma, setPagarForma] = useState('')
  const [pagarValor, setPagarValor] = useState('')
  const [pagarData, setPagarData] = useState('')
  const [pagarObservacao, setPagarObservacao] = useState('')

  useEffect(() => {
    carregarFaturas()
  }, [processoId])

  const carregarFaturas = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/processos/${processoId}/faturas`)
      if (response.ok) {
        const data = await response.json()
        setFaturas(data.faturas || [])
        setTotais(data.totais || { total: 0, pago: 0, pendente: 0, vencido: 0 })
      }
    } catch (error) {
      console.error('Erro ao carregar faturas:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCriarFatura = async () => {
    if (!novaDescricao || !novaValor) return

    try {
      setSalvando(true)
      const response = await fetch(`/api/processos/${processoId}/faturas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          descricao: novaDescricao,
          valor: novaValor,
          dataVencimento: novaVencimento || null,
          observacoes: novaObservacao || null
        })
      })

      if (response.ok) {
        setShowNovaFatura(false)
        setNovaDescricao('')
        setNovaValor('')
        setNovaVencimento('')
        setNovaObservacao('')
        carregarFaturas()
        onUpdate?.()
      }
    } catch (error) {
      console.error('Erro ao criar fatura:', error)
    } finally {
      setSalvando(false)
    }
  }

  const handlePagar = async () => {
    if (!showPagar) return

    try {
      setSalvando(true)
      const response = await fetch(`/api/processos/${processoId}/faturas/${showPagar.id}/pagar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formaPagamento: pagarForma || null,
          valorPago: pagarValor || null,
          dataPagamento: pagarData || null,
          observacao: pagarObservacao || null
        })
      })

      if (response.ok) {
        setShowPagar(null)
        setPagarForma('')
        setPagarValor('')
        setPagarData('')
        setPagarObservacao('')
        carregarFaturas()
        onUpdate?.()
      }
    } catch (error) {
      console.error('Erro ao pagar fatura:', error)
    } finally {
      setSalvando(false)
    }
  }

  const handleExcluir = async (fatura: Fatura) => {
    if (!confirm('Tem certeza que deseja excluir esta fatura? Esta ação não pode ser desfeita.')) return

    try {
      const response = await fetch(`/api/processos/${processoId}/faturas/${fatura.id}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        carregarFaturas()
        onUpdate?.()
      }
    } catch (error) {
      console.error('Erro ao excluir fatura:', error)
    }
  }

  const formatarMoeda = (valor: number | string) => {
    const num = typeof valor === 'string' ? parseFloat(valor) : valor
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  }

  const formatarData = (data: string | null) => {
    if (!data) return '-'
    return new Date(data).toLocaleDateString('pt-BR')
  }

  return (
    <div className="h-full flex flex-col bg-gray-50 overflow-y-auto">
      {/* ===== SEÇÃO: TABELA DE CUSTOS ===== */}
      <div className="bg-white border-b">
        <div
          onClick={() => setShowCustos(!showCustos)}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <DollarSign className="h-5 w-5 text-amber-600" />
            </div>
            <div className="text-left">
              <h3 className="font-semibold text-gray-900">Custos por Pessoa</h3>
              <p className="text-sm text-gray-500">Planilha de custos detalhada</p>
            </div>
          </div>
          {showCustos ? (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          )}
        </div>
        
        {showCustos && (
          <div className="px-6 pb-6">
            <TabelaCustos processoId={processoId} nomeFamilia={nomeFamilia} />
          </div>
        )}
      </div>

      {/* Divisor visual */}
      <div className="h-2 bg-gray-100" />

      {/* ===== SEÇÃO: FATURAS ===== */}
      <div className="flex-1 flex flex-col">
        <div className="bg-white border-b">
          <div
            onClick={() => setShowFaturas(!showFaturas)}
            className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 rounded-lg">
                <Receipt className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="text-left">
                <h3 className="font-semibold text-gray-900">Faturas</h3>
                <p className="text-sm text-gray-500">{faturas.length} fatura(s)</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button 
                onClick={(e) => {
                  e.stopPropagation()
                  setShowNovaFatura(true)
                }}
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                <Plus className="h-4 w-4 mr-1" />
                Nova Fatura
              </Button>
              {showFaturas ? (
                <ChevronUp className="h-5 w-5 text-gray-400" />
              ) : (
                <ChevronDown className="h-5 w-5 text-gray-400" />
              )}
            </div>
          </div>

          {/* Totalizadores */}
          {showFaturas && (
            <div className="px-6 pb-4">
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 uppercase font-medium">Total</p>
                  <p className="text-lg font-bold text-gray-900">{formatarMoeda(totais.total)}</p>
                </div>
                <div className="bg-green-50 rounded-lg p-3">
                  <p className="text-xs text-green-600 uppercase font-medium">Recebido</p>
                  <p className="text-lg font-bold text-green-700">{formatarMoeda(totais.pago)}</p>
                </div>
                <div className="bg-yellow-50 rounded-lg p-3">
                  <p className="text-xs text-yellow-600 uppercase font-medium">Pendente</p>
                  <p className="text-lg font-bold text-yellow-700">{formatarMoeda(totais.pendente)}</p>
                </div>
                <div className="bg-red-50 rounded-lg p-3">
                  <p className="text-xs text-red-600 uppercase font-medium">Vencido</p>
                  <p className="text-lg font-bold text-red-700">{formatarMoeda(totais.vencido)}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Lista de faturas */}
        {showFaturas && (
          <div className="flex-1 p-6">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-64">
                <div className="animate-spin h-8 w-8 border-2 border-gray-200 border-t-emerald-500 rounded-full mb-3" />
                <p className="text-gray-500 text-sm">Carregando faturas...</p>
              </div>
            ) : faturas.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="p-4 bg-gray-100 rounded-full mb-4">
                  <Receipt className="h-10 w-10 text-gray-300" />
                </div>
                <h4 className="text-gray-700 font-medium mb-1">Nenhuma fatura</h4>
                <p className="text-gray-500 text-sm max-w-xs mb-4">
                  Clique em "Nova Fatura" para adicionar
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {faturas.map((fatura) => {
                  const config = STATUS_CONFIG[fatura.status]
                  const StatusIcon = config.icon
                  const isExpanded = expandedFatura === fatura.id

                  return (
                    <div
                      key={fatura.id}
                      className="bg-white rounded-xl border shadow-sm overflow-hidden"
                    >
                      {/* Linha principal */}
                      <div 
                        className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                        onClick={() => setExpandedFatura(isExpanded ? null : fatura.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4 flex-1">
                            <div className={`p-2 rounded-lg ${config.color}`}>
                              <StatusIcon className="h-4 w-4" />
                            </div>

                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-gray-900 truncate">
                                {fatura.descricao}
                              </p>
                              <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {formatarData(fatura.dataEmissao)}
                                </span>
                                {fatura.dataVencimento && (
                                  <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    Venc: {formatarData(fatura.dataVencimento)}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="text-right">
                              <p className="font-bold text-gray-900 text-lg">
                                {formatarMoeda(fatura.valor)}
                              </p>
                              <span className={`
                                inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border
                                ${config.color}
                              `}>
                                {config.label}
                              </span>
                            </div>

                            <button className="text-gray-400 hover:text-gray-600 ml-2">
                              {isExpanded ? (
                                <ChevronUp className="h-5 w-5" />
                              ) : (
                                <ChevronDown className="h-5 w-5" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Detalhes expandidos */}
                      {isExpanded && (
                        <div className="border-t bg-gray-50 p-4">
                          {/* Resumo financeiro */}
                          <div className="grid grid-cols-3 gap-4 mb-4 p-3 bg-white rounded-lg border">
                            <div>
                              <p className="text-xs text-gray-500 uppercase">Valor Total</p>
                              <p className="text-sm font-bold text-gray-900">{formatarMoeda(fatura.valor)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 uppercase">Pago</p>
                              <p className="text-sm font-bold text-green-600">{formatarMoeda(fatura.valorPago)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 uppercase">Restante</p>
                              <p className="text-sm font-bold text-orange-600">{formatarMoeda(fatura.valorRestante)}</p>
                            </div>
                          </div>

                          {/* Histórico de pagamentos */}
                          {fatura.pagamentos && fatura.pagamentos.length > 0 && (
                            <div className="mb-4">
                              <p className="text-xs text-gray-500 uppercase mb-2">Histórico de Pagamentos</p>
                              <div className="space-y-2">
                                {fatura.pagamentos.map((pag, idx) => (
                                  <div key={pag.id} className="flex items-center justify-between p-2 bg-white rounded border text-sm">
                                    <div className="flex items-center gap-3">
                                      <span className="text-gray-400">#{idx + 1}</span>
                                      <span className="font-medium text-green-600">{formatarMoeda(pag.valor)}</span>
                                      <span className="text-gray-500">{formatarData(pag.data)}</span>
                                    </div>
                                    <span className="text-gray-500">
                                      {FORMAS_PAGAMENTO.find(f => f.value === pag.formaPagamento)?.label || pag.formaPagamento || '-'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {fatura.observacoes && (
                            <div className="mb-4">
                              <p className="text-xs text-gray-500 uppercase">Observações</p>
                              <p className="text-sm">{fatura.observacoes}</p>
                            </div>
                          )}

                          {/* Ações */}
                          <div className="flex items-center gap-2 pt-3 border-t">
                            {fatura.status !== 'PAGO' && (
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setPagarValor(String(fatura.valorRestante))
                                  setPagarData(new Date().toISOString().split('T')[0])
                                  setShowPagar(fatura)
                                }}
                                className="bg-green-600 hover:bg-green-700"
                              >
                                <Check className="h-4 w-4 mr-1" />
                                {fatura.status === 'PARCIAL' ? 'Registrar Pagamento' : 'Marcar como Pago'}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleExcluir(fatura)
                              }}
                              className="text-red-500 hover:text-red-600 hover:bg-red-50 ml-auto"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal Nova Fatura */}
      {showNovaFatura && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-gray-900">Nova Fatura</h3>
              <button 
                onClick={() => setShowNovaFatura(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Descrição *
                </label>
                <Input
                  value={novaDescricao}
                  onChange={(e) => setNovaDescricao(e.target.value)}
                  placeholder="Ex: Busca documental, Tradução..."
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Valor *
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">R$</span>
                  <Input
                    type="number"
                    step="0.01"
                    value={novaValor}
                    onChange={(e) => setNovaValor(e.target.value)}
                    className="pl-10"
                    placeholder="0,00"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Data de Vencimento
                </label>
                <DatePickerField
                  value={novaVencimento}
                  onChange={setNovaVencimento}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Observações
                </label>
                <textarea
                  value={novaObservacao}
                  onChange={(e) => setNovaObservacao(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm resize-none"
                  rows={3}
                  placeholder="Notas adicionais..."
                />
              </div>
            </div>
            
            <div className="flex justify-end gap-2 p-4 border-t bg-gray-50">
              <Button
                variant="outline"
                onClick={() => setShowNovaFatura(false)}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleCriarFatura}
                disabled={!novaDescricao || !novaValor || salvando}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {salvando ? 'Salvando...' : 'Criar Fatura'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Pagar */}
      {showPagar && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-gray-900">Registrar Pagamento</h3>
              <button 
                onClick={() => setShowPagar(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="p-4">
              <div className="bg-gray-50 rounded-lg p-3 mb-4">
                <p className="text-sm text-gray-500">Fatura</p>
                <p className="font-medium">{showPagar.descricao}</p>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <div>
                    <p className="text-xs text-gray-500">Total</p>
                    <p className="font-bold text-gray-900">{formatarMoeda(showPagar.valor)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Pago</p>
                    <p className="font-bold text-green-600">{formatarMoeda(showPagar.valorPago)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Restante</p>
                    <p className="font-bold text-orange-600">{formatarMoeda(showPagar.valorRestante)}</p>
                  </div>
                </div>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Forma de Pagamento
                  </label>
                  <select
                    value={pagarForma}
                    onChange={(e) => setPagarForma(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  >
                    <option value="">Selecione...</option>
                    {FORMAS_PAGAMENTO.map(f => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Valor do Pagamento
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">R$</span>
                    <Input
                      type="number"
                      step="0.01"
                      value={pagarValor}
                      onChange={(e) => setPagarValor(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Informe o valor total para quitar ou um valor menor para pagamento parcial
                  </p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Data do Pagamento
                  </label>
                  <DatePickerField
                    value={pagarData}
                    onChange={setPagarData}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Observação (opcional)
                  </label>
                  <Input
                    value={pagarObservacao}
                    onChange={(e) => setPagarObservacao(e.target.value)}
                    placeholder="Ex: Pix de fulano, referente a..."
                  />
                </div>
              </div>
            </div>
            
            <div className="flex justify-end gap-2 p-4 border-t bg-gray-50">
              <Button
                variant="outline"
                onClick={() => setShowPagar(null)}
              >
                Cancelar
              </Button>
              <Button
                onClick={handlePagar}
                disabled={salvando}
                className="bg-green-600 hover:bg-green-700"
              >
                <Check className="h-4 w-4 mr-2" />
                {salvando ? 'Processando...' : 'Confirmar Pagamento'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
// src/components/kanban/ProcessoFaturas.tsx
// ATUALIZADO - Com suporte a moedas, parcelas e destinatários
// ✅ NOVO: Lista de parcelas de boleto com marcação individual

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
  ChevronUp,
  Users,
  Coins,
  CreditCard,
  CircleDot,
  CheckCircle2
} from "lucide-react"
import { TabelaCustos } from "./TabelaCustos"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { NovaFaturaModal } from "./NovaFaturaModal"

// ========================================
// TYPES
// ========================================
interface Requerente {
  id: number
  nome: string
  cpf?: string | null
  endereco?: string | null
  numero?: string | null
  bairro?: string | null
  cidade?: string | null
  estado?: string | null
  cep?: string | null
}

interface Pagamento {
  id: number
  valor: number
  data: string
  formaPagamento: string | null
  comprovanteUrl: string | null
  comprovanteNome: string | null
  observacao: string | null
}

// ✅ NOVO: Interface para Parcela
interface Parcela {
  id: number
  numero: number
  valor: number
  dataVencimento: string
  pago: boolean
  dataPagamento: string | null
}

interface Fatura {
  id: number
  processoId: number
  descricao: string
  moeda: 'BRL' | 'EUR' | 'USD'
  valorOriginal: number | null
  cambio: number | null
  valor: number
  metodoPagamento: string | null
  parcelas: number
  valorParcela: number | null
  status: 'PENDENTE' | 'PAGO' | 'VENCIDO' | 'PARCIAL'
  dataEmissao: string
  dataVencimento: string | null
  observacoes: string | null
  valorPago: number
  valorRestante: number
  pagamentos: Pagamento[]
  destinatarios: Requerente[]
  // ✅ NOVO: Lista de parcelas do boleto
  parcelasBoleto?: Parcela[]
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

// ========================================
// CONSTANTS
// ========================================
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

const FORMAS_PAGAMENTO: Record<string, string> = {
  PIX: 'PIX',
  CARTAO_CREDITO: 'Cartão de Crédito',
  CARTAO_DEBITO: 'Cartão de Débito',
  BOLETO: 'Boleto',
  TRANSFERENCIA: 'Transferência',
  DINHEIRO: 'Dinheiro',
  CHEQUE: 'Cheque',
  OUTRO: 'Outro',
}

const MOEDA_SYMBOLS: Record<string, string> = {
  BRL: 'R$',
  EUR: '€',
  USD: '$'
}

// ========================================
// COMPONENT
// ========================================
export function ProcessoFaturas({ processoId, nomeFamilia, onUpdate }: ProcessoFaturasProps) {
  const [faturas, setFaturas] = useState<Fatura[]>([])
  const [totais, setTotais] = useState<Totais>({ total: 0, pago: 0, pendente: 0, vencido: 0 })
  const [requerentes, setRequerentes] = useState<Requerente[]>([])
  const [loading, setLoading] = useState(true)
  
  // Controle de seções
  const [showCustos, setShowCustos] = useState(true)
  const [showFaturas, setShowFaturas] = useState(true)
  
  // Modais
  const [showNovaFatura, setShowNovaFatura] = useState(false)
  const [showPagar, setShowPagar] = useState<Fatura | null>(null)
  const [expandedFatura, setExpandedFatura] = useState<number | null>(null)
  
  // ✅ NOVO: Modal de confirmação de parcela
  const [confirmarParcela, setConfirmarParcela] = useState<{
    fatura: Fatura
    parcela: Parcela
  } | null>(null)
  const [salvandoParcela, setSalvandoParcela] = useState(false)
  
  // Form pagar
  const [pagarForma, setPagarForma] = useState('')
  const [pagarValor, setPagarValor] = useState('')
  const [pagarData, setPagarData] = useState('')
  const [pagarObservacao, setPagarObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)

  // ========================================
  // DATA LOADING
  // ========================================
  useEffect(() => {
    carregarDados()
  }, [processoId])

  const carregarDados = async () => {
    try {
      setLoading(true)
      
      // Carregar faturas e requerentes em paralelo
      const [faturasRes, processoRes] = await Promise.all([
        fetch(`/api/processos/${processoId}/faturas`),
        fetch(`/api/processos/${processoId}`)
      ])
      
      if (faturasRes.ok) {
        const data = await faturasRes.json()
        setFaturas(data.faturas || [])
        setTotais(data.totais || { total: 0, pago: 0, pendente: 0, vencido: 0 })
      }
      
      if (processoRes.ok) {
        const data = await processoRes.json()
        const reqs = data.processo?.requerentes || []
        setRequerentes(reqs)
      }
    } catch (error) {
      console.error('Erro ao carregar dados:', error)
    } finally {
      setLoading(false)
    }
  }

  // ========================================
  // HANDLERS
  // ========================================
  
  // ✅ NOVO: Marcar parcela como paga
  const handleMarcarParcelaPaga = async () => {
    if (!confirmarParcela) return

    try {
      setSalvandoParcela(true)
      
      const { fatura, parcela } = confirmarParcela
      
      const response = await fetch(
        `/api/processos/${processoId}/faturas/${fatura.id}/parcelas/${parcela.id}/pagar`,
        { method: 'POST' }
      )

      if (response.ok) {
        setConfirmarParcela(null)
        carregarDados()
        onUpdate?.()
      }
    } catch (error) {
      console.error('Erro ao marcar parcela como paga:', error)
    } finally {
      setSalvandoParcela(false)
    }
  }

  // ✅ NOVO: Desmarcar parcela
  const handleDesmarcarParcela = async (fatura: Fatura, parcela: Parcela) => {
    if (!confirm('Desmarcar esta parcela como não paga?')) return

    try {
      const response = await fetch(
        `/api/processos/${processoId}/faturas/${fatura.id}/parcelas/${parcela.id}/pagar`,
        { method: 'DELETE' }
      )

      if (response.ok) {
        carregarDados()
        onUpdate?.()
      }
    } catch (error) {
      console.error('Erro ao desmarcar parcela:', error)
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
        carregarDados()
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
        carregarDados()
        onUpdate?.()
      }
    } catch (error) {
      console.error('Erro ao excluir fatura:', error)
    }
  }

  // ========================================
  // FORMATTERS
  // ========================================
  const formatarMoeda = (valor: number, moeda: string = 'BRL') => {
    return valor.toLocaleString('pt-BR', { 
      style: 'currency', 
      currency: moeda === 'BRL' ? 'BRL' : moeda 
    })
  }

  const formatarData = (data: string | null) => {
    if (!data) return '-'
    return new Date(data).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
  }

  // ✅ NOVO: Verificar se parcela está vencida
  const isParcelaVencida = (parcela: Parcela) => {
    if (parcela.pago) return false
    
    const hoje = new Date()
    hoje.setUTCHours(0, 0, 0, 0)
    
    const vencimento = new Date(parcela.dataVencimento)
    vencimento.setUTCHours(0, 0, 0, 0)
    
    return vencimento < hoje
  }

  // ========================================
  // RENDER
  // ========================================
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
                  const temMoedaEstrangeira = fatura.moeda !== 'BRL'
                  const isBoleto = fatura.metodoPagamento === 'BOLETO'
                  const temParcelas = fatura.parcelasBoleto && fatura.parcelasBoleto.length > 0

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
                              <div className="flex items-center gap-3 mt-1 text-sm text-gray-500 flex-wrap">
                                {fatura.metodoPagamento && (
                                  <span className="flex items-center gap-1">
                                    <CreditCard className="h-3 w-3" />
                                    {FORMAS_PAGAMENTO[fatura.metodoPagamento] || fatura.metodoPagamento}
                                  </span>
                                )}
                                {temMoedaEstrangeira && (
                                  <span className="flex items-center gap-1 text-blue-600">
                                    <Coins className="h-3 w-3" />
                                    {fatura.moeda}
                                  </span>
                                )}
                                {fatura.parcelas > 1 && (
                                  <span className="text-amber-600 font-medium">
                                    {fatura.parcelas}x
                                  </span>
                                )}
                                {fatura.dataVencimento && (
                                  <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    Venc: {formatarData(fatura.dataVencimento)}
                                  </span>
                                )}
                                {fatura.destinatarios?.length > 0 && (
                                  <span className="flex items-center gap-1">
                                    <Users className="h-3 w-3" />
                                    {fatura.destinatarios.length} pessoa(s)
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="text-right">
                              <p className="font-bold text-gray-900 text-lg">
                                {formatarMoeda(fatura.valor)}
                              </p>
                              {temMoedaEstrangeira && fatura.valorOriginal && (
                                <p className="text-xs text-blue-600">
                                  {MOEDA_SYMBOLS[fatura.moeda]} {fatura.valorOriginal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </p>
                              )}
                              <span className={`
                                inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border mt-1
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
                          {/* Destinatários */}
                          {fatura.destinatarios?.length > 0 && (
                            <div className="mb-4">
                              <p className="text-xs text-gray-500 uppercase mb-2 flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                Destinatários
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {fatura.destinatarios.map(dest => (
                                  <span 
                                    key={dest.id}
                                    className="px-2 py-1 bg-white border rounded-lg text-sm"
                                  >
                                    {dest.nome}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* ✅ NOVO: Lista de Parcelas para Boletos */}
                          {isBoleto && temParcelas && (
                            <div className="mb-4">
                              <p className="text-xs text-gray-500 uppercase mb-3 flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                Parcelas do Boleto
                              </p>
                              <div className="bg-white rounded-lg border overflow-hidden">
                                <div className="grid grid-cols-[auto_1fr_auto_auto] gap-4 p-3 bg-gray-100 text-xs font-medium text-gray-600 uppercase">
                                  <span></span>
                                  <span>Vencimento</span>
                                  <span className="text-right">Valor</span>
                                  <span className="text-center">Ação</span>
                                </div>
                                <div className="divide-y">
                                  {fatura.parcelasBoleto!.map((parcela) => {
                                    const vencida = isParcelaVencida(parcela)
                                    
                                    return (
                                      <div 
                                        key={parcela.id}
                                        className={`
                                          grid grid-cols-[auto_1fr_auto_auto] gap-4 p-3 items-center
                                          ${parcela.pago ? 'bg-green-50' : vencida ? 'bg-red-50' : ''}
                                        `}
                                      >
                                        {/* Número da parcela */}
                                        <div className="flex items-center gap-2">
                                          {parcela.pago ? (
                                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                                          ) : vencida ? (
                                            <AlertCircle className="h-5 w-5 text-red-500" />
                                          ) : (
                                            <CircleDot className="h-5 w-5 text-gray-400" />
                                          )}
                                          <span className={`
                                            font-medium
                                            ${parcela.pago ? 'text-green-700' : vencida ? 'text-red-700' : 'text-gray-700'}
                                          `}>
                                            {parcela.numero}/{fatura.parcelas}
                                          </span>
                                        </div>

                                        {/* Data de vencimento */}
                                        <div>
                                          <span className={`
                                            ${parcela.pago ? 'text-green-700' : vencida ? 'text-red-700 font-medium' : 'text-gray-700'}
                                          `}>
                                            {formatarData(parcela.dataVencimento)}
                                          </span>
                                          {parcela.pago && parcela.dataPagamento && (
                                            <span className="text-xs text-green-600 ml-2">
                                              (pago em {formatarData(parcela.dataPagamento)})
                                            </span>
                                          )}
                                          {vencida && !parcela.pago && (
                                            <span className="text-xs text-red-600 ml-2">
                                              Vencida
                                            </span>
                                          )}
                                        </div>

                                        {/* Valor */}
                                        <div className={`
                                          text-right font-medium
                                          ${parcela.pago ? 'text-green-700' : vencida ? 'text-red-700' : 'text-gray-900'}
                                        `}>
                                          {formatarMoeda(parcela.valor)}
                                        </div>

                                        {/* Botão de ação */}
                                        <div className="flex justify-center">
                                          {parcela.pago ? (
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                handleDesmarcarParcela(fatura, parcela)
                                              }}
                                              className="text-xs text-gray-500 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                                            >
                                              Desfazer
                                            </button>
                                          ) : (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                setConfirmarParcela({ fatura, parcela })
                                              }}
                                              className={`
                                                text-xs h-8
                                                ${vencida 
                                                  ? 'border-red-300 text-red-700 hover:bg-red-100' 
                                                  : 'border-green-300 text-green-700 hover:bg-green-100'
                                                }
                                              `}
                                            >
                                              <Check className="h-3 w-3 mr-1" />
                                              Marcar Pago
                                            </Button>
                                          )}
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                                {/* Resumo das parcelas */}
                                <div className="grid grid-cols-2 gap-4 p-3 bg-gray-100 border-t">
                                  <div className="text-sm">
                                    <span className="text-gray-600">Pagas: </span>
                                    <span className="font-medium text-green-700">
                                      {fatura.parcelasBoleto!.filter(p => p.pago).length} de {fatura.parcelas}
                                    </span>
                                  </div>
                                  <div className="text-sm text-right">
                                    <span className="text-gray-600">Restante: </span>
                                    <span className="font-medium text-gray-900">
                                      {formatarMoeda(
                                        fatura.parcelasBoleto!
                                          .filter(p => !p.pago)
                                          .reduce((sum, p) => sum + p.valor, 0)
                                      )}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Resumo financeiro (para não-boletos ou boletos sem parcelas) */}
                          {(!isBoleto || !temParcelas) && (
                            <div className="grid grid-cols-3 gap-4 mb-4 p-3 bg-white rounded-lg border">
                              <div>
                                <p className="text-xs text-gray-500 uppercase">Valor Total</p>
                                <p className="text-sm font-bold text-gray-900">{formatarMoeda(fatura.valor)}</p>
                                {temMoedaEstrangeira && fatura.valorOriginal && (
                                  <p className="text-xs text-blue-600">
                                    ({MOEDA_SYMBOLS[fatura.moeda]} {fatura.valorOriginal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} × {fatura.cambio})
                                  </p>
                                )}
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
                          )}

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
                                    {pag.formaPagamento && (
                                      <span className="text-gray-500">
                                        {FORMAS_PAGAMENTO[pag.formaPagamento] || pag.formaPagamento}
                                      </span>
                                    )}
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
                            {/* Botão "Marcar como Pago" só aparece para não-boletos */}
                            {fatura.status !== 'PAGO' && !isBoleto && (
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

      {showNovaFatura && (
        <NovaFaturaModal
          processoId={processoId}
          requerentes={requerentes}
          onClose={() => setShowNovaFatura(false)}
          onSuccess={() => {
            carregarDados()
            onUpdate?.()
          }}
        />
      )}

      {/* ✅ NOVO: Modal de Confirmação de Parcela */}
      {confirmarParcela && (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setConfirmarParcela(null)}>
        <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-gray-900">Confirmar Pagamento</h3>
              <button 
                onClick={() => setConfirmarParcela(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="h-8 w-8 text-green-600" />
              </div>
              
              <p className="text-gray-700 mb-2">
                Marcar parcela <span className="font-bold">{confirmarParcela.parcela.numero}/{confirmarParcela.fatura.parcelas}</span> como paga?
              </p>
              
              <div className="bg-gray-50 rounded-lg p-3 mt-4 space-y-1">
                <p className="text-sm text-gray-600">
                  Valor: <span className="font-bold text-gray-900">{formatarMoeda(confirmarParcela.parcela.valor)}</span>
                </p>
                <p className="text-sm text-gray-600">
                  Vencimento: <span className="font-medium">{formatarData(confirmarParcela.parcela.dataVencimento)}</span>
                </p>
              </div>
            </div>
            
            <div className="flex gap-3 p-4 border-t bg-gray-50 rounded-b-xl">
              <Button
                variant="outline"
                onClick={() => setConfirmarParcela(null)}
                className="flex-1"
                disabled={salvandoParcela}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleMarcarParcelaPaga}
                disabled={salvandoParcela}
                className="flex-1 bg-green-600 hover:bg-green-700"
              >
                {salvandoParcela ? (
                  <span className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Salvando...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Check className="h-4 w-4" />
                    Confirmar
                  </span>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Pagar (para não-boletos) */}
      {showPagar && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowPagar(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
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
            
            <div className="flex justify-end gap-2 p-4 border-t bg-gray-50 rounded-b-xl">
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
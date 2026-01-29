"use client"

import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { 
  X,
  Users,
  Receipt,
  Coins,
  Calendar,
  FileText,
  ArrowRight,
  Check,
  AlertCircle
} from "lucide-react"
import { DatePickerField } from "@/components/ui/date-picker-field"

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

interface NovaFaturaModalProps {
  processoId: number
  requerentes: Requerente[]
  onClose: () => void
  onSuccess: () => void
}

type Moeda = 'BRL' | 'EUR' | 'USD'
type MetodoPagamento = 'PIX' | 'BOLETO' | 'TRANSFERENCIA' | 'CARTAO_CREDITO' | 'CARTAO_DEBITO' | 'DINHEIRO' | 'CHEQUE' | 'OUTRO'

// ========================================
// CONSTANTS
// ========================================
const MOEDAS: { value: Moeda; label: string; symbol: string }[] = [
  { value: 'BRL', label: 'Real (BRL)', symbol: 'R$' },
  { value: 'EUR', label: 'Euro (EUR)', symbol: '€' },
  { value: 'USD', label: 'Dólar (USD)', symbol: '$' },
]

const METODOS_PAGAMENTO: { value: MetodoPagamento; label: string }[] = [
  { value: 'BOLETO', label: 'Boleto Bancário' },
  { value: 'CARTAO_CREDITO', label: 'Cartão de Crédito' },
  { value: 'CARTAO_DEBITO', label: 'Cartão de Débito' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'DINHEIRO', label: 'Dinheiro' },
  { value: 'OUTRO', label: 'Outro' },
  { value: 'PIX', label: 'PIX' },
  { value: 'TRANSFERENCIA', label: 'Transferência Bancária' },
]

const PARCELAS_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

// ========================================
// COMPONENT
// ========================================
export function NovaFaturaModal({ 
  processoId, 
  requerentes, 
  onClose, 
  onSuccess 
}: NovaFaturaModalProps) {
  // Form state
  const [destinatarioIds, setDestinatarioIds] = useState<number[]>([])
  const [descricao, setDescricao] = useState('')
  const [metodoPagamento, setMetodoPagamento] = useState<MetodoPagamento>('PIX')
  const [moeda, setMoeda] = useState<Moeda>('BRL')
  const [valor, setValor] = useState('')
  const [cambio, setCambio] = useState('')
  const [parcelas, setParcelas] = useState(1)
  const [dataVencimento, setDataVencimento] = useState('')
  const [observacoes, setObservacoes] = useState('')
  
  // UI state
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  // ========================================
  // COMPUTED VALUES
  // ========================================
  const moedaConfig = useMemo(() => 
    MOEDAS.find(m => m.value === moeda) || MOEDAS[0]
  , [moeda])

  const valorNumerico = useMemo(() => {
    const num = parseFloat(valor.replace(',', '.'))
    return isNaN(num) ? 0 : num
  }, [valor])

  const cambioNumerico = useMemo(() => {
    const num = parseFloat(cambio.replace(',', '.'))
    return isNaN(num) ? 0 : num
  }, [cambio])

  const valorEmBRL = useMemo(() => {
    if (moeda === 'BRL') return valorNumerico
    if (!cambioNumerico) return 0
    return valorNumerico * cambioNumerico
  }, [moeda, valorNumerico, cambioNumerico])

  const valorParcela = useMemo(() => {
    if (parcelas <= 1) return valorEmBRL
    return valorEmBRL / parcelas
  }, [valorEmBRL, parcelas])

  const isBoleto = metodoPagamento === 'BOLETO'

  const canSubmit = useMemo(() => {
    if (!descricao.trim()) return false
    if (!valor || valorNumerico <= 0) return false
    if (moeda !== 'BRL' && (!cambio || cambioNumerico <= 0)) return false
    if (isBoleto && !dataVencimento) return false
    return true
  }, [descricao, valor, valorNumerico, moeda, cambio, cambioNumerico, isBoleto, dataVencimento])

  // ========================================
  // HANDLERS
  // ========================================
  const toggleDestinatario = (id: number) => {
    setDestinatarioIds(prev => 
      prev.includes(id) 
        ? prev.filter(d => d !== id)
        : [...prev, id]
    )
  }

  const selectAllDestinatarios = () => {
    if (destinatarioIds.length === requerentes.length) {
      setDestinatarioIds([])
    } else {
      setDestinatarioIds(requerentes.map(r => r.id))
    }
  }

  const formatarMoeda = (valor: number, currency: string = 'BRL') => {
    return valor.toLocaleString('pt-BR', { 
      style: 'currency', 
      currency: currency === 'BRL' ? 'BRL' : currency 
    })
  }

  const handleSubmit = async () => {
    if (!canSubmit) return

    try {
      setSalvando(true)
      setErro('')

      const payload = {
        descricao: descricao.trim(),
        moeda,
        valorOriginal: moeda !== 'BRL' ? valorNumerico : null,
        cambio: moeda !== 'BRL' ? cambioNumerico : null,
        valor: valorEmBRL,
        metodoPagamento,
        parcelas: isBoleto ? parcelas : 1,
        valorParcela: isBoleto && parcelas > 1 ? valorParcela : null,
        dataVencimento: isBoleto && dataVencimento ? dataVencimento : null,
        observacoes: observacoes.trim() || null,
        destinatarioIds: destinatarioIds.length > 0 ? destinatarioIds : null
      }

      const response = await fetch(`/api/processos/${processoId}/faturas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Erro ao criar fatura')
      }

      onSuccess()
      onClose()
    } catch (error) {
      console.error('Erro ao criar fatura:', error)
      setErro(error instanceof Error ? error.message : 'Erro ao criar fatura')
    } finally {
      setSalvando(false)
    }
  }

  // Reset parcelas quando muda método
  useEffect(() => {
    if (!isBoleto) {
      setParcelas(1)
      setDataVencimento('')
    }
  }, [isBoleto])

  // ========================================
  // RENDER
  // ========================================
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-emerald-500 to-emerald-600">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-lg">
              <Receipt className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Nova Fatura</h2>
              <p className="text-sm text-emerald-100">Preencha os dados da cobrança</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-white" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* Erro */}
          {erro && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {erro}
            </div>
          )}

          {/* Destinatários */}
          {requerentes.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <Users className="h-4 w-4 text-gray-400" />
                  Destinatário(s)
                </label>
                <button
                  type="button"
                  onClick={selectAllDestinatarios}
                  className="text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                >
                  {destinatarioIds.length === requerentes.length ? 'Desmarcar todos' : 'Selecionar todos'}
                </button>
              </div>
              <div className="space-y-2">
                {requerentes.map(req => {
                  const isSelected = destinatarioIds.includes(req.id)
                  const endereco = [req.endereco, req.numero, req.bairro, req.cidade, req.estado]
                    .filter(Boolean).join(', ')
                  
                  return (
                    <div
                      key={req.id}
                      onClick={() => toggleDestinatario(req.id)}
                      className={`
                        p-3 rounded-xl border-2 cursor-pointer transition-all
                        ${isSelected 
                          ? 'border-emerald-500 bg-emerald-50' 
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                        }
                      `}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`
                          w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors
                          ${isSelected 
                            ? 'bg-emerald-500 border-emerald-500' 
                            : 'border-gray-300'
                          }
                        `}>
                          {isSelected && <Check className="h-3 w-3 text-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900">{req.nome}</p>
                          {endereco && (
                            <p className="text-xs text-gray-500 truncate">{endereco}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Opcional. Selecione para vincular a fatura a pessoas específicas do processo.
              </p>
            </div>
          )}

          {/* Título da Fatura */}
            <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                <FileText className="h-4 w-4 text-gray-400" />
                Título da Fatura *
            </label>
            <Input
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Ex: Busca documental, Tradução juramentada, Honorários..."
                className="h-11"
            />
            </div>

          {/* Método + Moeda */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                Método de Pagamento
              </label>
              <select
                value={metodoPagamento}
                onChange={(e) => setMetodoPagamento(e.target.value as MetodoPagamento)}
                className="w-full h-11 px-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              >
                {METODOS_PAGAMENTO.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                <Coins className="h-4 w-4 text-gray-400" />
                Moeda
              </label>
              <select
                value={moeda}
                onChange={(e) => setMoeda(e.target.value as Moeda)}
                className="w-full h-11 px-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              >
                {MOEDAS.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Valor + Câmbio */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Valor *
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">
                  {moedaConfig.symbol}
                </span>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  className="h-11 pl-10"
                  placeholder="0,00"
                />
              </div>
            </div>
            
            {moeda !== 'BRL' && (
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  Câmbio (1 {moeda} = R$) *
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">
                    R$
                  </span>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={cambio}
                    onChange={(e) => setCambio(e.target.value)}
                    className="h-11 pl-10"
                    placeholder="6,20"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Valor convertido (quando moeda estrangeira) */}
          {moeda !== 'BRL' && valorNumerico > 0 && cambioNumerico > 0 && (
            <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-xl border border-blue-100">
              <div className="flex items-center gap-2 text-blue-700">
                <span className="font-medium">{moedaConfig.symbol} {valorNumerico.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                <ArrowRight className="h-4 w-4" />
                <span className="font-bold text-lg">{formatarMoeda(valorEmBRL)}</span>
              </div>
            </div>
          )}

          {/* Seção Boleto */}
          {isBoleto && (
            <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 space-y-4">
              <p className="text-sm font-medium text-amber-800 flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Configurações do Boleto
              </p>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-2 block">
                    Parcelas
                  </label>
                  <select
                    value={parcelas}
                    onChange={(e) => setParcelas(parseInt(e.target.value))}
                    className="w-full h-11 px-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 bg-white"
                  >
                    {PARCELAS_OPTIONS.map(p => (
                      <option key={p} value={p}>
                        {p}x {valorEmBRL > 0 && `de ${formatarMoeda(valorEmBRL / p)}`}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-2 block">
                    Vencimento *
                  </label>
                  <DatePickerField
                    value={dataVencimento}
                    onChange={setDataVencimento}
                  />
                </div>
              </div>

              {parcelas > 1 && valorEmBRL > 0 && (
                <div className="pt-3 border-t border-amber-200">
                  <p className="text-sm text-amber-800">
                    <span className="font-medium">{parcelas} parcelas</span> de{' '}
                    <span className="font-bold">{formatarMoeda(valorParcela)}</span>
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Observações */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Observações
            </label>
            <textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              rows={3}
              placeholder="Notas adicionais sobre esta fatura..."
            />
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between">
          {/* Resumo */}
          <div className="text-sm">
            {valorEmBRL > 0 && (
              <p className="text-gray-600">
                Total: <span className="font-bold text-gray-900 text-lg">{formatarMoeda(valorEmBRL)}</span>
              </p>
            )}
          </div>
          
          {/* Botões */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={salvando}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit || salvando}
              className="bg-emerald-600 hover:bg-emerald-700 min-w-[140px]"
            >
              {salvando ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Salvando...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Check className="h-4 w-4" />
                  Criar Fatura
                </span>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
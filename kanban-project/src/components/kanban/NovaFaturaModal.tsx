"use client"

import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { 
  X,
  Receipt,
  Coins,
  FileText,
  Check,
  AlertCircle,
  ArrowRight
} from "lucide-react"

// ========================================
// TYPES
// ========================================
interface NovaFaturaModalProps {
  processoId: number
  onClose: () => void
  onSuccess: () => void
}

type Moeda = 'BRL' | 'EUR' | 'USD'

// ========================================
// CONSTANTS
// ========================================
const MOEDAS: { value: Moeda; label: string; symbol: string }[] = [
  { value: 'BRL', label: 'Real (BRL)', symbol: 'R$' },
  { value: 'EUR', label: 'Euro (EUR)', symbol: '€' },
  { value: 'USD', label: 'Dólar (USD)', symbol: '$' },
]

// ========================================
// COMPONENT
// ========================================
export function NovaFaturaModal({ 
  processoId, 
  onClose, 
  onSuccess 
}: NovaFaturaModalProps) {
  // Form state
  const [descricao, setDescricao] = useState('')
  const [moeda, setMoeda] = useState<Moeda>('BRL')
  const [valor, setValor] = useState('')
  const [cambio, setCambio] = useState('')  // ✅ NOVO: Câmbio
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

  // ✅ NOVO: Valor convertido para BRL
  const valorEmBRL = useMemo(() => {
    if (moeda === 'BRL') return valorNumerico
    if (!cambioNumerico) return 0
    return valorNumerico * cambioNumerico
  }, [moeda, valorNumerico, cambioNumerico])

  const canSubmit = useMemo(() => {
    if (!descricao.trim()) return false
    if (!valor || valorNumerico <= 0) return false
    // Se moeda estrangeira, exige câmbio
    if (moeda !== 'BRL' && (!cambio || cambioNumerico <= 0)) return false
    return true
  }, [descricao, valor, valorNumerico, moeda, cambio, cambioNumerico])

  // ========================================
  // HANDLERS
  // ========================================
  const handleSubmit = async () => {
    if (!canSubmit) return

    try {
      setSalvando(true)
      setErro('')

      const payload = {
        descricao: descricao.trim(),
        moeda,
        valor: valorNumerico,
        cambio: moeda !== 'BRL' ? cambioNumerico : null,  // ✅ Enviar câmbio
        observacoes: observacoes.trim() || null
      }

      const response = await fetch(`/api/processos/${processoId}/faturas`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        },
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

  // ========================================
  // RENDER
  // ========================================
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col">
        
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
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          
          {/* Erro */}
          {erro && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {erro}
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

          {/* Moeda */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
              <Coins className="h-4 w-4 text-gray-400" />
              Moeda
            </label>
            <select
              value={moeda}
              onChange={(e) => {
                setMoeda(e.target.value as Moeda)
                if (e.target.value === 'BRL') setCambio('')
              }}
              className="w-full h-11 px-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            >
              {MOEDAS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* Valor */}
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

          {/* ✅ NOVO: Câmbio - apenas para moedas estrangeiras */}
          {moeda !== 'BRL' && (
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                <Coins className="h-4 w-4 text-gray-400" />
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
              <p className="text-xs text-gray-500 mt-1">
                Taxa de câmbio para conversão em Reais
              </p>
            </div>
          )}

          {/* ✅ NOVO: Preview da conversão */}
          {moeda !== 'BRL' && valorNumerico > 0 && cambioNumerico > 0 && (
            <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-xl border border-blue-100">
              <div className="flex items-center gap-2 text-blue-700 w-full justify-center">
                <span className="font-medium">
                  {moedaConfig.symbol} {valorNumerico.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
                <ArrowRight className="h-4 w-4" />
                <span className="font-bold text-lg">
                  R$ {valorEmBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </div>
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
        <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-end gap-3">
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
  )
}
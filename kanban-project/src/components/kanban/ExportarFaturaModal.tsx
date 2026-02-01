// src/components/kanban/ExportarFaturaModal.tsx
// Modal para exportar fatura(s) como PDF
// ATUALIZADO: Seleção individual de faturas + indicador de scroll

"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { 
  X, 
  FileDown, 
  User, 
  Check,
  FileText,
  ExternalLink,
  Receipt,
  AlertCircle,
  ChevronDown
} from "lucide-react"
import { 
  downloadFaturaPDF, 
  abrirFaturaPDF,
  downloadFaturaConsolidadaPDF,
  abrirFaturaConsolidadaPDF
} from "@/src/lib/gerarFaturaPDF"

// ========================================
// TYPES
// ========================================
interface Requerente {
  id: number
  nome: string
  cpf?: string | null
  endereco?: string | null
  numero?: string | null
  complemento?: string | null
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
  observacao: string | null
  cambio?: number | null  // Valor do câmbio
  destinatarios?: Requerente[]
}

interface Fatura {
  id: number
  processoId: number
  descricao: string
  moeda: 'BRL' | 'EUR' | 'USD'
  cambio?: number | null  // Câmbio da fatura
  valor: number
  dataEmissao: string
  dataVencimento: string | null
  observacoes: string | null
  destinatarios: Requerente[]
  pagamentos?: Pagamento[]
}

interface ExportarFaturaModalProps {
  faturas: Fatura[] // Todas as faturas do processo
  requerentes: Requerente[]
  onClose: () => void
}

const MOEDA_SYMBOLS: Record<string, string> = {
  BRL: 'R$',
  EUR: '€',
  USD: 'US$'
}

// Verificar se uma fatura está vinculada a um destinatário
// (seja diretamente na fatura OU via pagamentos)
const faturaTemDestinatario = (fatura: Fatura, destinatarioId: number): boolean => {
  // Verificar nos destinatários da fatura
  if (fatura.destinatarios?.some(d => d.id === destinatarioId)) {
    return true
  }
  
  // Verificar nos destinatários dos pagamentos
  if (fatura.pagamentos?.some(pag => 
    pag.destinatarios?.some(d => d.id === destinatarioId)
  )) {
    return true
  }
  
  return false
}

// ========================================
// COMPONENT
// ========================================
export function ExportarFaturaModal({ faturas, requerentes, onClose }: ExportarFaturaModalProps) {
  const [destinatarioSelecionado, setDestinatarioSelecionado] = useState<Requerente | null>(null)
  const [faturasSelecionadas, setFaturasSelecionadas] = useState<Set<number>>(new Set())
  const [gerando, setGerando] = useState(false)
  
  // Scroll indicator
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [showScrollIndicator, setShowScrollIndicator] = useState(false)

  // Verificar se precisa mostrar indicador de scroll
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const checkScroll = () => {
      const hasMoreContent = container.scrollHeight > container.clientHeight
      const notAtBottom = container.scrollTop + container.clientHeight < container.scrollHeight - 10
      setShowScrollIndicator(hasMoreContent && notAtBottom)
    }

    checkScroll()
    container.addEventListener('scroll', checkScroll)
    return () => container.removeEventListener('scroll', checkScroll)
  }, [requerentes])

  // Filtrar faturas pelo destinatário selecionado
  const faturasFiltradas = useMemo(() => {
    if (!destinatarioSelecionado) return []
    
    return faturas.filter(fatura => 
      faturaTemDestinatario(fatura, destinatarioSelecionado.id)
    )
  }, [faturas, destinatarioSelecionado])

  // Quando mudar destinatário, selecionar todas as faturas dele por padrão
  useEffect(() => {
    if (destinatarioSelecionado) {
      const ids = faturasFiltradas.map(f => f.id)
      setFaturasSelecionadas(new Set(ids))
    } else {
      setFaturasSelecionadas(new Set())
    }
  }, [destinatarioSelecionado, faturasFiltradas])

  // Faturas que serão exportadas (filtradas + selecionadas)
  const faturasParaExportar = useMemo(() => {
    return faturasFiltradas.filter(f => faturasSelecionadas.has(f.id))
  }, [faturasFiltradas, faturasSelecionadas])

  // Calcular totais por moeda das faturas selecionadas
  const totaisPorMoeda = useMemo(() => {
    const resultado: Record<string, number> = {}
    faturasParaExportar.forEach(f => {
      resultado[f.moeda] = (resultado[f.moeda] || 0) + f.valor
    })
    return resultado
  }, [faturasParaExportar])

  // Contar quantas faturas cada destinatário tem
  const contagemPorDestinatario = useMemo(() => {
    const contagem: Record<number, number> = {}
    
    // Para cada requerente, conta quantas faturas estão vinculadas a ele
    requerentes.forEach(req => {
      const qtd = faturas.filter(fatura => faturaTemDestinatario(fatura, req.id)).length
      contagem[req.id] = qtd
    })
    
    return contagem
  }, [faturas, requerentes])

  // ========================================
  // HANDLERS
  // ========================================
  
  const toggleFatura = (faturaId: number) => {
    setFaturasSelecionadas(prev => {
      const novo = new Set(prev)
      if (novo.has(faturaId)) {
        novo.delete(faturaId)
      } else {
        novo.add(faturaId)
      }
      return novo
    })
  }

  const selecionarTodasFaturas = () => {
    if (faturasSelecionadas.size === faturasFiltradas.length) {
      setFaturasSelecionadas(new Set())
    } else {
      setFaturasSelecionadas(new Set(faturasFiltradas.map(f => f.id)))
    }
  }

  const handleExportar = async (abrirNovaAba: boolean = false) => {
    if (!destinatarioSelecionado || faturasParaExportar.length === 0) return

    setGerando(true)
    
    try {
      const destinatario = {
        nome: destinatarioSelecionado.nome,
        cpf: destinatarioSelecionado.cpf,
        endereco: destinatarioSelecionado.endereco,
        numero: destinatarioSelecionado.numero,
        complemento: destinatarioSelecionado.complemento,
        bairro: destinatarioSelecionado.bairro,
        cidade: destinatarioSelecionado.cidade,
        estado: destinatarioSelecionado.estado,
        cep: destinatarioSelecionado.cep,
      }

      if (faturasParaExportar.length === 1) {
        // PDF Único
        const fatura = faturasParaExportar[0]
        const dadosFatura = {
          id: fatura.id,
          dataEmissao: fatura.dataEmissao,
          dataVencimento: fatura.dataVencimento,
          descricao: fatura.descricao,
          moeda: fatura.moeda,
          cambio: fatura.cambio,  // Incluir câmbio
          valor: fatura.valor,
          observacoes: fatura.observacoes,
          destinatario,
          pagamentos: fatura.pagamentos  // Incluir pagamentos
        }

        if (abrirNovaAba) {
          await abrirFaturaPDF(dadosFatura)
        } else {
          await downloadFaturaPDF(dadosFatura)
        }
      } else {
        // PDF Consolidado
        const dadosConsolidados = {
          faturas: faturasParaExportar.map(f => ({
            id: f.id,
            dataEmissao: f.dataEmissao,
            dataVencimento: f.dataVencimento,
            descricao: f.descricao,
            moeda: f.moeda,
            cambio: f.cambio,  // Incluir câmbio
            valor: f.valor,
            observacoes: f.observacoes,
            destinatario,
            pagamentos: f.pagamentos  // Incluir pagamentos
          })),
          destinatario,
          dataEmissao: new Date().toISOString()
        }

        if (abrirNovaAba) {
          await abrirFaturaConsolidadaPDF(dadosConsolidados)
        } else {
          await downloadFaturaConsolidadaPDF(dadosConsolidados)
        }
      }
      
      onClose()
    } catch (error) {
      console.error('Erro ao gerar PDF:', error)
      alert('Erro ao gerar PDF. Tente novamente.')
    } finally {
      setGerando(false)
    }
  }

  // ========================================
  // FORMATTERS
  // ========================================
  const formatarMoeda = (valor: number, moeda: string = 'BRL') => {
    return valor.toLocaleString('pt-BR', { 
      style: 'currency', 
      currency: moeda 
    })
  }

  const montarEnderecoResumido = (dest: Requerente): string => {
    const partes: string[] = []
    if (dest.cidade) partes.push(dest.cidade)
    if (dest.estado) partes.push(dest.estado)
    return partes.join(' - ') || 'Endereço não cadastrado'
  }

  // Contar destinatários com faturas
  const destinatariosComFaturas = requerentes.filter(r => contagemPorDestinatario[r.id] > 0).length
  const totalDestinatarios = requerentes.length

  // ========================================
  // RENDER
  // ========================================
  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" 
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-blue-500 to-blue-600">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-lg">
              <FileDown className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Exportar Faturas</h2>
              <p className="text-sm text-blue-100">Selecione o destinatário</p>
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
        <div className="flex-1 overflow-y-auto p-6">
          {/* Seleção de Destinatário */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <User className="h-4 w-4 text-gray-400" />
                Selecione o Destinatário
              </label>
              {totalDestinatarios > 2 && (
                <span className="text-xs text-gray-500">
                  {destinatariosComFaturas} de {totalDestinatarios} com faturas
                </span>
              )}
            </div>
            
            {requerentes.length === 0 ? (
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-xl text-center">
                <p className="text-yellow-700 text-sm">
                  Nenhum requerente cadastrado no processo.
                </p>
              </div>
            ) : (
              <div className="relative">
                <div 
                  ref={scrollContainerRef}
                  className="space-y-2 max-h-[180px] overflow-y-auto pr-1"
                >
                  {requerentes.map(dest => {
                    const isSelected = destinatarioSelecionado?.id === dest.id
                    const qtdFaturas = contagemPorDestinatario[dest.id] || 0
                    
                    return (
                      <div
                        key={dest.id}
                        onClick={() => setDestinatarioSelecionado(dest)}
                        className={`
                          p-3 rounded-xl border-2 cursor-pointer transition-all
                          ${isSelected 
                            ? 'border-blue-500 bg-blue-50' 
                            : 'border-gray-200 hover:border-gray-300 bg-white'
                          }
                          ${qtdFaturas === 0 ? 'opacity-50' : ''}
                        `}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`
                            w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors flex-shrink-0
                            ${isSelected 
                              ? 'bg-blue-500 border-blue-500' 
                              : 'border-gray-300'
                            }
                          `}>
                            {isSelected && <Check className="h-3 w-3 text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-gray-900 truncate">{dest.nome}</p>
                              {qtdFaturas > 0 ? (
                                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full flex-shrink-0">
                                  {qtdFaturas} fatura{qtdFaturas > 1 ? 's' : ''}
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded-full flex-shrink-0">
                                  Sem faturas
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 truncate">
                              {dest.cpf ? `CPF: ${dest.cpf}` : 'CPF não cadastrado'} • {montarEnderecoResumido(dest)}
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                
                {/* Indicador de scroll */}
                {showScrollIndicator && (
                  <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent pointer-events-none flex items-end justify-center pb-1">
                    <div className="flex items-center gap-1 text-xs text-gray-400 bg-white/80 px-2 py-1 rounded-full">
                      <ChevronDown className="h-3 w-3" />
                      Role para ver mais
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Faturas do Destinatário Selecionado */}
          {destinatarioSelecionado && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-gray-500" />
                  <span className="text-sm font-medium text-gray-700">
                    Faturas de {destinatarioSelecionado.nome.split(' ')[0]}
                  </span>
                </div>
                {faturasFiltradas.length > 1 && (
                  <button
                    onClick={selecionarTodasFaturas}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                  >
                    {faturasSelecionadas.size === faturasFiltradas.length ? 'Desmarcar todas' : 'Selecionar todas'}
                  </button>
                )}
              </div>

              {faturasFiltradas.length === 0 ? (
                <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl text-center">
                  <AlertCircle className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-gray-500 text-sm">
                    Nenhuma fatura vinculada a este destinatário.
                  </p>
                  <p className="text-gray-400 text-xs mt-1">
                    Vincule o destinatário às faturas para poder exportar.
                  </p>
                </div>
              ) : (
                <div className="bg-gray-50 rounded-xl p-4 border">
                  {/* Lista de faturas com checkboxes */}
                  <div className="space-y-2 max-h-[150px] overflow-y-auto mb-4">
                    {faturasFiltradas.map(fatura => {
                      const isSelected = faturasSelecionadas.has(fatura.id)
                      
                      return (
                        <div 
                          key={fatura.id}
                          onClick={() => toggleFatura(fatura.id)}
                          className={`
                            flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-all
                            ${isSelected 
                              ? 'bg-blue-50 border-blue-200' 
                              : 'bg-white border-gray-200 hover:border-gray-300'
                            }
                          `}
                        >
                          {/* Checkbox */}
                          <div className={`
                            w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors
                            ${isSelected 
                              ? 'bg-blue-500 border-blue-500' 
                              : 'border-gray-300 bg-white'
                            }
                          `}>
                            {isSelected && <Check className="h-3 w-3 text-white" />}
                          </div>
                          
                          <FileText className={`h-4 w-4 flex-shrink-0 ${isSelected ? 'text-blue-500' : 'text-gray-400'}`} />
                          
                          <span className={`text-sm flex-1 truncate ${isSelected ? 'text-gray-900' : 'text-gray-600'}`}>
                            {fatura.descricao}
                          </span>
                          
                          <span className={`text-sm font-semibold whitespace-nowrap ${isSelected ? 'text-gray-900' : 'text-gray-500'}`}>
                            {formatarMoeda(fatura.valor, fatura.moeda)}
                          </span>
                        </div>
                      )
                    })}
                  </div>

                  {/* Totais por moeda (só das selecionadas) */}
                  {faturasParaExportar.length > 0 && (
                    <div className="pt-3 border-t">
                      <div className="flex flex-wrap gap-3">
                        {Object.entries(totaisPorMoeda).map(([moeda, total]) => (
                          <div key={moeda} className="flex items-center gap-2">
                            <span className="text-sm text-gray-600">Total ({moeda}):</span>
                            <span className="text-lg font-bold text-blue-600">
                              {MOEDA_SYMBOLS[moeda]} {total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-gray-400 mt-2">
                        {faturasParaExportar.length} de {faturasFiltradas.length} fatura{faturasFiltradas.length > 1 ? 's' : ''} selecionada{faturasParaExportar.length > 1 ? 's' : ''}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={gerando}
          >
            Cancelar
          </Button>
          
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => handleExportar(true)}
              disabled={gerando || !destinatarioSelecionado || faturasParaExportar.length === 0}
              className="gap-2"
            >
              <ExternalLink className="h-4 w-4" />
              Visualizar
            </Button>
            <Button
              onClick={() => handleExportar(false)}
              disabled={gerando || !destinatarioSelecionado || faturasParaExportar.length === 0}
              className="bg-blue-600 hover:bg-blue-700 gap-2"
            >
              {gerando ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <FileDown className="h-4 w-4" />
              )}
              Baixar PDF
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
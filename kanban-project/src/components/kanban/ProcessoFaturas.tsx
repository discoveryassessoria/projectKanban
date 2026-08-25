// src/components/kanban/ProcessoFaturas.tsx
// ✅ ATUALIZADO - Usando totaisGeralBRL da API + campo cambio na fatura
//
// ⚠️ ESTE ARQUIVO NÃO É RENDERIZADO POR NINGUÉM — 1.792 linhas de código morto.
//
// Verificado em 05/08/2026 por quatro vias, todas negativas: import estático,
// import dinâmico/`lazy`, uso como JSX, e menção ao nome. As duas únicas
// referências no repositório são comentários — `styles/financeiro.css` e
// `financeiro/cards/FaturaCard.tsx` —, e a segunda registra que a tela "foi
// renomeada como Receitas.tsx". Quem serve a aba `faturas` hoje é o
// `ProcessoFinanceiroShell` (financeiro/v3), não este arquivo.
//
// CORREÇÃO DE REGISTRO: o commit efebefa6 alterou a linha ~910 daqui (cor de
// texto do nome do destinatário) e a mensagem daquele commit justifica a
// mudança dizendo que "a aba faturas roda com finDark". A afirmação está
// ERRADA — este componente não renderiza, então não está sob subárvore nenhuma.
// A alteração em si é correta e inofensiva; só a justificativa não procede. O
// commit não foi reescrito de propósito: já estava em produção e havia trabalho
// de terceiros em cima dele.
//
// Antes de investir tempo mantendo este arquivo, decida se ele deve ser
// excluído — a exclusão é a leitura provável, mas é chamada de produto.

"use client"

import { nomePessoa, nomesPessoas } from "@/src/lib/ui/pessoa-exibicao"
import { useApi } from "@/src/lib/dados"
import { useState, useEffect, useMemo } from "react"
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
  CheckCircle2,
  ArrowRight,
  Pencil,
  Eye,
  FileDown
} from "lucide-react"
import { TabelaCustos } from "./TabelaCustos"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { NovaFaturaModal } from "./NovaFaturaModal"
import { ExportarFaturaModal } from "./ExportarFaturaModal"
import { usePermissoes } from "@/src/hooks/use-permissoes"

// ========================================
// TYPES
// ========================================
interface Requerente {
  id: number
  publicCode?: string | null   // CLI-n — código público do cliente
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
  comprovanteUrl: string | null
  comprovanteNome: string | null
  observacao: string | null
  cambio: number | null
  valorOriginal: number | null  // Valor em BRL (se moeda estrangeira)
  destinatarios?: Requerente[]
}

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
  cambio: number | null  // ✅ NOVO: Câmbio da fatura
  valor: number
  metodoPagamento: string | null
  parcelas: number
  valorParcela: number | null
  status: 'PENDENTE' | 'PAGO' | 'VENCIDO' | 'PARCIAL'
  dataEmissao: string
  dataVencimento: string | null
  observacoes: string | null
  valorPago: number      // Na moeda da fatura
  valorRestante: number  // Na moeda da fatura
  pagamentos: Pagamento[]
  destinatarios: Requerente[]
  parcelasBoleto?: Parcela[]
}

interface Totais {
  total: number
  pago: number
  pendente: number
  vencido: number
}

// ✅ NOVO: Interface para totais gerais em BRL
interface TotaisGeralBRL {
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

type MetodoPagamento = 'PIX' | 'BOLETO' | 'TRANSFERENCIA' | 'CARTAO_CREDITO' | 'CARTAO_DEBITO' | 'DINHEIRO' | 'CHEQUE' | 'OUTRO'

// ========================================
// CONSTANTS
// ========================================
const STATUS_CONFIG = {
  PENDENTE: { 
    label: 'Pendente', 
    color: 'bg-[var(--surface-secondary)] text-amber-700 border-[var(--border-default)]',
    icon: Clock 
  },
  PAGO: { 
    label: 'Pago', 
    color: 'bg-[var(--surface-secondary)] text-green-700 border-[var(--border-default)]',
    icon: Check 
  },
  VENCIDO: { 
    label: 'Vencido', 
    color: 'bg-[var(--surface-secondary)] text-red-700 border-[var(--border-default)]',
    icon: AlertCircle 
  },
  PARCIAL: { 
    label: 'Parcial', 
    color: 'bg-[var(--surface-secondary)] text-amber-700 border-[var(--border-default)]',
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

const METODOS_PAGAMENTO: { value: MetodoPagamento; label: string }[] = [
  { value: 'PIX', label: 'PIX' },
  { value: 'BOLETO', label: 'Boleto Bancário' },
  { value: 'TRANSFERENCIA', label: 'Transferência Bancária' },
  { value: 'CARTAO_CREDITO', label: 'Cartão de Crédito' },
  { value: 'CARTAO_DEBITO', label: 'Cartão de Débito' },
  { value: 'DINHEIRO', label: 'Dinheiro' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'OUTRO', label: 'Outro' },
]

const MOEDA_SYMBOLS: Record<string, string> = {
  BRL: 'R$',
  EUR: '€',
  USD: '$'
}

// ========================================
// COMPONENT
// ========================================
const SEM_FATURAS: Fatura[] = []
const SEM_REQUERENTES: Requerente[] = []
// Zerado como CONSTANTE: um literal novo por render trocaria a identidade e faria os
// memos de totais desta tela recalcularem sempre.
const TOTAIS_ZERADOS = { total: 0, pago: 0, pendente: 0, vencido: 0 }

export function ProcessoFaturas({ processoId, nomeFamilia, onUpdate }: ProcessoFaturasProps) {
  const { pode } = usePermissoes()

  // Faturas (com os totais que a API já calcula) e o processo (de onde vêm os
  // requerentes): duas leituras independentes, cada uma com o seu cache, no lugar do
  // `Promise.all` dentro de um efeito e dos cinco `useState` que guardavam a resposta.
  const faturasReq = useApi<{ faturas?: Fatura[]; totais?: Totais; totaisGeralBRL?: TotaisGeralBRL }>(
    processoId ? `/api/processos/${processoId}/faturas` : null,
  )
  const processoReq = useApi<{ processo?: { requerentes?: Requerente[] } }>(
    processoId ? `/api/processos/${processoId}` : null,
  )
  const faturas = faturasReq.dados?.faturas ?? SEM_FATURAS
  const totais = faturasReq.dados?.totais ?? TOTAIS_ZERADOS
  const totaisGeralBRL = faturasReq.dados?.totaisGeralBRL ?? TOTAIS_ZERADOS
  const requerentes = processoReq.dados?.processo?.requerentes ?? SEM_REQUERENTES
  const loading = faturasReq.carregando
  // Escrever numa fatura muda as duas leituras (totais do processo inclusive).
  const carregarDados = () => { void faturasReq.recarregar(); void processoReq.recarregar() }
  // ✅ NOVO: Totais gerais em BRL vindos da API
  
  // Controle de seções
  const [showCustos, setShowCustos] = useState(true)
  const [showFaturas, setShowFaturas] = useState(true)
  
  // Modais
  const [showNovaFatura, setShowNovaFatura] = useState(false)
  const [showExportarPDF, setShowExportarPDF] = useState(false)
  const [showPagar, setShowPagar] = useState<Fatura | null>(null)
  const [expandedFatura, setExpandedFatura] = useState<number | null>(null)
  
  // Modal de confirmação de parcela
  const [confirmarParcela, setConfirmarParcela] = useState<{
    fatura: Fatura
    parcela: Parcela
  } | null>(null)
  const [salvandoParcela, setSalvandoParcela] = useState(false)
  
  // Modal de visualização/edição de pagamento
  const [pagamentoSelecionado, setPagamentoSelecionado] = useState<{
    fatura: Fatura
    pagamento: Pagamento
  } | null>(null)
  const [editandoPagamento, setEditandoPagamento] = useState(false)
  const [editPagValor, setEditPagValor] = useState('')
  const [editPagData, setEditPagData] = useState('')
  const [editPagMetodo, setEditPagMetodo] = useState<MetodoPagamento>('PIX')
  const [editPagObservacao, setEditPagObservacao] = useState('')
  const [editPagDestinatarioIds, setEditPagDestinatarioIds] = useState<number[]>([])
  const [editPagCambio, setEditPagCambio] = useState('')
  const [salvandoEdicao, setSalvandoEdicao] = useState(false)
  
  // Form pagar
  const [pagarValor, setPagarValor] = useState('')
  const [pagarData, setPagarData] = useState('')
  const [pagarDestinatarioIds, setPagarDestinatarioIds] = useState<number[]>([])
  const [pagarMetodo, setPagarMetodo] = useState<MetodoPagamento>('PIX')
  const [pagarCambio, setPagarCambio] = useState('')
  const [pagarObservacao, setPagarObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)

  // ========================================
  // COMPUTED VALUES
  // ========================================
  
  // Calcular totais por moeda
  const totaisPorMoeda = useMemo(() => {
    const resultado: Record<string, { total: number; pago: number; pendente: number; vencido: number }> = {}
    
    faturas.forEach(fatura => {
      const moeda = fatura.moeda
      
      if (!resultado[moeda]) {
        resultado[moeda] = { total: 0, pago: 0, pendente: 0, vencido: 0 }
      }
      
      resultado[moeda].total += fatura.valor
      resultado[moeda].pago += fatura.valorPago
      
      if (fatura.status === 'VENCIDO') {
        resultado[moeda].vencido += fatura.valorRestante
      } else if (fatura.status !== 'PAGO') {
        resultado[moeda].pendente += fatura.valorRestante
      }
    })
    
    return resultado
  }, [faturas])
  
  // Ordenar moedas: BRL primeiro, depois as outras
  const moedasOrdenadas = useMemo(() => {
    const moedas = Object.keys(totaisPorMoeda)
    return moedas.sort((a, b) => {
      if (a === 'BRL') return -1
      if (b === 'BRL') return 1
      return a.localeCompare(b)
    })
  }, [totaisPorMoeda])

  // Verifica se tem mais de uma moeda
  const temMultiplasMoedas = moedasOrdenadas.length > 1

  const pagarCambioNumerico = useMemo(() => {
    const num = parseFloat(pagarCambio.replace(',', '.'))
    return isNaN(num) ? 0 : num
  }, [pagarCambio])

  const pagarValorNumerico = useMemo(() => {
    const num = parseFloat(pagarValor.replace(',', '.'))
    return isNaN(num) ? 0 : num
  }, [pagarValor])

  // Valor em BRL (apenas informativo)
  const pagarValorEmBRL = useMemo(() => {
    if (!showPagar) return 0
    if (showPagar.moeda === 'BRL') return pagarValorNumerico
    if (!pagarCambioNumerico) return 0
    return pagarValorNumerico * pagarCambioNumerico
  }, [showPagar, pagarValorNumerico, pagarCambioNumerico])

  // ========================================
  // DATA LOADING
  // ========================================
  // ========================================
  // HANDLERS
  // ========================================
  
  // Marcar parcela como paga
  const handleMarcarParcelaPaga = async () => {
    if (!confirmarParcela) return

    try {
      setSalvandoParcela(true)
      
      const { fatura, parcela } = confirmarParcela
      
      const response = await fetch(
        `/api/processos/${processoId}/faturas/${fatura.id}/parcelas/${parcela.id}/pagar`,
        { 
          method: 'POST',
          headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        }
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

  // Desmarcar parcela
  const handleDesmarcarParcela = async (fatura: Fatura, parcela: Parcela) => {
    if (!confirm('Desmarcar esta parcela como não paga?')) return

    try {
      const response = await fetch(
        `/api/processos/${processoId}/faturas/${fatura.id}/parcelas/${parcela.id}/pagar`,
        { 
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        }
      )

      if (response.ok) {
        carregarDados()
        onUpdate?.()
      }
    } catch (error) {
      console.error('Erro ao desmarcar parcela:', error)
    }
  }

  // Toggle destinatário no modal de pagamento
  const togglePagarDestinatario = (id: number) => {
    setPagarDestinatarioIds(prev => 
      prev.includes(id) 
        ? prev.filter(d => d !== id)
        : [...prev, id]
    )
  }

  // Selecionar todos destinatários
  const selectAllPagarDestinatarios = () => {
    if (pagarDestinatarioIds.length === requerentes.length) {
      setPagarDestinatarioIds([])
    } else {
      setPagarDestinatarioIds(requerentes.map(r => r.id))
    }
  }

  // ✅ ATUALIZADO: Abrir modal de pagamento com câmbio da fatura
  const abrirModalPagamento = (fatura: Fatura) => {
    setPagarValor(String(fatura.valorRestante))
    setPagarData(new Date().toISOString().split('T')[0])
    setPagarDestinatarioIds(fatura.destinatarios?.map(d => d.id) || [])
    setPagarMetodo('PIX')
    // ✅ Preencher com câmbio da fatura (se tiver)
    setPagarCambio(fatura.cambio ? String(fatura.cambio) : '')
    setPagarObservacao('')
    setShowPagar(fatura)
  }

  // Enviar pagamento
  const handlePagar = async () => {
    if (!showPagar) return

    try {
      setSalvando(true)

      const response = await fetch(`/api/processos/${processoId}/faturas/${showPagar.id}/pagar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('authToken')}` },
        body: JSON.stringify({
          formaPagamento: pagarMetodo,
          valorPago: pagarValorNumerico,
          valorEmReais: showPagar.moeda !== 'BRL' && pagarCambioNumerico > 0 
            ? pagarValorEmBRL
            : null,
          cambio: showPagar.moeda !== 'BRL' ? pagarCambioNumerico : null,
          dataPagamento: pagarData || null,
          observacao: pagarObservacao || null,
          destinatarioIds: pagarDestinatarioIds.length > 0 ? pagarDestinatarioIds : null
        })
      })

      if (response.ok) {
        setShowPagar(null)
        setPagarValor('')
        setPagarData('')
        setPagarDestinatarioIds([])
        setPagarMetodo('PIX')
        setPagarCambio('')
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
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
      })

      if (response.ok) {
        carregarDados()
        onUpdate?.()
      }
    } catch (error) {
      console.error('Erro ao excluir fatura:', error)
    }
  }

  // Abrir modal de visualização de pagamento
  const abrirVisualizarPagamento = (fatura: Fatura, pagamento: Pagamento) => {
    setPagamentoSelecionado({ fatura, pagamento })
    setEditandoPagamento(false)
  }

  // Iniciar edição de pagamento
  const iniciarEdicaoPagamento = () => {
    if (!pagamentoSelecionado) return
    const { fatura, pagamento } = pagamentoSelecionado
    
    setEditPagValor(String(pagamento.valor))
    setEditPagData(pagamento.data ? pagamento.data.split('T')[0] : '')
    setEditPagMetodo((pagamento.formaPagamento as MetodoPagamento) || 'PIX')
    setEditPagObservacao(pagamento.observacao || '')
    setEditPagDestinatarioIds(pagamento.destinatarios?.map(d => d.id) || [])
    setEditPagCambio(pagamento.cambio ? String(pagamento.cambio) : '')
    setEditandoPagamento(true)
  }

  // Salvar edição de pagamento
  const salvarEdicaoPagamento = async () => {
    if (!pagamentoSelecionado) return

    try {
      setSalvandoEdicao(true)
      const { fatura, pagamento } = pagamentoSelecionado
      
      const valorNumerico = parseFloat(editPagValor.replace(',', '.'))
      const cambioNumerico = editPagCambio ? parseFloat(editPagCambio.replace(',', '.')) : null
      
      let valorEmReais = null
      if (fatura.moeda !== 'BRL' && cambioNumerico) {
        valorEmReais = valorNumerico * cambioNumerico
      }
      
      const response = await fetch(
        `/api/processos/${processoId}/faturas/${fatura.id}/pagamentos/${pagamento.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('authToken')}` },
          body: JSON.stringify({
            valor: valorNumerico,
            valorOriginal: valorEmReais,
            cambio: cambioNumerico,
            data: editPagData || null,
            formaPagamento: editPagMetodo,
            observacao: editPagObservacao || null,
            destinatarioIds: editPagDestinatarioIds.length > 0 ? editPagDestinatarioIds : null
          })
        }
      )

      if (response.ok) {
        setPagamentoSelecionado(null)
        setEditandoPagamento(false)
        carregarDados()
        onUpdate?.()
      }
    } catch (error) {
      console.error('Erro ao editar pagamento:', error)
    } finally {
      setSalvandoEdicao(false)
    }
  }

  // Excluir pagamento
  const excluirPagamento = async () => {
    if (!pagamentoSelecionado) return
    if (!confirm('Tem certeza que deseja excluir este pagamento?')) return

    try {
      const { fatura, pagamento } = pagamentoSelecionado
      
      const response = await fetch(
        `/api/processos/${processoId}/faturas/${fatura.id}/pagamentos/${pagamento.id}`,
        { 
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        }
      )

      if (response.ok) {
        setPagamentoSelecionado(null)
        carregarDados()
        onUpdate?.()
      }
    } catch (error) {
      console.error('Erro ao excluir pagamento:', error)
    }
  }

  // Toggle destinatário no modal de edição
  const toggleEditPagDestinatario = (id: number) => {
    setEditPagDestinatarioIds(prev => 
      prev.includes(id) 
        ? prev.filter(d => d !== id)
        : [...prev, id]
    )
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

  // Verificar se parcela está vencida
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
      <div className="bg-[var(--surface-primary)] border-b">
        <div
          onClick={() => setShowCustos(!showCustos)}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[var(--surface-secondary)] rounded-lg">
              <DollarSign className="h-5 w-5 text-amber-600" />
            </div>
            <div className="text-left">
              <h3 className="font-semibold text-gray-900">Custos por Pessoa</h3>
              <p className="text-sm text-gray-500">Planilha de custos detalhada</p>
            </div>
          </div>
          {showCustos ? (
            <ChevronUp className="h-5 w-5 text-[var(--text-muted)]" />
          ) : (
            <ChevronDown className="h-5 w-5 text-[var(--text-muted)]" />
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
        <div className="bg-[var(--surface-primary)] border-b">
          <div
            onClick={() => setShowFaturas(!showFaturas)}
            className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-[var(--surface-secondary)] rounded-lg">
                <Receipt className="h-5 w-5 text-green-600" />
              </div>
              <div className="text-left">
                <h3 className="font-semibold text-gray-900">Faturas</h3>
                <p className="text-sm text-gray-500">{faturas.length} fatura(s)</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Botão Exportar PDF */}
              <Button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowExportarPDF(true)
                }}
                size="sm"
                variant="outline"
                disabled={faturas.length === 0}
                className="gap-1 text-[var(--text-secondary)] border-[var(--border-default)] hover:bg-[var(--surface-secondary)]"
              >
                <FileDown className="h-4 w-4" />
                Exportar PDF
              </Button>
              {pode('financeiro.fatura_criar') && (
                <Button
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowNovaFatura(true)
                  }}
                  size="sm"
                  className="bg-green-700 hover:bg-green-800"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Nova Fatura
                </Button>
              )}
              {showFaturas ? (
                <ChevronUp className="h-5 w-5 text-[var(--text-muted)]" />
              ) : (
                <ChevronDown className="h-5 w-5 text-[var(--text-muted)]" />
              )}
            </div>
          </div>

          {/* Totalizadores por moeda */}
          {showFaturas && moedasOrdenadas.length > 0 && (
            <div className="px-6 pb-4 space-y-3">
              {moedasOrdenadas.map(moeda => {
                const totaisMoeda = totaisPorMoeda[moeda]
                const symbol = MOEDA_SYMBOLS[moeda] || moeda
                
                const coresMoeda = {
                  BRL: {
                    bg: 'bg-[var(--surface-secondary)]',
                    border: 'border-[var(--border-default)]',
                    label: 'text-green-600',
                    value: 'text-green-700'
                  },
                  USD: {
                    bg: 'bg-[var(--surface-secondary)]',
                    border: 'border-[var(--border-default)]',
                    label: 'text-[var(--text-secondary)]',
                    value: 'text-[var(--text-secondary)]'
                  },
                  EUR: {
                    bg: 'bg-[var(--surface-secondary)]',
                    border: 'border-[var(--border-default)]',
                    label: 'text-amber-600',
                    value: 'text-amber-700'
                  }
                }
                
                const cores = coresMoeda[moeda as keyof typeof coresMoeda] || coresMoeda.BRL
                
                return (
                  <div key={moeda} className={`grid grid-cols-4 gap-4 p-3 rounded-xl border ${cores.bg} ${cores.border}`}>
                    <div>
                      <p className={`text-xs uppercase font-medium ${cores.label}`}>
                        Total ({moeda})
                      </p>
                      <p className={`text-lg font-bold ${cores.value}`}>
                        {symbol} {totaisMoeda.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div>
                      <p className={`text-xs uppercase font-medium ${cores.label}`}>Recebido</p>
                      <p className={`text-lg font-bold ${cores.value}`}>
                        {symbol} {totaisMoeda.pago.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div>
                      <p className={`text-xs uppercase font-medium ${cores.label}`}>Pendente</p>
                      <p className={`text-lg font-bold ${cores.value}`}>
                        {symbol} {totaisMoeda.pendente.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div>
                      <p className={`text-xs uppercase font-medium ${cores.label}`}>Vencido</p>
                      <p className={`text-lg font-bold ${cores.value}`}>
                        {symbol} {totaisMoeda.vencido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                )
              })}
              
              {/* Total Geral com 4 colunas - tudo na mesma cor */}
              {temMultiplasMoedas && (
                <div className="grid grid-cols-4 gap-4 p-3 rounded-xl border-2 border-gray-300 bg-gray-100">
                  <div>
                    <p className="text-xs uppercase font-semibold text-gray-600">
                      Total Geral (BRL)
                    </p>
                    <p className="text-xl font-bold text-gray-900">
                      R$ {totaisGeralBRL.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase font-semibold text-gray-600">
                      Recebido (BRL)
                    </p>
                    <p className="text-xl font-bold text-gray-900">
                      R$ {totaisGeralBRL.pago.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase font-semibold text-gray-600">
                      Pendente (BRL)
                    </p>
                    <p className="text-xl font-bold text-gray-900">
                      R$ {totaisGeralBRL.pendente.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase font-semibold text-gray-600">
                      Vencido (BRL)
                    </p>
                    <p className="text-xl font-bold text-gray-900">
                      R$ {totaisGeralBRL.vencido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="col-span-4">
                    <p className="text-xs text-gray-500">
                      * Valores convertidos usando o câmbio registrado em cada fatura
                    </p>
                  </div>
                </div>
              )}
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
                  <Receipt className="h-10 w-10 text-[var(--text-muted)]" />
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
                      className="bg-[var(--surface-primary)] rounded-xl border shadow-[var(--elev-1)] overflow-hidden"
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
                                  <span className="flex items-center gap-1 text-[var(--text-secondary)]">
                                    <Coins className="h-3 w-3" />
                                    {fatura.moeda}
                                    {fatura.cambio && (
                                      <span className="text-xs text-[var(--text-muted)]">
                                        (câmbio: {fatura.cambio})
                                      </span>
                                    )}
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
                                {formatarMoeda(fatura.valor, fatura.moeda)}
                              </p>
                              {/* ✅ Mostrar valor em BRL se for moeda estrangeira com câmbio */}
                              {temMoedaEstrangeira && fatura.cambio && (
                                <p className="text-xs text-gray-500">
                                  ≈ {formatarMoeda(fatura.valor * fatura.cambio, 'BRL')}
                                </p>
                              )}
                              <span className={`
                                inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border mt-1
                                ${config.color}
                              `}>
                                {config.label}
                              </span>
                            </div>

                            <button className="text-[var(--text-muted)] hover:text-gray-600 ml-2">
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
                                    // `text-gray-900` explícito: a aba "faturas" roda com
                                    // `finDark`, e o container das abas aplica `text-white/80`.
                                    // Sem cor própria, este nome sairia branco sobre `bg-[var(--surface-primary)]`.
                                    className="px-2 py-1 bg-[var(--surface-primary)] text-gray-900 border rounded-lg text-sm"
                                  >
                                    {nomePessoa(dest)}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Lista de Parcelas para Boletos */}
                          {isBoleto && temParcelas && (
                            <div className="mb-4">
                              <p className="text-xs text-gray-500 uppercase mb-3 flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                Parcelas do Boleto
                              </p>
                              <div className="bg-[var(--surface-primary)] rounded-lg border overflow-hidden">
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
                                          ${parcela.pago ? 'bg-[var(--surface-secondary)]' : vencida ? 'bg-[var(--surface-secondary)]' : ''}
                                        `}
                                      >
                                        <div className="flex items-center gap-2">
                                          {parcela.pago ? (
                                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                                          ) : vencida ? (
                                            <AlertCircle className="h-5 w-5 text-red-500" />
                                          ) : (
                                            <CircleDot className="h-5 w-5 text-[var(--text-muted)]" />
                                          )}
                                          <span className={`
                                            font-medium
                                            ${parcela.pago ? 'text-green-700' : vencida ? 'text-red-700' : 'text-gray-700'}
                                          `}>
                                            {parcela.numero}/{fatura.parcelas}
                                          </span>
                                        </div>

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

                                        <div className={`
                                          text-right font-medium
                                          ${parcela.pago ? 'text-green-700' : vencida ? 'text-red-700' : 'text-gray-900'}
                                        `}>
                                          {formatarMoeda(parcela.valor)}
                                        </div>

                                        <div className="flex justify-center">
                                          {pode('financeiro.pagamento_criar') && (
                                            <>
                                              {parcela.pago ? (
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation()
                                                    handleDesmarcarParcela(fatura, parcela)
                                                  }}
                                                  className="text-xs text-gray-500 hover:text-red-600 px-2 py-1 rounded hover:bg-[var(--surface-secondary)] transition-colors"
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
                                                      ? 'border-[var(--border-default)] text-red-700 hover:bg-[var(--surface-secondary)]' 
                                                      : 'border-[var(--border-default)] text-green-700 hover:bg-[var(--surface-secondary)]'
                                                    }
                                                  `}
                                                >
                                                  <Check className="h-3 w-3 mr-1" />
                                                  Marcar Pago
                                                </Button>
                                              )}
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
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

                          {/* Resumo financeiro */}
                          {(!isBoleto || !temParcelas) && (
                            <div className="grid grid-cols-3 gap-4 mb-4 p-3 bg-[var(--surface-primary)] rounded-lg border">
                              <div>
                                <p className="text-xs text-gray-500 uppercase">Valor Total</p>
                                <p className="text-sm font-bold text-gray-900">
                                  {formatarMoeda(fatura.valor, fatura.moeda)}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-gray-500 uppercase">Pago</p>
                                <p className="text-sm font-bold text-green-600">
                                  {formatarMoeda(fatura.valorPago, fatura.moeda)}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-gray-500 uppercase">Restante</p>
                                <p className="text-sm font-bold text-amber-600">
                                  {formatarMoeda(fatura.valorRestante, fatura.moeda)}
                                </p>
                              </div>
                            </div>
                          )}

                          {/* Histórico de pagamentos */}
                          {fatura.pagamentos && fatura.pagamentos.length > 0 && (
                            <div className="mb-4">
                              <p className="text-xs text-gray-500 uppercase mb-2">Histórico de Pagamentos</p>
                              <div className="space-y-2">
                                {fatura.pagamentos.map((pag, idx) => (
                                  <div 
                                    key={pag.id} 
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      abrirVisualizarPagamento(fatura, pag)
                                    }}
                                    className="p-3 bg-[var(--surface-primary)] rounded-lg border hover:border-[var(--border-default)] hover:bg-[var(--surface-secondary)] cursor-pointer transition-colors"
                                  >
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-3">
                                        <span className="text-[var(--text-muted)] text-sm">#{idx + 1}</span>
                                        <span className="font-bold text-green-600">
                                          {formatarMoeda(pag.valor, fatura.moeda)}
                                        </span>
                                        {fatura.moeda !== 'BRL' && pag.valorOriginal && (
                                          <span className="text-gray-500 text-sm">
                                            ({formatarMoeda(pag.valorOriginal, 'BRL')})
                                          </span>
                                        )}
                                        <span className="text-gray-500 text-sm">{formatarData(pag.data)}</span>
                                        {pag.formaPagamento && (
                                          <span className="px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-600">
                                            {FORMAS_PAGAMENTO[pag.formaPagamento] || pag.formaPagamento}
                                          </span>
                                        )}
                                      </div>
                                      <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
                                    </div>
                                    
                                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                      {pag.destinatarios && pag.destinatarios.length > 0 && (
                                        <span className="flex items-center gap-1 text-gray-500">
                                          <Users className="h-3 w-3" />
                                          {nomesPessoas(pag.destinatarios)}
                                        </span>
                                      )}
                                      {pag.observacao && (
                                        <span className="text-gray-500 italic truncate max-w-xs">
                                          "{pag.observacao}"
                                        </span>
                                      )}
                                    </div>
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
                            {fatura.status !== 'PAGO' && !isBoleto && pode('financeiro.pagamento_criar') && (
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  abrirModalPagamento(fatura)
                                }}
                                className="bg-green-700 hover:bg-green-800"
                              >
                                <Check className="h-4 w-4 mr-1" />
                                {fatura.status === 'PARCIAL' ? 'Registrar Pagamento' : 'Marcar como Pago'}
                              </Button>
                            )}
                            {pode('financeiro.fatura_excluir') && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleExcluir(fatura)
                                }}
                                className="text-red-500 hover:text-red-600 hover:bg-[var(--surface-secondary)] ml-auto"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
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
          onClose={() => setShowNovaFatura(false)}
          onSuccess={() => {
            carregarDados()
            onUpdate?.()
          }}
        />
      )}

      {/* Modal Exportar PDF */}
      {showExportarPDF && (
        <ExportarFaturaModal
          faturas={faturas}
          requerentes={requerentes}
          onClose={() => setShowExportarPDF(false)}
        />
      )}

      {/* Modal de Confirmação de Parcela */}
      {confirmarParcela && (
      <div className="fixed inset-0 bg-[var(--overlay-modal)] flex items-center justify-center z-50" onClick={() => setConfirmarParcela(null)}>
        <div className="bg-[var(--surface-primary)] rounded-xl shadow-[var(--elev-3)] w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-gray-900">Confirmar Pagamento</h3>
              <button 
                onClick={() => setConfirmarParcela(null)}
                className="text-[var(--text-muted)] hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-[var(--surface-secondary)] rounded-full flex items-center justify-center mx-auto mb-4">
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
                className="flex-1 bg-green-700 hover:bg-green-800 gap-2"
              >
                {salvandoParcela && (
                  <div className="w-4 h-4 border-2 border-[var(--border-strong)] border-t-white rounded-full animate-spin" />
                )}
                {!salvandoParcela && <Check className="h-4 w-4" />}
                Confirmar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL REGISTRAR PAGAMENTO ===== */}
      {showPagar && (
        <div className="fixed inset-0 bg-[var(--overlay-modal)] flex items-center justify-center z-50 p-4" onClick={() => setShowPagar(null)}>
          <div className="bg-[var(--surface-primary)] rounded-2xl shadow-[var(--elev-3)] w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            
            <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-green-500 to-green-600">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-[var(--surface-secondary)] rounded-lg">
                  <Check className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Registrar Pagamento</h2>
                  <p className="text-sm text-green-100">{showPagar.descricao}</p>
                </div>
              </div>
              <button 
                onClick={() => setShowPagar(null)}
                className="p-2 hover:bg-[var(--surface-hover)] rounded-lg transition-colors"
              >
                <X className="h-5 w-5 text-white" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              
              <div className="bg-gray-50 rounded-xl p-4 border mb-6">
                <p className="text-xs text-gray-500 uppercase mb-1">Fatura</p>
                <p className="font-semibold text-gray-900">{showPagar.descricao}</p>
                <div className="grid grid-cols-3 gap-3 mt-3">
                  <div>
                    <p className="text-xs text-gray-500">Total</p>
                    <p className="font-bold text-gray-900">{formatarMoeda(showPagar.valor, showPagar.moeda)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Pago</p>
                    <p className="font-bold text-green-600">{formatarMoeda(showPagar.valorPago, showPagar.moeda)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Restante</p>
                    <p className="font-bold text-amber-600">{formatarMoeda(showPagar.valorRestante, showPagar.moeda)}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Valor do Pagamento *
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">
                        {MOEDA_SYMBOLS[showPagar.moeda]}
                      </span>
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={pagarValor}
                        onChange={(e) => setPagarValor(e.target.value)}
                        className="h-11 pl-10"
                        placeholder="0,00"
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Informe o valor na moeda da fatura ({showPagar.moeda})
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Data do Pagamento
                    </label>
                    <DatePickerField
                      value={pagarData}
                      onChange={setPagarData}
                    />
                  </div>

                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                      <CreditCard className="h-4 w-4 text-[var(--text-muted)]" />
                      Método de Pagamento
                    </label>
                    <select
                      value={pagarMetodo}
                      onChange={(e) => setPagarMetodo(e.target.value as MetodoPagamento)}
                      className="w-full h-11 px-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--border-strong)] focus:border-green-500"
                    >
                      {METODOS_PAGAMENTO.map(m => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Campo de câmbio apenas para moedas estrangeiras */}
                  {showPagar.moeda !== 'BRL' && (
                    <div>
                      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                        <Coins className="h-4 w-4 text-[var(--text-muted)]" />
                        Câmbio (1 {showPagar.moeda} = R$)
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">
                          R$
                        </span>
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={pagarCambio}
                          onChange={(e) => setPagarCambio(e.target.value)}
                          className="h-11 pl-10"
                          placeholder="6,20"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Informe a taxa de câmbio usada no pagamento
                      </p>
                    </div>
                  )}

                  {/* Preview da conversão para moedas estrangeiras */}
                  {showPagar.moeda !== 'BRL' && pagarValorNumerico > 0 && pagarCambioNumerico > 0 && (
                    <div className="flex items-center gap-3 p-4 bg-[var(--surface-secondary)] rounded-xl border border-[var(--border-default)]">
                      <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                        <span className="font-medium">
                          {MOEDA_SYMBOLS[showPagar.moeda]} {pagarValorNumerico.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </span>
                        <ArrowRight className="h-4 w-4" />
                        <span className="font-bold text-lg">{formatarMoeda(pagarValorEmBRL)}</span>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Observações (opcional)
                    </label>
                    <Input
                      value={pagarObservacao}
                      onChange={(e) => setPagarObservacao(e.target.value)}
                      placeholder="Ex: Pix de fulano, referente a..."
                    />
                  </div>
                </div>

                <div>
                  {requerentes.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                          <Users className="h-4 w-4 text-[var(--text-muted)]" />
                          Destinatário(s)
                        </label>
                        <button
                          type="button"
                          onClick={selectAllPagarDestinatarios}
                          className="text-xs text-green-600 hover:text-green-700 font-medium"
                        >
                          {pagarDestinatarioIds.length === requerentes.length ? 'Desmarcar todos' : 'Selecionar todos'}
                        </button>
                      </div>
                      <div className="space-y-2 max-h-[320px] overflow-y-auto">
                        {requerentes.map(req => {
                          const isSelected = pagarDestinatarioIds.includes(req.id)
                          const endereco = [req.endereco, req.numero, req.bairro, req.cidade, req.estado]
                            .filter(Boolean).join(', ')
                          
                          return (
                            <div
                              key={req.id}
                              onClick={() => togglePagarDestinatario(req.id)}
                              className={`
                                p-3 rounded-xl border-2 cursor-pointer transition-all
                                ${isSelected 
                                  ? 'border-green-500 bg-[var(--surface-secondary)]' 
                                  : 'border-gray-200 hover:border-gray-300 bg-[var(--surface-primary)]'
                                }
                              `}
                            >
                              <div className="flex items-center gap-3">
                                <div className={`
                                  w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors
                                  ${isSelected 
                                    ? 'bg-green-600 border-green-500' 
                                    : 'border-gray-300'
                                  }
                                `}>
                                  {isSelected && <Check className="h-3 w-3 text-white" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-gray-900">{nomePessoa(req)}</p>
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
                        Opcional. Selecione para vincular o pagamento a pessoas específicas.
                      </p>
                    </div>
                  )}
                </div>

              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t bg-gray-50">
              <Button
                variant="outline"
                onClick={() => setShowPagar(null)}
                disabled={salvando}
              >
                Cancelar
              </Button>
              <Button
                onClick={handlePagar}
                disabled={salvando || !pagarValorNumerico}
                className="bg-green-700 hover:bg-green-800 min-w-[200px] gap-2"
              >
                {salvando && (
                  <div className="w-4 h-4 border-2 border-[var(--border-strong)] border-t-white rounded-full animate-spin" />
                )}
                {!salvando && <Check className="h-4 w-4" />}
                Confirmar Pagamento
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL VISUALIZAR/EDITAR PAGAMENTO ===== */}
      {pagamentoSelecionado && (
        <div className="fixed inset-0 bg-[var(--overlay-modal)] flex items-center justify-center z-50 p-4" onClick={() => setPagamentoSelecionado(null)}>
          <div className="bg-[var(--surface-primary)] rounded-2xl shadow-[var(--elev-3)] w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            
            <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-green-500 to-green-600">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-[var(--surface-secondary)] rounded-lg">
                  {editandoPagamento ? <Pencil className="h-5 w-5 text-white" /> : <Eye className="h-5 w-5 text-white" />}
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    {editandoPagamento ? 'Editar Pagamento' : 'Detalhes do Pagamento'}
                  </h2>
                  <p className="text-sm text-green-100">{pagamentoSelecionado.fatura.descricao}</p>
                </div>
              </div>
              <button 
                onClick={() => {
                  setPagamentoSelecionado(null)
                  setEditandoPagamento(false)
                }}
                className="p-2 hover:bg-[var(--surface-hover)] rounded-lg transition-colors"
              >
                <X className="h-5 w-5 text-white" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {editandoPagamento ? (
                <>
                  <div className="bg-gray-50 rounded-xl p-4 border mb-6">
                    <p className="text-xs text-gray-500 uppercase mb-1">Fatura</p>
                    <p className="font-semibold text-gray-900">{pagamentoSelecionado.fatura.descricao}</p>
                    <div className="grid grid-cols-3 gap-3 mt-3">
                      <div>
                        <p className="text-xs text-gray-500">Total</p>
                        <p className="font-bold text-gray-900">{formatarMoeda(pagamentoSelecionado.fatura.valor, pagamentoSelecionado.fatura.moeda)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Pago</p>
                        <p className="font-bold text-green-600">{formatarMoeda(pagamentoSelecionado.fatura.valorPago, pagamentoSelecionado.fatura.moeda)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Restante</p>
                        <p className="font-bold text-amber-600">{formatarMoeda(pagamentoSelecionado.fatura.valorRestante, pagamentoSelecionado.fatura.moeda)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    
                    <div className="space-y-5">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Valor do Pagamento *
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">
                            {MOEDA_SYMBOLS[pagamentoSelecionado.fatura.moeda] || pagamentoSelecionado.fatura.moeda}
                          </span>
                          <Input
                            type="text"
                            inputMode="decimal"
                            value={editPagValor}
                            onChange={(e) => setEditPagValor(e.target.value)}
                            className="h-11 pl-10"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Data do Pagamento</label>
                        <DatePickerField
                          value={editPagData}
                          onChange={setEditPagData}
                        />
                      </div>

                      <div>
                        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                          <CreditCard className="h-4 w-4 text-[var(--text-muted)]" />
                          Método de Pagamento
                        </label>
                        <select
                          value={editPagMetodo}
                          onChange={(e) => setEditPagMetodo(e.target.value as MetodoPagamento)}
                          className="w-full h-11 px-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--border-strong)] focus:border-green-500"
                        >
                          {METODOS_PAGAMENTO.map(m => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                          ))}
                        </select>
                      </div>

                      {pagamentoSelecionado.fatura.moeda !== 'BRL' && (
                        <div>
                          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                            <Coins className="h-4 w-4 text-[var(--text-muted)]" />
                            Câmbio (1 {pagamentoSelecionado.fatura.moeda} = R$)
                          </label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">R$</span>
                            <Input
                              type="text"
                              inputMode="decimal"
                              value={editPagCambio}
                              onChange={(e) => setEditPagCambio(e.target.value)}
                              placeholder="Ex: 6,20"
                              className="h-11 pl-10"
                            />
                          </div>
                        </div>
                      )}

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Observações (opcional)</label>
                        <Input
                          value={editPagObservacao}
                          onChange={(e) => setEditPagObservacao(e.target.value)}
                          placeholder="Ex: Pix de fulano, referente a..."
                        />
                      </div>
                    </div>

                    <div>
                      {requerentes.length > 0 && (
                        <div>
                          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
                            <Users className="h-4 w-4 text-[var(--text-muted)]" />
                            Destinatário(s)
                          </label>
                          <div className="space-y-2 max-h-[320px] overflow-y-auto">
                            {requerentes.map(req => {
                              const isSelected = editPagDestinatarioIds.includes(req.id)
                              const endereco = [req.endereco, req.numero, req.bairro, req.cidade, req.estado]
                                .filter(Boolean).join(', ')
                              
                              return (
                                <div
                                  key={req.id}
                                  onClick={() => toggleEditPagDestinatario(req.id)}
                                  className={`
                                    p-3 rounded-xl border-2 cursor-pointer transition-all
                                    ${isSelected 
                                      ? 'border-green-500 bg-[var(--surface-secondary)]' 
                                      : 'border-gray-200 hover:border-gray-300 bg-[var(--surface-primary)]'
                                    }
                                  `}
                                >
                                  <div className="flex items-center gap-3">
                                    <div className={`
                                      w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors
                                      ${isSelected 
                                        ? 'bg-green-600 border-green-500' 
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
                            Opcional. Selecione para vincular o pagamento a pessoas específicas.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="bg-gray-50 rounded-xl p-4 border mb-6">
                    <p className="text-xs text-gray-500 uppercase mb-1">Fatura</p>
                    <p className="font-semibold text-gray-900">{pagamentoSelecionado.fatura.descricao}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    
                    <div className="space-y-4">
                      <div className="bg-[var(--surface-secondary)] rounded-xl p-4 border border-[var(--border-default)]">
                        <p className="text-xs text-green-600 uppercase font-medium">Valor</p>
                        <p className="text-2xl font-bold text-green-700">
                          {formatarMoeda(pagamentoSelecionado.pagamento.valor, pagamentoSelecionado.fatura.moeda)}
                        </p>
                        {pagamentoSelecionado.fatura.moeda !== 'BRL' && pagamentoSelecionado.pagamento.valorOriginal && (
                          <p className="text-sm text-green-600 mt-1">
                            = {formatarMoeda(pagamentoSelecionado.pagamento.valorOriginal, 'BRL')}
                            {pagamentoSelecionado.pagamento.cambio && (
                              <span className="text-xs ml-1">
                                (câmbio: R$ {pagamentoSelecionado.pagamento.cambio})
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                      
                      <div className="bg-gray-50 rounded-xl p-4 border">
                        <p className="text-xs text-gray-500 uppercase font-medium">Data do Pagamento</p>
                        <p className="text-lg font-semibold text-gray-900 mt-1">
                          {formatarData(pagamentoSelecionado.pagamento.data)}
                        </p>
                      </div>

                      {pagamentoSelecionado.pagamento.formaPagamento && (
                        <div className="bg-gray-50 rounded-xl p-4 border">
                          <p className="text-xs text-gray-500 uppercase font-medium">Método de Pagamento</p>
                          <p className="text-sm font-medium text-gray-900 flex items-center gap-2 mt-1">
                            <CreditCard className="h-4 w-4 text-[var(--text-muted)]" />
                            {FORMAS_PAGAMENTO[pagamentoSelecionado.pagamento.formaPagamento] || pagamentoSelecionado.pagamento.formaPagamento}
                          </p>
                        </div>
                      )}

                      {pagamentoSelecionado.pagamento.observacao && (
                        <div className="bg-gray-50 rounded-xl p-4 border">
                          <p className="text-xs text-gray-500 uppercase font-medium">Observação</p>
                          <p className="text-sm text-gray-700 mt-1">{pagamentoSelecionado.pagamento.observacao}</p>
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="bg-gray-50 rounded-xl p-4 border h-full">
                        <p className="text-xs text-gray-500 uppercase font-medium mb-3 flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          Destinatário(s)
                        </p>
                        {pagamentoSelecionado.pagamento.destinatarios && pagamentoSelecionado.pagamento.destinatarios.length > 0 ? (
                          <div className="space-y-2">
                            {pagamentoSelecionado.pagamento.destinatarios.map(dest => (
                              <div key={dest.id} className="p-3 bg-[var(--surface-primary)] border rounded-lg">
                                <p className="font-medium text-gray-900">{dest.nome}</p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-[var(--text-muted)] italic">Nenhum destinatário vinculado</p>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50">
              {editandoPagamento ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setEditandoPagamento(false)}
                    disabled={salvandoEdicao}
                  >
                    Cancelar
                  </Button>
                  <Button
                    onClick={salvarEdicaoPagamento}
                    disabled={salvandoEdicao}
                    className="bg-green-700 hover:bg-green-800 min-w-[200px] gap-2"
                  >
                    {salvandoEdicao && (
                      <div className="w-4 h-4 border-2 border-[var(--border-strong)] border-t-white rounded-full animate-spin" />
                    )}
                    {!salvandoEdicao && <Check className="h-4 w-4" />}
                    Salvar Alterações
                  </Button>
                </>
              ) : (
                <>
                  {pode('financeiro.pagamento_excluir') && (
                    <Button
                      variant="outline"
                      onClick={excluirPagamento}
                      className="text-red-600 border-[var(--border-default)] hover:bg-[var(--surface-secondary)] hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Excluir
                    </Button>
                  )}
                  {pode('financeiro.pagamento_editar') && (
                    <Button
                      onClick={iniciarEdicaoPagamento}
                      className="bg-green-700 hover:bg-green-800"
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Editar
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
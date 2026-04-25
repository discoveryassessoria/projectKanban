// src/components/financeiro/subabas/Receitas.tsx
//
// 🆕 LOTE 5 BLOCO F-2: Receitas reformada pra bater com o protótipo HTML.
//
// Adições em cima da versão anterior do Bloco F:
//   1. Botão "Detalhar →" em cada um dos 4 KPIs do topo
//   2. Card "🔔 Próximos vencimentos" (faturas + honorários vencendo em 7d)
//   3. Header "Receitas do processo · N itens · Recebimentos do cliente"
//      com busca, select de ordenação e dropdowns Recibos/Relatórios
//   4. Seção "📋 Pasta Documental a repassar" (custos da TabelaCustos
//      não-internos, com breakdown por tipo)
//   5. Labels de seção "📄 Faturas emitidas (N)" e
//      "💼 Honorários Discovery e serviços (N)"
//
// Os botões "Detalhar", "Recibos", "Relatórios" e "Lançar pagamento" da
// pasta ficam como placeholders visuais por enquanto (Lote 6/7).

"use client"

import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Plus,
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
  FileDown,
  Briefcase,
  FileText,
  Search,
  Bell,
} from "lucide-react"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { NovaFaturaModal } from "../../kanban/NovaFaturaModal"
import { ExportarFaturaModal } from "../../kanban/ExportarFaturaModal"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { fmtBRL } from "@/src/lib/financeiro/helpers"
import { OutroCustoCard } from "@/src/components/financeiro/cards/OutroCustoCard"
import { NovoOutroCustoModal } from "@/src/components/financeiro/modals/NovoOutroCustoModal"
import type {
  OutroCustoData,
  TotaisOutrosCustos,
} from "@/src/types/outros-custos"
import {
  filtrarPorBusca,
  ordenarOutrosCustos,
  type OrdemOutroCusto,
} from "@/src/lib/financeiro/outros-custos-helpers"

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
  comprovanteUrl: string | null
  comprovanteNome: string | null
  observacao: string | null
  cambio: number | null
  valorOriginal: number | null
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
  parcelasBoleto?: Parcela[]
}

interface Totais {
  total: number
  pago: number
  pendente: number
  vencido: number
}

interface TotaisGeralBRL {
  total: number
  pago: number
  pendente: number
  vencido: number
}

// 🆕 Pasta Documental — totalizada a partir de /api/processos/:id/custos
interface PastaDocumental {
  total: number
  pago: number
  count: number
  detalhes: {
    cert: number
    trad: number
    apost: number
    outros: number
  }
}

interface ReceitasProps {
  processoId: number
  nomeFamilia?: string
  onUpdate?: () => void
}

type MetodoPagamento =
  | 'PIX'
  | 'BOLETO'
  | 'TRANSFERENCIA'
  | 'CARTAO_CREDITO'
  | 'CARTAO_DEBITO'
  | 'DINHEIRO'
  | 'CHEQUE'
  | 'OUTRO'

// ========================================
// CONSTANTS
// ========================================
const STATUS_CONFIG = {
  PENDENTE: {
    label: 'Pendente',
    color: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    icon: Clock,
  },
  PAGO: {
    label: 'Pago',
    color: 'bg-green-100 text-green-700 border-green-200',
    icon: Check,
  },
  VENCIDO: {
    label: 'Vencido',
    color: 'bg-red-100 text-red-700 border-red-200',
    icon: AlertCircle,
  },
  PARCIAL: {
    label: 'Parcial',
    color: 'bg-orange-100 text-orange-700 border-orange-200',
    icon: TrendingDown,
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
  USD: '$',
}

// ========================================
// COMPONENT
// ========================================
export function Receitas({ processoId, nomeFamilia, onUpdate }: ReceitasProps) {
  const { pode } = usePermissoes()

  // ---- ESTADO FATURAS ----
  const [faturas, setFaturas] = useState<Fatura[]>([])
  const [totais, setTotais] = useState<Totais>({ total: 0, pago: 0, pendente: 0, vencido: 0 })
  const [totaisGeralBRL, setTotaisGeralBRL] = useState<TotaisGeralBRL>({ total: 0, pago: 0, pendente: 0, vencido: 0 })
  const [requerentes, setRequerentes] = useState<Requerente[]>([])
  const [loading, setLoading] = useState(true)

  const [showNovaFatura, setShowNovaFatura] = useState(false)
  const [showExportarPDF, setShowExportarPDF] = useState(false)
  const [showPagar, setShowPagar] = useState<Fatura | null>(null)
  const [expandedFatura, setExpandedFatura] = useState<number | null>(null)

  const [confirmarParcela, setConfirmarParcela] = useState<{
    fatura: Fatura
    parcela: Parcela
  } | null>(null)
  const [salvandoParcela, setSalvandoParcela] = useState(false)

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

  const [pagarValor, setPagarValor] = useState('')
  const [pagarData, setPagarData] = useState('')
  const [pagarDestinatarioIds, setPagarDestinatarioIds] = useState<number[]>([])
  const [pagarMetodo, setPagarMetodo] = useState<MetodoPagamento>('PIX')
  const [pagarCambio, setPagarCambio] = useState('')
  const [pagarObservacao, setPagarObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)

  // ---- ESTADO OUTROS CUSTOS (COBRAR) ----
  const [outrosCustos, setOutrosCustos] = useState<OutroCustoData[]>([])
  const [totaisOC, setTotaisOC] = useState<TotaisOutrosCustos | null>(null)
  const [modalNovoCobrarAberto, setModalNovoCobrarAberto] = useState(false)
  const [buscaOC, setBuscaOC] = useState('')
  const [ordemOC, setOrdemOC] = useState<OrdemOutroCusto>('vencimento')

  // 🆕 ---- ESTADO PASTA DOCUMENTAL ----
  const [pastaDocumental, setPastaDocumental] = useState<PastaDocumental | null>(null)

  // 🆕 ---- DROPDOWNS Recibos / Relatórios ----
  const [dropdownAberto, setDropdownAberto] = useState<null | 'recibos' | 'relatorios'>(null)

  // ========================================
  // COMPUTED VALUES
  // ========================================
  const totaisPorMoeda = useMemo(() => {
    const resultado: Record<string, { total: number; pago: number; pendente: number; vencido: number }> = {}
    faturas.forEach((fatura) => {
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

  const moedasOrdenadas = useMemo(() => {
    const moedas = Object.keys(totaisPorMoeda)
    return moedas.sort((a, b) => {
      if (a === 'BRL') return -1
      if (b === 'BRL') return 1
      return a.localeCompare(b)
    })
  }, [totaisPorMoeda])

  const honorariosFiltrados = useMemo(() => {
    let lista = outrosCustos.filter((oc) => oc.natureza === 'COBRAR')
    lista = filtrarPorBusca(lista, buscaOC)
    lista = ordenarOutrosCustos(lista, ordemOC)
    return lista
  }, [outrosCustos, buscaOC, ordemOC])

  const honorariosTotal = outrosCustos.filter((oc) => oc.natureza === 'COBRAR').length

  // KPIs CONSOLIDADOS (Faturas + Honorários COBRAR + Pasta Documental)
  const kpisConsolidados = useMemo(() => {
    const fatTotal = totaisGeralBRL.total
    const fatPago = totaisGeralBRL.pago
    const fatPendente = totaisGeralBRL.pendente
    const fatVencido = totaisGeralBRL.vencido

    const honTotal = totaisOC?.totalCobrarBRL ?? 0
    const honPago = totaisOC?.totalRecebidoBRL ?? 0
    const honPendente = totaisOC?.totalARecebidoBRL ?? 0

    const pastaTotal = pastaDocumental?.total ?? 0
    const pastaPago = pastaDocumental?.pago ?? 0
    const pastaPendente = Math.max(0, pastaTotal - pastaPago)

    const totalGeral = fatTotal + honTotal + pastaTotal
    const totalPago = fatPago + honPago + pastaPago

    return {
      total: totalGeral,
      pago: totalPago,
      pendente: fatPendente + honPendente + pastaPendente,
      vencido: fatVencido,
      qtdItens:
        faturas.length +
        honorariosTotal +
        (pastaDocumental && pastaDocumental.count > 0 ? 1 : 0),
      qtdPendentes: faturas.filter((f) => f.status === 'PENDENTE' || f.status === 'PARCIAL').length,
      qtdVencidas: faturas.filter((f) => f.status === 'VENCIDO').length,
    }
  }, [totaisGeralBRL, totaisOC, pastaDocumental, faturas, honorariosTotal])

  const pctRecebido =
    kpisConsolidados.total > 0
      ? (kpisConsolidados.pago / kpisConsolidados.total) * 100
      : 0

  // 🆕 Próximos vencimentos (faturas + honorários COBRAR vencendo em 7d)
  const proximosVencimentos = useMemo(() => {
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)
    const lista: { nome: string; dias: number; valor: number; moeda: string }[] = []

    faturas.forEach((f) => {
      if (!f.dataVencimento || f.status === 'PAGO') return
      const venc = new Date(f.dataVencimento)
      venc.setHours(0, 0, 0, 0)
      const dias = Math.ceil((venc.getTime() - hoje.getTime()) / 86400000)
      if (dias < 0 || dias > 7) return
      if (Number(f.valorRestante || 0) <= 0.005) return
      lista.push({
        nome: f.descricao,
        dias,
        valor: f.valorRestante,
        moeda: f.moeda,
      })
    })

    outrosCustos
      .filter((oc) => oc.natureza === 'COBRAR' && oc.vencimento)
      .forEach((oc) => {
        const venc = new Date(oc.vencimento as string)
        venc.setHours(0, 0, 0, 0)
        const dias = Math.ceil((venc.getTime() - hoje.getTime()) / 86400000)
        if (dias < 0 || dias > 7) return
        const pagos =
          (
            oc as unknown as {
              pagamentos?: Array<{
                valor?: number | null
                estornado?: boolean
              }>
            }
          ).pagamentos
            ?.filter((p) => !p.estornado)
            .reduce((s, p) => s + Number(p.valor || 0), 0) || 0
        const restante = Number(oc.valor || 0) - pagos
        if (restante <= 0.005) return
        lista.push({
          nome: oc.descricao || oc.tipo,
          dias,
          valor: restante,
          moeda: oc.moeda,
        })
      })

    lista.sort((a, b) => a.dias - b.dias)
    return lista
  }, [faturas, outrosCustos])

  const pagarCambioNumerico = useMemo(() => {
    const num = parseFloat(pagarCambio.replace(',', '.'))
    return isNaN(num) ? 0 : num
  }, [pagarCambio])

  const pagarValorNumerico = useMemo(() => {
    const num = parseFloat(pagarValor.replace(',', '.'))
    return isNaN(num) ? 0 : num
  }, [pagarValor])

  const pagarValorEmBRL = useMemo(() => {
    if (!showPagar) return 0
    if (showPagar.moeda === 'BRL') return pagarValorNumerico
    if (!pagarCambioNumerico) return 0
    return pagarValorNumerico * pagarCambioNumerico
  }, [showPagar, pagarValorNumerico, pagarCambioNumerico])

  // ========================================
  // DATA LOADING
  // ========================================
  useEffect(() => {
    carregarDados()
    carregarOutrosCustos()
    carregarPastaDocumental()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processoId])

  // Fecha dropdowns ao clicar fora
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest('.rc-dropdown')) {
        setDropdownAberto(null)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  const carregarDados = async () => {
    try {
      setLoading(true)

      const [faturasRes, processoRes] = await Promise.all([
        fetch(`/api/processos/${processoId}/faturas`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        }),
        fetch(`/api/processos/${processoId}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        }),
      ])

      if (faturasRes.ok) {
        const data = await faturasRes.json()
        setFaturas(data.faturas || [])
        setTotais(data.totais || { total: 0, pago: 0, pendente: 0, vencido: 0 })
        setTotaisGeralBRL(data.totaisGeralBRL || { total: 0, pago: 0, pendente: 0, vencido: 0 })
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

  async function carregarOutrosCustos() {
    try {
      const res = await fetch(`/api/processos/${processoId}/outros-custos`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
        },
      })
      if (!res.ok) return
      const data = await res.json()
      setOutrosCustos(data.outrosCustos || [])
      setTotaisOC(data.totais || null)
    } catch (err) {
      console.error('[Receitas] erro ao carregar outros custos:', err)
    }
  }

  // 🆕 Carrega pasta documental (custos não-internos da TabelaCustos)
  async function carregarPastaDocumental() {
    try {
      const res = await fetch(`/api/processos/${processoId}/custos`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
        },
      })
      if (!res.ok) return
      const data = await res.json()

      // A API retorna totalGeral, mas pra fazer breakdown por tipo precisamos
      // dos totais por serviço. Se a API retornar um array `totaisPorServico`,
      // usamos. Se não, caímos no total global.
      const totaisPorServico: Record<string, number> = data.totaisPorServico || {}
      const total = Number(data.totalGeral || 0)
      const count = Number(data.qtdLancamentos || 0)

      // Heurística: tenta classificar pelos nomes dos serviços
      let cert = 0,
        trad = 0,
        apost = 0,
        outros = 0
      Object.entries(totaisPorServico).forEach(([nome, valor]) => {
        const n = String(nome).toLowerCase()
        const v = Number(valor || 0)
        if (n.includes('cert') || n.includes('desm') || n.includes('retif')) {
          cert += v
        } else if (n.includes('trad')) {
          trad += v
        } else if (n.includes('apost')) {
          apost += v
        } else {
          outros += v
        }
      })

      // Se não veio breakdown, joga tudo em "outros" só pra somar igual ao total
      const somaBreakdown = cert + trad + apost + outros
      if (somaBreakdown < total - 0.005) {
        outros += total - somaBreakdown
      }

      setPastaDocumental({
        total,
        pago: 0, // sem API de pagamento da pasta ainda — placeholder visual
        count,
        detalhes: { cert, trad, apost, outros },
      })
    } catch (err) {
      console.error('[Receitas] erro ao carregar pasta documental:', err)
    }
  }

  function handleNovoHonorario(novo: OutroCustoData) {
    setOutrosCustos((atuais) => [novo, ...atuais])
    carregarOutrosCustos()
  }

  function handleAtualizarOutroCusto(atualizado: OutroCustoData) {
    setOutrosCustos((atuais) =>
      atuais.map((oc) => (oc.id === atualizado.id ? atualizado : oc)),
    )
    carregarOutrosCustos()
  }

  function handleExcluirOutroCusto(id: number) {
    setOutrosCustos((atuais) => atuais.filter((oc) => oc.id !== id))
    carregarOutrosCustos()
  }

  // ========================================
  // HANDLERS (faturas — mantidos do original)
  // ========================================
  const handleMarcarParcelaPaga = async () => {
    if (!confirmarParcela) return
    try {
      setSalvandoParcela(true)
      const { fatura, parcela } = confirmarParcela
      const response = await fetch(
        `/api/processos/${processoId}/faturas/${fatura.id}/parcelas/${parcela.id}/pagar`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        },
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

  const handleDesmarcarParcela = async (fatura: Fatura, parcela: Parcela) => {
    if (!confirm('Desmarcar esta parcela como não paga?')) return
    try {
      const response = await fetch(
        `/api/processos/${processoId}/faturas/${fatura.id}/parcelas/${parcela.id}/pagar`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        },
      )
      if (response.ok) {
        carregarDados()
        onUpdate?.()
      }
    } catch (error) {
      console.error('Erro ao desmarcar parcela:', error)
    }
  }

  const togglePagarDestinatario = (id: number) => {
    setPagarDestinatarioIds((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id],
    )
  }

  const selectAllPagarDestinatarios = () => {
    if (pagarDestinatarioIds.length === requerentes.length) {
      setPagarDestinatarioIds([])
    } else {
      setPagarDestinatarioIds(requerentes.map((r) => r.id))
    }
  }

  const abrirModalPagamento = (fatura: Fatura) => {
    setPagarValor(String(fatura.valorRestante))
    setPagarData(new Date().toISOString().split('T')[0])
    setPagarDestinatarioIds(fatura.destinatarios?.map((d) => d.id) || [])
    setPagarMetodo('PIX')
    setPagarCambio(fatura.cambio ? String(fatura.cambio) : '')
    setPagarObservacao('')
    setShowPagar(fatura)
  }

  const handlePagar = async () => {
    if (!showPagar) return
    try {
      setSalvando(true)
      const response = await fetch(`/api/processos/${processoId}/faturas/${showPagar.id}/pagar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('authToken')}`,
        },
        body: JSON.stringify({
          formaPagamento: pagarMetodo,
          valorPago: pagarValorNumerico,
          valorEmReais:
            showPagar.moeda !== 'BRL' && pagarCambioNumerico > 0 ? pagarValorEmBRL : null,
          cambio: showPagar.moeda !== 'BRL' ? pagarCambioNumerico : null,
          dataPagamento: pagarData || null,
          observacao: pagarObservacao || null,
          destinatarioIds: pagarDestinatarioIds.length > 0 ? pagarDestinatarioIds : null,
        }),
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
    if (!confirm('Tem certeza que deseja excluir esta fatura? Esta ação não pode ser desfeita.'))
      return
    try {
      const response = await fetch(`/api/processos/${processoId}/faturas/${fatura.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
      })
      if (response.ok) {
        carregarDados()
        onUpdate?.()
      }
    } catch (error) {
      console.error('Erro ao excluir fatura:', error)
    }
  }

  const abrirVisualizarPagamento = (fatura: Fatura, pagamento: Pagamento) => {
    setPagamentoSelecionado({ fatura, pagamento })
    setEditandoPagamento(false)
  }

  const iniciarEdicaoPagamento = () => {
    if (!pagamentoSelecionado) return
    const { pagamento } = pagamentoSelecionado
    setEditPagValor(String(pagamento.valor))
    setEditPagData(pagamento.data ? pagamento.data.split('T')[0] : '')
    setEditPagMetodo((pagamento.formaPagamento as MetodoPagamento) || 'PIX')
    setEditPagObservacao(pagamento.observacao || '')
    setEditPagDestinatarioIds(pagamento.destinatarios?.map((d) => d.id) || [])
    setEditPagCambio(pagamento.cambio ? String(pagamento.cambio) : '')
    setEditandoPagamento(true)
  }

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
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('authToken')}`,
          },
          body: JSON.stringify({
            valor: valorNumerico,
            valorOriginal: valorEmReais,
            cambio: cambioNumerico,
            data: editPagData || null,
            formaPagamento: editPagMetodo,
            observacao: editPagObservacao || null,
            destinatarioIds: editPagDestinatarioIds.length > 0 ? editPagDestinatarioIds : null,
          }),
        },
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

  const excluirPagamento = async () => {
    if (!pagamentoSelecionado) return
    if (!confirm('Tem certeza que deseja excluir este pagamento?')) return
    try {
      const { fatura, pagamento } = pagamentoSelecionado
      const response = await fetch(
        `/api/processos/${processoId}/faturas/${fatura.id}/pagamentos/${pagamento.id}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        },
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

  const toggleEditPagDestinatario = (id: number) => {
    setEditPagDestinatarioIds((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id],
    )
  }

  // ========================================
  // FORMATTERS
  // ========================================
  const formatarMoeda = (valor: number, moeda: string = 'BRL') => {
    return valor.toLocaleString('pt-BR', {
      style: 'currency',
      currency: moeda === 'BRL' ? 'BRL' : moeda,
    })
  }

  const formatarData = (data: string | null) => {
    if (!data) return '-'
    return new Date(data).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
  }

  const isParcelaVencida = (parcela: Parcela) => {
    if (parcela.pago) return false
    const hoje = new Date()
    hoje.setUTCHours(0, 0, 0, 0)
    const vencimento = new Date(parcela.dataVencimento)
    vencimento.setUTCHours(0, 0, 0, 0)
    return vencimento < hoje
  }

  // 🆕 Stub pra "Detalhar →" — placeholder até Lote 6
  function abrirDetalhesKPI(qual: string) {
    alert(`Detalhar KPI "${qual}" — em breve.`)
  }

  // ========================================
  // RENDER
  // ========================================
  return (
    <div className="flex flex-col bg-gray-50">
      {/* ========================================================== */}
      {/* KPIs CONSOLIDADOS                                            */}
      {/* ========================================================== */}
      <div className="px-6 pt-6">
        <div className="fin-kpi-grid">
          <div className="fin-card fin-card--purple rc-card-wrap">
            <div className="fin-kpi">
              <span className="fin-kpi__label">Total Cobrado</span>
              <span className="fin-kpi__value fin-kpi__value--purple">
                {fmtBRL(kpisConsolidados.total)}
              </span>
              <span className="fin-kpi__hint">
                {kpisConsolidados.qtdItens} {kpisConsolidados.qtdItens === 1 ? 'lançamento' : 'lançamentos'}
              </span>
            </div>
            <button
              type="button"
              className="rc-card-detalhar"
              onClick={() => abrirDetalhesKPI('totalCobrado')}
            >
              Detalhar →
            </button>
          </div>

          <div className="fin-card fin-card--green rc-card-wrap">
            <div className="fin-kpi">
              <span className="fin-kpi__label">Recebido</span>
              <span className="fin-kpi__value fin-kpi__value--green">
                {fmtBRL(kpisConsolidados.pago)}
              </span>
              <span className="fin-kpi__hint">
                {pctRecebido.toFixed(0)}% do total
              </span>
            </div>
            <button
              type="button"
              className="rc-card-detalhar"
              onClick={() => abrirDetalhesKPI('recebido')}
            >
              Detalhar →
            </button>
          </div>

          <div className="fin-card fin-card--yellow rc-card-wrap">
            <div className="fin-kpi">
              <span className="fin-kpi__label">A Receber</span>
              <span className="fin-kpi__value fin-kpi__value--yellow">
                {fmtBRL(kpisConsolidados.pendente)}
              </span>
              <span className="fin-kpi__hint">
                {kpisConsolidados.qtdPendentes} {kpisConsolidados.qtdPendentes === 1 ? 'item pendente' : 'itens pendentes'}
              </span>
            </div>
            <button
              type="button"
              className="rc-card-detalhar"
              onClick={() => abrirDetalhesKPI('aReceber')}
            >
              Detalhar →
            </button>
          </div>

          <div className="fin-card fin-card--red rc-card-wrap">
            <div className="fin-kpi">
              <span className="fin-kpi__label">Vencido</span>
              <span className="fin-kpi__value fin-kpi__value--red">
                {fmtBRL(kpisConsolidados.vencido)}
              </span>
              <span className="fin-kpi__hint">
                {kpisConsolidados.qtdVencidas} {kpisConsolidados.qtdVencidas === 1 ? 'item em atraso' : 'itens em atraso'}
              </span>
            </div>
            <button
              type="button"
              className="rc-card-detalhar"
              onClick={() => abrirDetalhesKPI('vencido')}
            >
              Detalhar →
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================== */}
      {/* 🆕 Próximos vencimentos (7d)                                */}
      {/* ========================================================== */}
      {proximosVencimentos.length > 0 && (
        <div className="px-6 pt-4">
          <div className="rc-proxvenc-card">
            <div className="rc-proxvenc-head">
              <Bell className="h-4 w-4 text-amber-600" />
              <span>Próximos vencimentos ({proximosVencimentos.length})</span>
            </div>
            <div className="rc-proxvenc-list">
              {proximosVencimentos.slice(0, 3).map((v, i) => (
                <div key={i} className="rc-proxvenc-item">
                  <span className="rc-proxvenc-nome">
                    <strong>{v.nome}</strong> · {formatarMoeda(v.valor, v.moeda)}
                  </span>
                  <span className={`rc-proxvenc-dias ${v.dias <= 1 ? 'urgente' : ''}`}>
                    {v.dias === 0 ? 'Hoje' : v.dias === 1 ? 'Amanhã' : `${v.dias} dias`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================== */}
      {/* 🆕 Header: "Receitas do processo" + busca + dropdowns       */}
      {/* ========================================================== */}
      <div className="px-6 pt-4">
        <div className="rc-listagem-head">
          <div>
            <div className="rc-titulo">Receitas do processo</div>
            <div className="rc-sub">
              {kpisConsolidados.qtdItens} {kpisConsolidados.qtdItens === 1 ? 'item' : 'itens'} · Recebimentos do cliente
            </div>
          </div>
          <div className="rc-topbar-acoes">
            <div className="rc-busca-wrap">
              <Search className="rc-busca-icon" />
              <input
                type="text"
                value={buscaOC}
                onChange={(e) => setBuscaOC(e.target.value)}
                placeholder="Buscar..."
                className="rc-busca"
              />
            </div>
            <select
              value={ordemOC}
              onChange={(e) => setOrdemOC(e.target.value as OrdemOutroCusto)}
              className="rc-ordem"
            >
              <option value="vencimento">Vencimento</option>
              <option value="valor">Valor</option>
              <option value="criacao">Mais recentes</option>
            </select>

            <div className="rc-dropdown">
              <button
                type="button"
                className="rc-dropdown-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  setDropdownAberto(dropdownAberto === 'recibos' ? null : 'recibos')
                }}
              >
                <FileText className="h-4 w-4" />
                Recibos ▾
              </button>
              {dropdownAberto === 'recibos' && (
                <div className="rc-dropdown-menu">
                  <button onClick={() => alert('Em breve')}>Gerar recibo individual</button>
                  <button onClick={() => alert('Em breve')}>Por requerente</button>
                  <button onClick={() => alert('Em breve')}>Recibo consolidado do processo</button>
                  <button onClick={() => alert('Em breve')}>Histórico emitidos</button>
                </div>
              )}
            </div>

            <div className="rc-dropdown">
              <button
                type="button"
                className="rc-dropdown-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  setDropdownAberto(dropdownAberto === 'relatorios' ? null : 'relatorios')
                }}
              >
                <FileDown className="h-4 w-4" />
                Relatórios ▾
              </button>
              {dropdownAberto === 'relatorios' && (
                <div className="rc-dropdown-menu">
                  <button onClick={() => setShowExportarPDF(true)}>
                    Extrato de Receitas (PDF)
                  </button>
                  <button onClick={() => alert('Em breve')}>Extrato por Requerente (PDF)</button>
                  <button onClick={() => alert('Em breve')}>Relatório de Inadimplência (PDF)</button>
                  <button onClick={() => alert('Em breve')}>Export CSV</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================== */}
      {/* SEÇÃO: FATURAS                                              */}
      {/* ========================================================== */}
      {faturas.length > 0 && (
        <div className="px-6 pt-4">
          <div className="rc-secao-lbl">📄 Faturas emitidas ({faturas.length})</div>
        </div>
      )}

      <div className="flex flex-col">
        <div className="px-6 pb-4 pt-2">
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
                  Clique em &quot;Nova Fatura&quot; para adicionar
                </p>
                {pode('financeiro.fatura_criar') && (
                  <Button onClick={() => setShowNovaFatura(true)} size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                    <Plus className="h-4 w-4 mr-1" />
                    Nova Fatura
                  </Button>
                )}
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  {faturas.map((fatura) => {
                    const config = STATUS_CONFIG[fatura.status]
                    const StatusIcon = config.icon
                    const isExpanded = expandedFatura === fatura.id
                    const temMoedaEstrangeira = fatura.moeda !== 'BRL'
                    const isBoleto = fatura.metodoPagamento === 'BOLETO'
                    const temParcelas = fatura.parcelasBoleto && fatura.parcelasBoleto.length > 0

                    return (
                      <div key={fatura.id} className="bg-white rounded-xl border shadow-sm overflow-hidden">
                        <div className="p-4 cursor-pointer hover:bg-gray-50 transition-colors" onClick={() => setExpandedFatura(isExpanded ? null : fatura.id)}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4 flex-1">
                              <div className={`p-2 rounded-lg ${config.color}`}>
                                <StatusIcon className="h-4 w-4" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900 truncate">{fatura.descricao}</p>
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
                                      {fatura.cambio && <span className="text-xs text-gray-400">(câmbio: {fatura.cambio})</span>}
                                    </span>
                                  )}
                                  {fatura.parcelas > 1 && <span className="text-amber-600 font-medium">{fatura.parcelas}x</span>}
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
                                <p className="font-bold text-gray-900 text-lg">{formatarMoeda(fatura.valor, fatura.moeda)}</p>
                                {temMoedaEstrangeira && fatura.cambio && (
                                  <p className="text-xs text-gray-500">≈ {formatarMoeda(fatura.valor * fatura.cambio, 'BRL')}</p>
                                )}
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border mt-1 ${config.color}`}>
                                  {config.label}
                                </span>
                              </div>
                              <button className="text-gray-400 hover:text-gray-600 ml-2">
                                {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                              </button>
                            </div>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="border-t bg-gray-50 p-4">
                            {fatura.destinatarios?.length > 0 && (
                              <div className="mb-4">
                                <p className="text-xs text-gray-500 uppercase mb-2 flex items-center gap-1">
                                  <Users className="h-3 w-3" />
                                  Destinatários
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {fatura.destinatarios.map((dest) => (
                                    <span key={dest.id} className="px-2 py-1 bg-white border rounded-lg text-sm">
                                      {dest.nome}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

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
                                        <div key={parcela.id} className={`grid grid-cols-[auto_1fr_auto_auto] gap-4 p-3 items-center ${parcela.pago ? 'bg-green-50' : vencida ? 'bg-red-50' : ''}`}>
                                          <div className="flex items-center gap-2">
                                            {parcela.pago ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : vencida ? <AlertCircle className="h-5 w-5 text-red-500" /> : <CircleDot className="h-5 w-5 text-gray-400" />}
                                            <span className={`font-medium ${parcela.pago ? 'text-green-700' : vencida ? 'text-red-700' : 'text-gray-700'}`}>
                                              {parcela.numero}/{fatura.parcelas}
                                            </span>
                                          </div>
                                          <div>
                                            <span className={`${parcela.pago ? 'text-green-700' : vencida ? 'text-red-700 font-medium' : 'text-gray-700'}`}>
                                              {formatarData(parcela.dataVencimento)}
                                            </span>
                                            {parcela.pago && parcela.dataPagamento && (
                                              <span className="text-xs text-green-600 ml-2">(pago em {formatarData(parcela.dataPagamento)})</span>
                                            )}
                                            {vencida && !parcela.pago && <span className="text-xs text-red-600 ml-2">Vencida</span>}
                                          </div>
                                          <div className={`text-right font-medium ${parcela.pago ? 'text-green-700' : vencida ? 'text-red-700' : 'text-gray-900'}`}>
                                            {formatarMoeda(parcela.valor)}
                                          </div>
                                          <div className="flex justify-center">
                                            {pode('financeiro.pagamento_criar') && (
                                              <>
                                                {parcela.pago ? (
                                                  <button onClick={(e) => { e.stopPropagation(); handleDesmarcarParcela(fatura, parcela) }} className="text-xs text-gray-500 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors">
                                                    Desfazer
                                                  </button>
                                                ) : (
                                                  <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setConfirmarParcela({ fatura, parcela }) }} className={`text-xs h-8 ${vencida ? 'border-red-300 text-red-700 hover:bg-red-100' : 'border-green-300 text-green-700 hover:bg-green-100'}`}>
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
                                </div>
                              </div>
                            )}

                            {(!isBoleto || !temParcelas) && (
                              <div className="grid grid-cols-3 gap-4 mb-4 p-3 bg-white rounded-lg border">
                                <div>
                                  <p className="text-xs text-gray-500 uppercase">Valor Total</p>
                                  <p className="text-sm font-bold text-gray-900">{formatarMoeda(fatura.valor, fatura.moeda)}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-500 uppercase">Pago</p>
                                  <p className="text-sm font-bold text-green-600">{formatarMoeda(fatura.valorPago, fatura.moeda)}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-500 uppercase">Restante</p>
                                  <p className="text-sm font-bold text-orange-600">{formatarMoeda(fatura.valorRestante, fatura.moeda)}</p>
                                </div>
                              </div>
                            )}

                            {fatura.pagamentos && fatura.pagamentos.length > 0 && (
                              <div className="mb-4">
                                <p className="text-xs text-gray-500 uppercase mb-2">Histórico de Pagamentos</p>
                                <div className="space-y-2">
                                  {fatura.pagamentos.map((pag, idx) => (
                                    <div key={pag.id} onClick={(e) => { e.stopPropagation(); abrirVisualizarPagamento(fatura, pag) }} className="p-3 bg-white rounded-lg border hover:border-green-300 hover:bg-green-50 cursor-pointer transition-colors">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                          <span className="text-gray-400 text-sm">#{idx + 1}</span>
                                          <span className="font-bold text-green-600">{formatarMoeda(pag.valor, fatura.moeda)}</span>
                                          {fatura.moeda !== 'BRL' && pag.valorOriginal && (
                                            <span className="text-gray-500 text-sm">({formatarMoeda(pag.valorOriginal, 'BRL')})</span>
                                          )}
                                          <span className="text-gray-500 text-sm">{formatarData(pag.data)}</span>
                                          {pag.formaPagamento && (
                                            <span className="px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-600">{FORMAS_PAGAMENTO[pag.formaPagamento] || pag.formaPagamento}</span>
                                          )}
                                        </div>
                                        <ChevronDown className="h-4 w-4 text-gray-400" />
                                      </div>
                                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                        {pag.destinatarios && pag.destinatarios.length > 0 && (
                                          <span className="flex items-center gap-1 text-gray-500">
                                            <Users className="h-3 w-3" />
                                            {pag.destinatarios.map((d) => d.nome).join(', ')}
                                          </span>
                                        )}
                                        {pag.observacao && <span className="text-gray-500 italic truncate max-w-xs">&quot;{pag.observacao}&quot;</span>}
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

                            <div className="flex items-center gap-2 pt-3 border-t">
                              {fatura.status !== 'PAGO' && !isBoleto && pode('financeiro.pagamento_criar') && (
                                <Button size="sm" onClick={(e) => { e.stopPropagation(); abrirModalPagamento(fatura) }} className="bg-green-600 hover:bg-green-700">
                                  <Check className="h-4 w-4 mr-1" />
                                  {fatura.status === 'PARCIAL' ? 'Registrar Pagamento' : 'Marcar como Pago'}
                                </Button>
                              )}
                              {pode('financeiro.fatura_excluir') && (
                                <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); handleExcluir(fatura) }} className="text-red-500 hover:text-red-600 hover:bg-red-50 ml-auto">
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

                <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-gray-200">
                  <Button onClick={() => setShowExportarPDF(true)} size="sm" variant="outline" className="gap-1 text-blue-600 border-blue-200 hover:bg-blue-50">
                    <FileDown className="h-4 w-4" />
                    Exportar PDF
                  </Button>
                  {pode('financeiro.fatura_criar') && (
                    <Button onClick={() => setShowNovaFatura(true)} size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                      <Plus className="h-4 w-4 mr-1" />
                      Nova Fatura
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
      </div>

      {/* ========================================================== */}
      {/* SEÇÃO: HONORÁRIOS DISCOVERY                                  */}
      {/* ========================================================== */}
      {honorariosTotal > 0 && (
        <div className="px-6 pt-4">
          <div className="rc-secao-lbl">💼 Honorários Discovery e serviços ({honorariosTotal})</div>
        </div>
      )}

      <div className="flex flex-col">
        <div className="px-6 pb-4 pt-2">
            {honorariosTotal === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center bg-white rounded-xl border-2 border-dashed border-gray-200">
                <div className="p-4 bg-purple-50 rounded-full mb-4">
                  <Briefcase className="h-10 w-10 text-purple-300" />
                </div>
                <h4 className="text-gray-700 font-medium mb-1">Nenhum honorário lançado</h4>
                <p className="text-gray-500 text-sm max-w-md mb-4">
                  Honorários, serviços extras e consultorias que serão cobrados do cliente.
                  Diferente das faturas, podem ter pagamentos parciais flexíveis e moeda estrangeira.
                </p>
                <Button onClick={() => setModalNovoCobrarAberto(true)} size="sm" className="bg-purple-600 hover:bg-purple-700">
                  <Plus className="h-4 w-4 mr-1" />
                  Novo Lançamento
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  {honorariosFiltrados.map((oc) => (
                    <OutroCustoCard
                      key={oc.id}
                      outroCusto={oc}
                      onAtualizar={handleAtualizarOutroCusto}
                      onExcluir={handleExcluirOutroCusto}
                    />
                  ))}
                </div>

                <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-gray-200">
                  <Button onClick={() => setModalNovoCobrarAberto(true)} size="sm" className="bg-purple-600 hover:bg-purple-700">
                    <Plus className="h-4 w-4 mr-1" />
                    Novo Lançamento
                  </Button>
                </div>
              </>
            )}
          </div>
      </div>

      {/* ========================================================== */}
      {/* 🆕 SEÇÃO: PASTA DOCUMENTAL A REPASSAR                        */}
      {/* ========================================================== */}
      {pastaDocumental && pastaDocumental.count > 0 && pastaDocumental.total > 0 && (
        <>
          <div className="px-6 pt-4">
            <div className="rc-secao-lbl">📋 Pasta Documental a repassar</div>
          </div>
          <div className="px-6 pb-6 pt-2">
            <div className="rc-pasta-card">
              <div className="rc-pasta-head">
                <div className="rc-pasta-titulo-wrap">
                  <div className="rc-pasta-titulo">
                    📋 Pasta Documental · {pastaDocumental.count}{' '}
                    {pastaDocumental.count === 1 ? 'item' : 'itens'}
                  </div>
                  <div className="rc-pasta-meta">
                    {pastaDocumental.detalhes.cert > 0 && (
                      <span>📜 Certidões {fmtBRL(pastaDocumental.detalhes.cert)}</span>
                    )}
                    {pastaDocumental.detalhes.trad > 0 && (
                      <span>🌐 Traduções {fmtBRL(pastaDocumental.detalhes.trad)}</span>
                    )}
                    {pastaDocumental.detalhes.apost > 0 && (
                      <span>✓ Apostilamentos {fmtBRL(pastaDocumental.detalhes.apost)}</span>
                    )}
                    {pastaDocumental.detalhes.outros > 0 && (
                      <span>+ Outros {fmtBRL(pastaDocumental.detalhes.outros)}</span>
                    )}
                  </div>
                </div>
                <div className="rc-pasta-valor-wrap">
                  <div className="rc-pasta-valor">{fmtBRL(pastaDocumental.total)}</div>
                  <div className="rc-pasta-status">A receber</div>
                </div>
              </div>

              <div className="rc-pasta-progresso-wrap">
                <div className="rc-pasta-progresso">
                  <div
                    className="rc-pasta-progresso-fill"
                    style={{
                      width: `${
                        pastaDocumental.total > 0
                          ? (pastaDocumental.pago / pastaDocumental.total) * 100
                          : 0
                      }%`,
                    }}
                  />
                </div>
                <div className="rc-pasta-progresso-info">
                  <span>
                    {pastaDocumental.pago > 0
                      ? `Recebido ${fmtBRL(pastaDocumental.pago)}`
                      : 'Nenhum pagamento ainda'}
                  </span>
                  <span>
                    {pastaDocumental.total > 0
                      ? ((pastaDocumental.pago / pastaDocumental.total) * 100).toFixed(0)
                      : 0}
                    % · Restante{' '}
                    {fmtBRL(Math.max(0, pastaDocumental.total - pastaDocumental.pago))}
                  </span>
                </div>
              </div>

              <div className="rc-pasta-acoes">
                <button
                  type="button"
                  className="rc-pasta-btn rc-pasta-btn-verde"
                  onClick={() => alert('Em breve — disponível no Lote 6')}
                >
                  💰 Lançar pagamento
                </button>
                <button
                  type="button"
                  className="rc-pasta-btn rc-pasta-btn-ghost"
                  onClick={() => alert('Vá para a aba Custos para editar a planilha.')}
                >
                  ✎ Editar na planilha
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ========================================================== */}
      {/* MODAIS                                                       */}
      {/* ========================================================== */}
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

      {showExportarPDF && (
        <ExportarFaturaModal
          faturas={faturas}
          requerentes={requerentes}
          onClose={() => setShowExportarPDF(false)}
        />
      )}

      <NovoOutroCustoModal
        processoId={processoId}
        isOpen={modalNovoCobrarAberto}
        onClose={() => setModalNovoCobrarAberto(false)}
        onSuccess={handleNovoHonorario}
        naturezaPadrao="COBRAR"
      />

      {confirmarParcela && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setConfirmarParcela(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-gray-900">Confirmar Pagamento</h3>
              <button onClick={() => setConfirmarParcela(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="h-8 w-8 text-green-600" />
              </div>
              <p className="text-gray-700 mb-2">
                Marcar parcela{' '}
                <span className="font-bold">
                  {confirmarParcela.parcela.numero}/{confirmarParcela.fatura.parcelas}
                </span>{' '}
                como paga?
              </p>
              <div className="bg-gray-50 rounded-lg p-3 mt-4 space-y-1">
                <p className="text-sm text-gray-600">Valor: <span className="font-bold text-gray-900">{formatarMoeda(confirmarParcela.parcela.valor)}</span></p>
                <p className="text-sm text-gray-600">Vencimento: <span className="font-medium">{formatarData(confirmarParcela.parcela.dataVencimento)}</span></p>
              </div>
            </div>
            <div className="flex gap-3 p-4 border-t bg-gray-50 rounded-b-xl">
              <Button variant="outline" onClick={() => setConfirmarParcela(null)} className="flex-1" disabled={salvandoParcela}>Cancelar</Button>
              <Button onClick={handleMarcarParcelaPaga} disabled={salvandoParcela} className="flex-1 bg-green-600 hover:bg-green-700 gap-2">
                {salvandoParcela && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                {!salvandoParcela && <Check className="h-4 w-4" />}
                Confirmar
              </Button>
            </div>
          </div>
        </div>
      )}

      {showPagar && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowPagar(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-green-500 to-green-600">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-lg"><Check className="h-5 w-5 text-white" /></div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Registrar Pagamento</h2>
                  <p className="text-sm text-green-100">{showPagar.descricao}</p>
                </div>
              </div>
              <button onClick={() => setShowPagar(null)} className="p-2 hover:bg-white/20 rounded-lg transition-colors">
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
                    <p className="font-bold text-orange-600">{formatarMoeda(showPagar.valorRestante, showPagar.moeda)}</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Valor do Pagamento *</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">{MOEDA_SYMBOLS[showPagar.moeda]}</span>
                      <Input type="text" inputMode="decimal" value={pagarValor} onChange={(e) => setPagarValor(e.target.value)} className="h-11 pl-10" placeholder="0,00" />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Informe o valor na moeda da fatura ({showPagar.moeda})</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Data do Pagamento</label>
                    <DatePickerField value={pagarData} onChange={setPagarData} />
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                      <CreditCard className="h-4 w-4 text-gray-400" />Método de Pagamento
                    </label>
                    <select value={pagarMetodo} onChange={(e) => setPagarMetodo(e.target.value as MetodoPagamento)} className="w-full h-11 px-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500">
                      {METODOS_PAGAMENTO.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </div>
                  {showPagar.moeda !== 'BRL' && (
                    <div>
                      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                        <Coins className="h-4 w-4 text-gray-400" />Câmbio (1 {showPagar.moeda} = R$)
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">R$</span>
                        <Input type="text" inputMode="decimal" value={pagarCambio} onChange={(e) => setPagarCambio(e.target.value)} className="h-11 pl-10" placeholder="6,20" />
                      </div>
                    </div>
                  )}
                  {showPagar.moeda !== 'BRL' && pagarValorNumerico > 0 && pagarCambioNumerico > 0 && (
                    <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-xl border border-blue-100">
                      <div className="flex items-center gap-2 text-blue-700">
                        <span className="font-medium">{MOEDA_SYMBOLS[showPagar.moeda]} {pagarValorNumerico.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                        <ArrowRight className="h-4 w-4" />
                        <span className="font-bold text-lg">{formatarMoeda(pagarValorEmBRL)}</span>
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Observações (opcional)</label>
                    <Input value={pagarObservacao} onChange={(e) => setPagarObservacao(e.target.value)} placeholder="Ex: Pix de fulano, referente a..." />
                  </div>
                </div>
                <div>
                  {requerentes.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                          <Users className="h-4 w-4 text-gray-400" />Destinatário(s)
                        </label>
                        <button type="button" onClick={selectAllPagarDestinatarios} className="text-xs text-green-600 hover:text-green-700 font-medium">
                          {pagarDestinatarioIds.length === requerentes.length ? 'Desmarcar todos' : 'Selecionar todos'}
                        </button>
                      </div>
                      <div className="space-y-2 max-h-[320px] overflow-y-auto">
                        {requerentes.map((req) => {
                          const isSelected = pagarDestinatarioIds.includes(req.id)
                          const endereco = [req.endereco, req.numero, req.bairro, req.cidade, req.estado].filter(Boolean).join(', ')
                          return (
                            <div key={req.id} onClick={() => togglePagarDestinatario(req.id)} className={`p-3 rounded-xl border-2 cursor-pointer transition-all ${isSelected ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                              <div className="flex items-center gap-3">
                                <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-green-500 border-green-500' : 'border-gray-300'}`}>
                                  {isSelected && <Check className="h-3 w-3 text-white" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-gray-900">{req.nome}</p>
                                  {endereco && <p className="text-xs text-gray-500 truncate">{endereco}</p>}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t bg-gray-50">
              <Button variant="outline" onClick={() => setShowPagar(null)} disabled={salvando}>Cancelar</Button>
              <Button onClick={handlePagar} disabled={salvando || !pagarValorNumerico} className="bg-green-600 hover:bg-green-700 min-w-[200px] gap-2">
                {salvando && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                {!salvando && <Check className="h-4 w-4" />}
                Confirmar Pagamento
              </Button>
            </div>
          </div>
        </div>
      )}

      {pagamentoSelecionado && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setPagamentoSelecionado(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-green-500 to-green-600">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-lg">
                  {editandoPagamento ? <Pencil className="h-5 w-5 text-white" /> : <Eye className="h-5 w-5 text-white" />}
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">{editandoPagamento ? 'Editar Pagamento' : 'Detalhes do Pagamento'}</h2>
                  <p className="text-sm text-green-100">{pagamentoSelecionado.fatura.descricao}</p>
                </div>
              </div>
              <button onClick={() => { setPagamentoSelecionado(null); setEditandoPagamento(false) }} className="p-2 hover:bg-white/20 rounded-lg transition-colors">
                <X className="h-5 w-5 text-white" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {editandoPagamento ? (
                <>
                  <div className="bg-gray-50 rounded-xl p-4 border mb-6">
                    <p className="text-xs text-gray-500 uppercase mb-1">Fatura</p>
                    <p className="font-semibold text-gray-900">{pagamentoSelecionado.fatura.descricao}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-5">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Valor do Pagamento *</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">{MOEDA_SYMBOLS[pagamentoSelecionado.fatura.moeda] || pagamentoSelecionado.fatura.moeda}</span>
                          <Input type="text" inputMode="decimal" value={editPagValor} onChange={(e) => setEditPagValor(e.target.value)} className="h-11 pl-10" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Data do Pagamento</label>
                        <DatePickerField value={editPagData} onChange={setEditPagData} />
                      </div>
                      <div>
                        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                          <CreditCard className="h-4 w-4 text-gray-400" />Método de Pagamento
                        </label>
                        <select value={editPagMetodo} onChange={(e) => setEditPagMetodo(e.target.value as MetodoPagamento)} className="w-full h-11 px-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500">
                          {METODOS_PAGAMENTO.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                      </div>
                      {pagamentoSelecionado.fatura.moeda !== 'BRL' && (
                        <div>
                          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                            <Coins className="h-4 w-4 text-gray-400" />Câmbio (1 {pagamentoSelecionado.fatura.moeda} = R$)
                          </label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">R$</span>
                            <Input type="text" inputMode="decimal" value={editPagCambio} onChange={(e) => setEditPagCambio(e.target.value)} placeholder="Ex: 6,20" className="h-11 pl-10" />
                          </div>
                        </div>
                      )}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Observações</label>
                        <Input value={editPagObservacao} onChange={(e) => setEditPagObservacao(e.target.value)} />
                      </div>
                    </div>
                    <div>
                      {requerentes.length > 0 && (
                        <div>
                          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
                            <Users className="h-4 w-4 text-gray-400" />Destinatário(s)
                          </label>
                          <div className="space-y-2 max-h-[320px] overflow-y-auto">
                            {requerentes.map((req) => {
                              const isSelected = editPagDestinatarioIds.includes(req.id)
                              const endereco = [req.endereco, req.numero, req.bairro, req.cidade, req.estado].filter(Boolean).join(', ')
                              return (
                                <div key={req.id} onClick={() => toggleEditPagDestinatario(req.id)} className={`p-3 rounded-xl border-2 cursor-pointer transition-all ${isSelected ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                                  <div className="flex items-center gap-3">
                                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-green-500 border-green-500' : 'border-gray-300'}`}>
                                      {isSelected && <Check className="h-3 w-3 text-white" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="font-medium text-gray-900">{req.nome}</p>
                                      {endereco && <p className="text-xs text-gray-500 truncate">{endereco}</p>}
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
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
                      <div className="bg-green-50 rounded-xl p-4 border border-green-200">
                        <p className="text-xs text-green-600 uppercase font-medium">Valor</p>
                        <p className="text-2xl font-bold text-green-700">{formatarMoeda(pagamentoSelecionado.pagamento.valor, pagamentoSelecionado.fatura.moeda)}</p>
                      </div>
                      <div className="bg-gray-50 rounded-xl p-4 border">
                        <p className="text-xs text-gray-500 uppercase font-medium">Data do Pagamento</p>
                        <p className="text-lg font-semibold text-gray-900 mt-1">{formatarData(pagamentoSelecionado.pagamento.data)}</p>
                      </div>
                      {pagamentoSelecionado.pagamento.formaPagamento && (
                        <div className="bg-gray-50 rounded-xl p-4 border">
                          <p className="text-xs text-gray-500 uppercase font-medium">Método de Pagamento</p>
                          <p className="text-sm font-medium text-gray-900 flex items-center gap-2 mt-1">
                            <CreditCard className="h-4 w-4 text-gray-400" />
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
                          <Users className="h-3 w-3" />Destinatário(s)
                        </p>
                        {pagamentoSelecionado.pagamento.destinatarios && pagamentoSelecionado.pagamento.destinatarios.length > 0 ? (
                          <div className="space-y-2">
                            {pagamentoSelecionado.pagamento.destinatarios.map((dest) => (
                              <div key={dest.id} className="p-3 bg-white border rounded-lg">
                                <p className="font-medium text-gray-900">{dest.nome}</p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-400 italic">Nenhum destinatário vinculado</p>
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
                  <Button variant="outline" onClick={() => setEditandoPagamento(false)} disabled={salvandoEdicao}>Cancelar</Button>
                  <Button onClick={salvarEdicaoPagamento} disabled={salvandoEdicao} className="bg-green-600 hover:bg-green-700 min-w-[200px] gap-2">
                    {salvandoEdicao && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                    {!salvandoEdicao && <Check className="h-4 w-4" />}
                    Salvar Alterações
                  </Button>
                </>
              ) : (
                <>
                  {pode('financeiro.pagamento_excluir') && (
                    <Button variant="outline" onClick={excluirPagamento} className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700">
                      <Trash2 className="h-4 w-4 mr-2" />Excluir
                    </Button>
                  )}
                  {pode('financeiro.pagamento_editar') && (
                    <Button onClick={iniciarEdicaoPagamento} className="bg-green-600 hover:bg-green-700">
                      <Pencil className="h-4 w-4 mr-2" />Editar
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CSS dos elementos novos */}
      <style jsx>{`
        /* Detalhar nos KPIs */
        .rc-card-wrap { position: relative; }
        .rc-card-detalhar {
          position: absolute;
          top: 12px;
          right: 14px;
          background: transparent;
          border: none;
          padding: 0;
          font-size: 11px;
          font-weight: 500;
          color: #6b7280;
          cursor: pointer;
          transition: color 0.15s;
        }
        .rc-card-detalhar:hover {
          color: #18181b;
          text-decoration: underline;
        }

        /* Próximos vencimentos */
        .rc-proxvenc-card {
          background: #fffbeb;
          border: 1px solid #fde68a;
          border-radius: 12px;
          padding: 14px 18px;
        }
        .rc-proxvenc-head {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          font-weight: 700;
          color: #92400e;
          margin-bottom: 10px;
        }
        .rc-proxvenc-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .rc-proxvenc-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          padding: 6px 10px;
          background: rgba(255, 255, 255, 0.5);
          border-radius: 6px;
          font-size: 13px;
          color: #78350f;
        }
        .rc-proxvenc-nome { flex: 1; min-width: 0; }
        .rc-proxvenc-dias {
          font-size: 11px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 999px;
          background: #fde68a;
          color: #78350f;
          flex-shrink: 0;
        }
        .rc-proxvenc-dias.urgente {
          background: #fecaca;
          color: #991b1b;
        }

        /* Header listagem */
        .rc-listagem-head {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          padding: 12px 0;
        }
        .rc-titulo {
          font-size: 18px;
          font-weight: 700;
          color: #18181b;
        }
        .rc-sub {
          font-size: 12px;
          color: #71717a;
          margin-top: 2px;
        }
        .rc-topbar-acoes {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }
        .rc-busca-wrap {
          position: relative;
        }
        .rc-busca-icon {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          width: 16px;
          height: 16px;
          color: #9ca3af;
          pointer-events: none;
        }
        .rc-busca {
          padding: 10px 14px 10px 38px;
          font-size: 14px;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          background: #fff;
          color: #18181b;
          font-family: inherit;
          outline: none;
          width: 220px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        }
        .rc-busca::placeholder { color: #9ca3af; }
        .rc-busca:focus { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,.1); }
        .rc-ordem {
          padding: 10px 32px 10px 14px;
          font-size: 14px;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          background: #fff;
          color: #18181b;
          font-family: inherit;
          cursor: pointer;
          outline: none;
          appearance: none;
          background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'/%3e%3c/svg%3e");
          background-repeat: no-repeat;
          background-position: right 12px center;
          background-size: 12px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
          min-width: 140px;
        }
        .rc-dropdown {
          position: relative;
        }
        .rc-dropdown-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 16px;
          background: #fff;
          color: #4b5563;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          font-family: inherit;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        }
        .rc-dropdown-btn:hover { background: #f9fafb; }
        .rc-dropdown-menu {
          position: absolute;
          top: calc(100% + 4px);
          right: 0;
          min-width: 240px;
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
          padding: 6px;
          z-index: 30;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .rc-dropdown-menu button {
          text-align: left;
          padding: 8px 12px;
          background: transparent;
          border: none;
          border-radius: 6px;
          font-size: 13px;
          color: #18181b;
          cursor: pointer;
          font-family: inherit;
        }
        .rc-dropdown-menu button:hover { background: #f3f4f6; }

        /* Labels de seção */
        .rc-secao-lbl {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #6b7280;
          padding: 16px 0 8px;
          border-bottom: 1px solid #e5e7eb;
          margin-bottom: 12px;
        }

        /* Card Pasta Documental */
        .rc-pasta-card {
          background: #fff;
          border: 1px solid #e5e7eb;
          border-left: 4px solid #3b82f6;
          border-radius: 12px;
          padding: 18px 20px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .rc-pasta-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          flex-wrap: wrap;
        }
        .rc-pasta-titulo-wrap { flex: 1; min-width: 0; }
        .rc-pasta-titulo {
          font-size: 15px;
          font-weight: 700;
          color: #18181b;
          margin-bottom: 6px;
        }
        .rc-pasta-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          font-size: 12px;
          color: #71717a;
        }
        .rc-pasta-valor-wrap {
          text-align: right;
          flex-shrink: 0;
        }
        .rc-pasta-valor {
          font-size: 22px;
          font-weight: 800;
          color: #1d4ed8;
          font-variant-numeric: tabular-nums;
        }
        .rc-pasta-status {
          display: inline-block;
          margin-top: 4px;
          padding: 3px 10px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.04em;
          background: #fef9c3;
          color: #854d0e;
          border-radius: 999px;
        }
        .rc-pasta-progresso-wrap { display: flex; flex-direction: column; gap: 6px; }
        .rc-pasta-progresso {
          height: 8px;
          background: #f3f4f6;
          border-radius: 999px;
          overflow: hidden;
        }
        .rc-pasta-progresso-fill {
          height: 100%;
          background: #3b82f6;
          border-radius: 999px;
          transition: width 0.4s;
        }
        .rc-pasta-progresso-info {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: #71717a;
        }
        .rc-pasta-acoes {
          display: flex;
          gap: 8px;
          padding-top: 4px;
          flex-wrap: wrap;
        }
        .rc-pasta-btn {
          padding: 8px 14px;
          font-size: 13px;
          font-weight: 600;
          border-radius: 8px;
          cursor: pointer;
          border: 1px solid transparent;
          font-family: inherit;
          transition: background 0.15s;
        }
        .rc-pasta-btn-verde {
          background: #16a34a;
          color: #fff;
        }
        .rc-pasta-btn-verde:hover { background: #15803d; }
        .rc-pasta-btn-ghost {
          background: #fff;
          color: #4b5563;
          border-color: #e5e7eb;
        }
        .rc-pasta-btn-ghost:hover { background: #f9fafb; }
      `}</style>
    </div>
  )
}

export default Receitas
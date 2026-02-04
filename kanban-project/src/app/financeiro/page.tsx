// CRIAR EM: src/app/financeiro/page.tsx
"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import { HeaderBar } from "@/src/components/header-bar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { DatePickerField } from "@/components/ui/date-picker-field"
import {
  Filter, ChevronDown, Search, TrendingUp, TrendingDown,
  AlertTriangle, CheckCircle, DollarSign, FileText, FileSpreadsheet,
  Download, Loader2, ExternalLink, ChevronRight, BarChart3
} from "lucide-react"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel
} from "@/components/ui/dropdown-menu"
import { gerarRelatorioFinanceiroPDF, gerarRelatorioFinanceiroExcel } from "@/src/utils/relatorioFinanceiro"
import dynamic from "next/dynamic"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

const GraficosFinanceiro = dynamic(() => import("@/src/components/financeiroComponents/GraficosFinanceiro"), { ssr: false, loading: () => <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div> })

// ============================================
// TIPOS
// ============================================

interface Fatura {
  id: number
  descricao: string
  moeda: string
  valor: number
  valorPago: number
  valorRestante: number
  valorTotalBRL: number
  valorPagoBRL: number
  valorRestanteBRL: number
  vencidoBRL: number
  pendenteBRL: number
  cambio: number
  status: string
  metodoPagamento: string | null
  parcelas: number
  dataEmissao: string
  dataVencimento: string | null
  processo: { id: number; nome: string; pais: string; statusNome: string } | null
  destinatarios: { id: number; nome: string }[]
  pagamentos: any[]
  parcelasBoleto: any[]
  createdAt: string
}

interface TotaisGeralBRL {
  total: number
  pago: number
  pendente: number
  vencido: number
}

interface ProcessoResumo {
  id: number
  nome: string
  pais: string
  totalBRL: number
  pagoBRL: number
  pendenteBRL: number
  vencidoBRL: number
  qtdFaturas: number
}

interface Filters {
  pais: string
  status: string
  moeda: string
  dataInicio: string
  dataFim: string
}

// ============================================
// CONSTANTES
// ============================================

const PAIS_LABELS: Record<string, string> = {
  PORTUGAL: 'Portugal', ESPANHA: 'Espanha', ALEMANHA: 'Alemanha', ITALIA: 'Itália'
}

const STATUS_LABELS: Record<string, string> = {
  PENDENTE: 'Pendente', PAGO: 'Pago', VENCIDO: 'Vencido', PARCIAL: 'Parcial'
}

const STATUS_COLORS: Record<string, string> = {
  PENDENTE: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  PAGO: 'bg-green-500/20 text-green-300 border-green-500/30',
  VENCIDO: 'bg-red-500/20 text-red-300 border-red-500/30',
  PARCIAL: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
}

const MOEDA_SIMBOLO: Record<string, string> = { BRL: 'R$', EUR: '€', USD: 'US$' }

function formatCurrency(valor: number, moeda: string = 'BRL'): string {
  const simbolo = MOEDA_SIMBOLO[moeda] || moeda
  return `${simbolo} ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatCurrencyBRL(valor: number): string {
  return `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ============================================
// PAGE COMPONENT
// ============================================

export default function FinanceiroPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [user, setUser] = useState<any>({ nome: "Usuário" })
  const [loading, setLoading] = useState(true)
  const [faturas, setFaturas] = useState<Fatura[]>([])
  const [totaisGeralBRL, setTotaisGeralBRL] = useState<TotaisGeralBRL>({ total: 0, pago: 0, pendente: 0, vencido: 0 })
  const [totaisPorMoeda, setTotaisPorMoeda] = useState<Record<string, any>>({})
  const [porProcesso, setPorProcesso] = useState<ProcessoResumo[]>([])
  const [filters, setFilters] = useState<Filters>({ pais: 'all', status: 'all', moeda: 'all', dataInicio: '', dataFim: '' })
  const [filterModalOpen, setFilterModalOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchModalOpen, setSearchModalOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'faturas' | 'processos' | 'graficos'>('faturas')

  // Dados para HeaderBar
  const [arvores, setArvores] = useState<any[]>([])
  const [processos, setProcessos] = useState<any[]>([])

  useEffect(() => {
    setMounted(true)
    if (typeof window !== 'undefined') {
      const storedUser = localStorage.getItem('user')
      if (storedUser) {
        try {
          const parsed = JSON.parse(storedUser)
          setUser(parsed)
          // Admin check
          if (parsed.tipo !== 'admin') {
            router.push('/')
            return
          }
        } catch { setUser({ nome: "Usuário" }) }
      }
    }
    buscarDados()
    buscarArvores()
    buscarProcessos()
  }, [])

  useEffect(() => {
    if (mounted) buscarDados()
  }, [filters])

  const buscarDados = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.pais !== 'all') params.set('pais', filters.pais)
      if (filters.status !== 'all') params.set('status', filters.status)
      if (filters.moeda !== 'all') params.set('moeda', filters.moeda)
      if (filters.dataInicio) params.set('dataInicio', filters.dataInicio)
      if (filters.dataFim) params.set('dataFim', filters.dataFim)

      const res = await fetch(`/api/financas/faturas?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setFaturas(data.faturas || [])
        setTotaisGeralBRL(data.totaisGeralBRL || { total: 0, pago: 0, pendente: 0, vencido: 0 })
        setTotaisPorMoeda(data.totaisPorMoeda || {})
        setPorProcesso(data.porProcesso || [])
      }
    } catch (error) {
      console.error("Erro ao buscar dados financeiros:", error)
    } finally {
      setLoading(false)
    }
  }

  const buscarArvores = async () => {
    try { const r = await fetch("/api/arvore"); if (r.ok) { const d = await r.json(); setArvores(Array.isArray(d) ? d : []) } } catch {}
  }
  const buscarProcessos = async () => {
    try { const r = await fetch("/api/processos"); if (r.ok) { const d = await r.json(); setProcessos(d.processos || []) } } catch {}
  }

  const handleLogout = () => {
    localStorage.removeItem("authToken")
    localStorage.removeItem("user")
    router.push("/login")
  }

  // Faturas filtradas por busca
  const faturasFiltradas = useMemo(() => {
    if (!searchTerm) return faturas
    const term = searchTerm.toLowerCase()
    return faturas.filter(f =>
      f.descricao.toLowerCase().includes(term) ||
      f.processo?.nome.toLowerCase().includes(term) ||
      f.destinatarios.some(d => d.nome.toLowerCase().includes(term))
    )
  }, [faturas, searchTerm])

  const hasActiveFilters = filters.pais !== 'all' || filters.status !== 'all' || filters.moeda !== 'all' || filters.dataInicio !== '' || filters.dataFim !== ''
  const activeFilterCount = [filters.pais !== 'all', filters.status !== 'all', filters.moeda !== 'all', filters.dataInicio !== '' || filters.dataFim !== ''].filter(Boolean).length

  if (!mounted) {
    return (
      <div className="relative min-h-screen text-white overflow-x-hidden">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
        <div className="min-h-screen bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin h-12 w-12 border-4 border-white border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-white/70">Carregando financeiro...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />

      <HeaderBar
        title="Financeiro"
        subtitle="Visão geral financeira de todos os processos"
        userName={user.nome}
        userRole={user.tipo === 'admin' ? 'Administrador' : user.tipo || 'Usuário'}
        userEmail={user.email || ''}
        projetos={[]}
        processos={processos}
        arvores={arvores}
        onLogout={handleLogout}
      />

      <div className="min-h-screen relative">
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />
        <main className="relative px-4 py-4 max-w-full">

          {/* Top bar */}
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            {/* View toggle */}
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'faturas' | 'processos' | 'graficos')}>
              <TabsList className="bg-transparent border border-white/30">
                <TabsTrigger value="faturas" className="data-[state=active]:bg-white/20 text-white">Faturas</TabsTrigger>
                <TabsTrigger value="processos" className="data-[state=active]:bg-white/20 text-white">Por Processo</TabsTrigger>
                <TabsTrigger value="graficos" className="data-[state=active]:bg-white/20 text-white">Gráficos</TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Actions */}
            <div className="flex items-center space-x-2">
              <RelatorioDropdown faturas={faturas} totaisGeralBRL={totaisGeralBRL} totaisPorMoeda={totaisPorMoeda} porProcesso={porProcesso} filtros={filters} />
              <Button variant="outline" size="sm" onClick={() => setFilterModalOpen(true)} className={`group bg-transparent hover:bg-white/10 hover:text-white hover:border-white/30 ${hasActiveFilters ? 'border-amber-500 text-amber-400 bg-amber-500/10' : 'border-white/30 text-white'}`}>
                <Filter className="mr-1 h-4 w-4" />
                Filtro
                {hasActiveFilters && <span className="ml-1 bg-amber-500 text-white text-xs rounded-full px-1.5 group-hover:bg-white/20 group-hover:text-white">{activeFilterCount}</span>}
                <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSearchModalOpen(true)} className="bg-transparent border-white/30 text-white hover:bg-white/10 hover:text-white">
                <Search className="mr-1 h-4 w-4" />
                Pesquisar
              </Button>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <SummaryCard icon={<DollarSign className="h-5 w-5" />} label="Total Geral (BRL)" value={formatCurrencyBRL(totaisGeralBRL.total)} color="blue" />
            <SummaryCard icon={<CheckCircle className="h-5 w-5" />} label="Recebido" value={formatCurrencyBRL(totaisGeralBRL.pago)} color="green" />
            <SummaryCard icon={<TrendingUp className="h-5 w-5" />} label="Pendente" value={formatCurrencyBRL(totaisGeralBRL.pendente)} color="amber" />
            <SummaryCard icon={<AlertTriangle className="h-5 w-5" />} label="Vencido" value={formatCurrencyBRL(totaisGeralBRL.vencido)} color="red" />
          </div>

          {/* Totais por moeda */}
          {Object.keys(totaisPorMoeda).length > 0 && (
            <div className="flex flex-wrap gap-3 mb-4">
              {Object.entries(totaisPorMoeda).map(([moeda, vals]: [string, any]) => (
                <div key={moeda} className="bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm">
                  <span className="font-semibold text-white/90">{moeda}</span>
                  <span className="text-white/50 mx-2">|</span>
                  <span className="text-white/70">Total: {formatCurrency(vals.total, moeda)}</span>
                  <span className="text-white/50 mx-2">•</span>
                  <span className="text-green-400">Recebido: {formatCurrency(vals.pago, moeda)}</span>
                  <span className="text-white/50 mx-2">•</span>
                  <span className="text-amber-400">Pendente: {formatCurrency(vals.pendente, moeda)}</span>
                  {vals.vencido > 0 && (
                    <>
                      <span className="text-white/50 mx-2">•</span>
                      <span className="text-red-400">Vencido: {formatCurrency(vals.vencido, moeda)}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Content */}
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-lg p-4">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-white/50" />
              </div>
            ) : viewMode === 'graficos' ? (
              <GraficosFinanceiro faturas={faturasFiltradas} totaisGeralBRL={totaisGeralBRL} totaisPorMoeda={totaisPorMoeda} porProcesso={porProcesso} />
            ) : viewMode === 'faturas' ? (
              <FaturasList faturas={faturasFiltradas} onClickProcesso={(id, pais) => router.push(`/kanban?processoId=${id}&tab=faturas&pais=${pais}`)} />
            ) : (
              <ProcessosList processos={porProcesso} onClickProcesso={(id, pais) => router.push(`/kanban?processoId=${id}&tab=faturas&pais=${pais}`)} />
            )}
          </div>

        </main>
      </div>

      {/* Modal de Filtros */}
      <FilterModal open={filterModalOpen} onOpenChange={setFilterModalOpen} filters={filters} onFiltersChange={setFilters} />

      {/* Modal de Pesquisa */}
      <SearchModal open={searchModalOpen} onOpenChange={setSearchModalOpen} searchTerm={searchTerm} onSearchTermChange={setSearchTerm} faturas={faturas} onClickProcesso={(id, pais) => { setSearchModalOpen(false); router.push(`/kanban?processoId=${id}&tab=faturas&pais=${pais}`) }} />
    </div>
  )
}

// ============================================
// SUBCOMPONENTS
// ============================================

function SummaryCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
    green: 'bg-green-500/10 border-green-500/20 text-green-400',
    amber: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
    red: 'bg-red-500/10 border-red-500/20 text-red-400',
  }
  const iconColorClasses: Record<string, string> = {
    blue: 'text-blue-400',
    green: 'text-green-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
  }

  return (
    <div className={`rounded-xl border p-4 ${colorClasses[color]}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={iconColorClasses[color]}>{icon}</span>
        <span className="text-xs text-white/60 font-medium">{label}</span>
      </div>
      <p className="text-lg font-bold text-white">{value}</p>
    </div>
  )
}

function FaturasList({ faturas, onClickProcesso }: { faturas: Fatura[]; onClickProcesso: (id: number, pais: string) => void }) {
  if (faturas.length === 0) {
    return <div className="text-center py-16 text-white/50">Nenhuma fatura encontrada</div>
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-white/50 mb-2">{faturas.length} fatura(s)</p>
      {faturas.map(f => (
        <div
          key={f.id}
          className="bg-white/5 border border-white/10 rounded-lg p-4 hover:bg-white/10 transition cursor-pointer"
          onClick={() => f.processo && onClickProcesso(f.processo.id, f.processo.pais)}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-medium text-white truncate">{f.descricao}</h3>
                <Badge variant="outline" className={`text-xs border ${STATUS_COLORS[f.status]}`}>
                  {STATUS_LABELS[f.status] || f.status}
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-sm text-white/60">
                {f.processo && (
                  <span>{f.processo.nome}</span>
                )}
                <span>{PAIS_LABELS[f.processo?.pais || ''] || '-'}</span>
                {f.destinatarios.length > 0 && (
                  <span>→ {f.destinatarios.map(d => d.nome).join(', ')}</span>
                )}
              </div>
            </div>

            <div className="text-right shrink-0">
              <p className="font-bold text-white">{formatCurrency(f.valor, f.moeda)}</p>
              {f.moeda !== 'BRL' && f.cambio > 0 && (
                <p className="text-xs text-white/40">≈ {formatCurrencyBRL(f.valorTotalBRL)}</p>
              )}
              <div className="flex items-center gap-2 mt-1 justify-end">
                {f.valorPago > 0 && (
                  <span className="text-xs text-green-400">Pago: {formatCurrency(f.valorPago, f.moeda)}</span>
                )}
                {f.valorRestante > 0 && (
                  <span className={`text-xs ${f.status === 'VENCIDO' ? 'text-red-400' : 'text-amber-400'}`}>
                    Restante: {formatCurrency(f.valorRestante, f.moeda)}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-white/40">
            <span>Emissão: {formatDate(f.dataEmissao)}</span>
            {f.dataVencimento && <span>Vencimento: {formatDate(f.dataVencimento)}</span>}
            {f.metodoPagamento && <span>{f.metodoPagamento.replace('_', ' ')}</span>}
            {f.parcelas > 1 && <span>{f.parcelas}x</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

function ProcessosList({ processos, onClickProcesso }: { processos: ProcessoResumo[]; onClickProcesso: (id: number, pais: string) => void }) {
  const sorted = useMemo(() => [...processos].sort((a, b) => b.totalBRL - a.totalBRL), [processos])

  if (sorted.length === 0) {
    return <div className="text-center py-16 text-white/50">Nenhum processo encontrado</div>
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-white/50 mb-2">{sorted.length} processo(s) com faturas</p>
      {sorted.map(p => {
        const pctPago = p.totalBRL > 0 ? (p.pagoBRL / p.totalBRL) * 100 : 0
        return (
          <div
            key={p.id}
            onClick={() => onClickProcesso(p.id, p.pais)}
            className="bg-white/5 border border-white/10 rounded-lg p-4 hover:bg-white/10 transition cursor-pointer group"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-white">{p.nome}</h3>
                  <Badge variant="outline" className="text-xs border-white/20 text-white/60">{PAIS_LABELS[p.pais] || p.pais}</Badge>
                  <span className="text-xs text-white/40">{p.qtdFaturas} fatura(s)</span>
                </div>
                {/* Progress bar */}
                <div className="mt-2 w-64 h-2 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${Math.min(pctPago, 100)}%` }} />
                </div>
                <div className="flex gap-4 mt-1 text-xs text-white/50">
                  <span className="text-green-400">Pago: {formatCurrencyBRL(p.pagoBRL)} ({pctPago.toFixed(0)}%)</span>
                  {p.pendenteBRL > 0 && <span className="text-amber-400">Pendente: {formatCurrencyBRL(p.pendenteBRL)}</span>}
                  {p.vencidoBRL > 0 && <span className="text-red-400">Vencido: {formatCurrencyBRL(p.vencidoBRL)}</span>}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <p className="font-bold text-white text-lg">{formatCurrencyBRL(p.totalBRL)}</p>
                <ChevronRight className="h-5 w-5 text-white/30 group-hover:text-white/60 transition" />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function RelatorioDropdown({ faturas, totaisGeralBRL, totaisPorMoeda, porProcesso, filtros }: { faturas: Fatura[]; totaisGeralBRL: TotaisGeralBRL; totaisPorMoeda: Record<string, any>; porProcesso: ProcessoResumo[]; filtros: Filters }) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [formatoGerando, setFormatoGerando] = useState<string | null>(null)

  const dados = { faturas, totaisGeralBRL, totaisPorMoeda, porProcesso }

  const handlePDF = async () => {
    setIsGenerating(true); setFormatoGerando('pdf')
    try {
      await new Promise(r => setTimeout(r, 100))
      gerarRelatorioFinanceiroPDF(dados, filtros)
    } catch (e) { console.error(e); alert('Erro ao gerar PDF') }
    finally { setIsGenerating(false); setFormatoGerando(null) }
  }

  const handleExcel = async () => {
    setIsGenerating(true); setFormatoGerando('excel')
    try {
      await new Promise(r => setTimeout(r, 100))
      await gerarRelatorioFinanceiroExcel(dados, filtros)
    } catch (e) { console.error(e); alert('Erro ao gerar Excel') }
    finally { setIsGenerating(false); setFormatoGerando(null) }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={isGenerating} className="bg-transparent border-white/30 text-white hover:bg-white/10 hover:text-white">
          {isGenerating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
          Relatório
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-white border-gray-200 text-gray-900 w-52">
        <DropdownMenuLabel className="text-gray-500 text-xs">Exportar {faturas.length} fatura(s)</DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-gray-200" />
        <DropdownMenuItem onClick={handlePDF} disabled={isGenerating} className="cursor-pointer hover:bg-gray-100">
          <FileText className="mr-2 h-4 w-4 text-red-500" />
          <div>
            <div className="font-medium">Exportar PDF</div>
            <div className="text-xs text-gray-500">Relatório formatado</div>
          </div>
          {formatoGerando === 'pdf' && <Loader2 className="ml-auto h-4 w-4 animate-spin" />}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExcel} disabled={isGenerating} className="cursor-pointer hover:bg-gray-100">
          <FileSpreadsheet className="mr-2 h-4 w-4 text-green-600" />
          <div>
            <div className="font-medium">Exportar Excel</div>
            <div className="text-xs text-gray-500">Planilha com abas por status</div>
          </div>
          {formatoGerando === 'excel' && <Loader2 className="ml-auto h-4 w-4 animate-spin" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ============================================
// MODALS
// ============================================

function FilterModal({ open, onOpenChange, filters, onFiltersChange }: { open: boolean; onOpenChange: (v: boolean) => void; filters: Filters; onFiltersChange: (f: Filters) => void }) {
  const [local, setLocal] = useState<Filters>(filters)

  useEffect(() => { if (open) setLocal(filters) }, [open])

  const apply = () => { onFiltersChange(local); onOpenChange(false) }
  const clear = () => {
    const empty: Filters = { pais: 'all', status: 'all', moeda: 'all', dataInicio: '', dataFim: '' }
    setLocal(empty); onFiltersChange(empty)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border-gray-200 text-gray-900">
        <DialogHeader><DialogTitle className="text-gray-900">Filtrar Financeiro</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-gray-700">Vencimento De</Label>
              <DatePickerField value={local.dataInicio} onChange={(v) => setLocal(p => ({ ...p, dataInicio: v }))} />
            </div>
            <div className="space-y-2">
              <Label className="text-gray-700">Vencimento Até</Label>
              <DatePickerField value={local.dataFim} onChange={(v) => setLocal(p => ({ ...p, dataFim: v }))} />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-gray-700">País</Label>
            <Select value={local.pais} onValueChange={(v) => setLocal(p => ({ ...p, pais: v }))}>
              <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-white border-gray-200 text-gray-900" data-hide-scroll="true">
                <SelectItem value="all">Todos os Países</SelectItem>
                <SelectItem value="PORTUGAL">Portugal</SelectItem>
                <SelectItem value="ESPANHA">Espanha</SelectItem>
                <SelectItem value="ALEMANHA">Alemanha</SelectItem>
                <SelectItem value="ITALIA">Itália</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-gray-700">Status</Label>
            <Select value={local.status} onValueChange={(v) => setLocal(p => ({ ...p, status: v }))}>
              <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-white border-gray-200 text-gray-900" data-hide-scroll="true">
                <SelectItem value="all">Todos os Status</SelectItem>
                <SelectItem value="PENDENTE">Pendente</SelectItem>
                <SelectItem value="PARCIAL">Parcial</SelectItem>
                <SelectItem value="VENCIDO">Vencido</SelectItem>
                <SelectItem value="PAGO">Pago</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-gray-700">Moeda</Label>
            <Select value={local.moeda} onValueChange={(v) => setLocal(p => ({ ...p, moeda: v }))}>
              <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-white border-gray-200 text-gray-900" data-hide-scroll="true">
                <SelectItem value="all">Todas as Moedas</SelectItem>
                <SelectItem value="BRL">BRL (R$)</SelectItem>
                <SelectItem value="EUR">EUR (€)</SelectItem>
                <SelectItem value="USD">USD (US$)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2 pt-4">
            <Button onClick={clear} variant="outline" className="flex-1 bg-white border-gray-300 text-gray-700 hover:bg-gray-50">Limpar Filtros</Button>
            <Button onClick={apply} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white">Aplicar Filtros</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SearchModal({ open, onOpenChange, searchTerm, onSearchTermChange, faturas, onClickProcesso }: { open: boolean; onOpenChange: (v: boolean) => void; searchTerm: string; onSearchTermChange: (t: string) => void; faturas: Fatura[]; onClickProcesso: (id: number, pais: string) => void }) {
  const filtered = useMemo(() => {
    if (!searchTerm) return []
    const term = searchTerm.toLowerCase()
    return faturas.filter(f =>
      f.descricao.toLowerCase().includes(term) ||
      f.processo?.nome.toLowerCase().includes(term) ||
      f.destinatarios.some(d => d.nome.toLowerCase().includes(term))
    )
  }, [searchTerm, faturas])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border-gray-200 text-gray-900 max-w-2xl">
        <DialogHeader><DialogTitle className="text-gray-900">Pesquisar Faturas</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              placeholder="Buscar por descrição, família ou destinatário..."
              value={searchTerm}
              onChange={(e) => onSearchTermChange(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-md text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="max-h-96 overflow-y-auto space-y-2">
            {filtered.length > 0 ? filtered.map(f => (
              <div key={f.id} className="p-3 rounded-lg bg-gray-50 border border-gray-200 hover:bg-gray-100 transition cursor-pointer" onClick={() => f.processo && onClickProcesso(f.processo.id, f.processo.pais)}>
                <div className="flex justify-between">
                  <div>
                    <h4 className="font-medium text-gray-900">{f.descricao}</h4>
                    <p className="text-sm text-gray-600">{f.processo?.nome || '-'}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900">{formatCurrency(f.valor, f.moeda)}</p>
                    <Badge variant="outline" className="text-xs">{STATUS_LABELS[f.status]}</Badge>
                  </div>
                </div>
              </div>
            )) : searchTerm ? (
              <p className="text-center text-gray-500 py-8">Nenhuma fatura encontrada</p>
            ) : (
              <p className="text-center text-gray-500 py-8">Digite para pesquisar</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
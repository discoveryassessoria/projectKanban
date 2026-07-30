"use client"

// ESTE ARQUIVO SUBSTITUI: src/app/activities/page.tsx
//
// FIX (6/jul): a tela quebrava porque usava o enum fixo Pais do Prisma
// (não existe no navegador). Agora os países vêm do catálogo via usePaises()
// — cada item é { countryKey, countryLabel, flag }. França e países novos
// aparecem sozinhos no filtro.

import { useEffect, useState, useCallback, useMemo, Suspense } from "react"
import { useApi } from "@/src/lib/dados"
import type { ProcessoWithStatus } from "@/src/types/kanban"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Search, Filter, ChevronDown } from "lucide-react"
import RelatorioButton from "@/src/components/activitiesComponents/RelatorioButton"
import { useRouter, useSearchParams } from "next/navigation"
import ListaActivities from "@/src/components/activitiesComponents/listaActivities"
import PrazoActivities from "@/src/components/activitiesComponents/prazoActivities"
import CalendarioActivities from "@/src/components/activitiesComponents/calendarioActivities"
import { HeaderBar } from "@/src/components/header-bar"
import { usePaises, useUsers, useActivities, invalidateActivities } from "@/src/hooks/useActivitiesData"
import type { Atividade } from "@/src/hooks/useActivitiesData"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { encerrarSessao } from "@/src/lib/sessao/cliente"
import { useIsClient, useJsonLocalStorage } from "@/src/lib/cliente"

// Interfaces
interface UserData {
  nome: string
  email?: string
  tipo?: string
}

interface Filters {
  dataInicio: string
  dataFim: string
  pais: string
  status: string
  responsavel: string
}

interface ActivityFormData {
  nome: string
  descricao: string
  data_termino: string
  pais: string
  status_id: string
}

/** Forma mínima que o HeaderBar consome das árvores. */
interface ItemNomeado { id: number | string; nome: string; descricao?: string | null }
const SEM_ARVORES: ItemNomeado[] = []
const SEM_PROCESSOS: ProcessoWithStatus[] = []

function ActivitiesPageInner() {
  const router = useRouter()
  const [searchModalOpen, setSearchModalOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterModalOpen, setFilterModalOpen] = useState(false)
  // Filtros: os da URL são a SEMENTE (deep-link da Home), a escolha do usuário
  // sobrepõe. Antes um efeito costurava a querystring por cima do estado depois do
  // primeiro render — a lista aparecia sem filtro e mudava em seguida.
  const [filtrosEscolhidos, setFiltrosEscolhidos] = useState<Filters | null>(null)
  const mounted = useIsClient()
  // Usuário vem do localStorage pela abstração oficial: `null` no servidor e no
  // primeiro render (contrato de hidratação), o nome padrão depois.
  const userSalvo = useJsonLocalStorage<UserData>("user")
  const user: UserData = userSalvo ?? { nome: "Usuário" }
  // Aba controlada — permite deep-link vindo da Central Operacional (?tab=).
  const [abaEscolhida, setTabValue] = useState<string | null>(null)
  const searchParams = useSearchParams()

  // Seed ADITIVO a partir da URL: só o que veio na querystring muda; sem params, o
  // padrão é idêntico ao de antes.
  const statusDaUrl = searchParams?.get("status") ?? null
  const filtrosDaUrl = useMemo<Filters>(() => {
    const base: Filters = { dataInicio: '', dataFim: '', pais: 'all', status: 'all', responsavel: 'all' }
    if (!searchParams) return base
    const responsavel = searchParams.get("responsavel")
    const pais = searchParams.get("pais")
    if (statusDaUrl === "vencidas") base.status = "pendente"
    else if (statusDaUrl === "pendente" || statusDaUrl === "concluida") base.status = statusDaUrl
    if (responsavel) base.responsavel = responsavel
    if (pais) base.pais = pais
    return base
  }, [searchParams, statusDaUrl])
  const filters = filtrosEscolhidos ?? filtrosDaUrl
  const setFilters = (proximos: Filters | ((anteriores: Filters) => Filters)) => {
    setFiltrosEscolhidos(typeof proximos === 'function' ? proximos(filters) : proximos)
  }

  const abaDaUrl = searchParams?.get("tab") ?? null
  const tabValue =
    abaEscolhida
    ?? (abaDaUrl === "list" || abaDaUrl === "deadline" || abaDaUrl === "calendar" ? abaDaUrl : null)
    ?? (statusDaUrl === "vencidas" ? "deadline" : "list")

  // Árvores e processos alimentam a busca do HeaderBar.
  const arvoresReq = useApi<ItemNomeado[]>("/api/arvore")
  const processosReq = useApi<{ processos?: ProcessoWithStatus[] }>("/api/processos")
  const arvores = Array.isArray(arvoresReq.dados) ? arvoresReq.dados : SEM_ARVORES
  const processos = processosReq.dados?.processos ?? SEM_PROCESSOS
  const { pode } = usePermissoes()

  // Dados
  const { activities } = useActivities()

  const handleLogout = () => { void encerrarSessao("manual") }

  // Handlers para os modais
  const handleFiltersChange = useCallback((newFilters: Filters) => {
    setFilters(newFilters)
  }, [])

  const handleSearchTermChange = useCallback((term: string) => {
    setSearchTerm(term)
  }, [])

  // Tela de carregamento
  if (!mounted) {
    return (
      <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
        <div className="min-h-screen bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin h-12 w-12 border-4 border-white border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-white/70">Carregando atividades...</p>
          </div>
        </div>
      </div>
    )
  }

  const hasActiveFilters = filters.pais !== 'all' || 
  filters.status !== 'all' || 
  filters.responsavel !== 'all' || 
  filters.dataInicio !== '' || 
  filters.dataFim !== ''

  const activeFilterCount = [
    filters.pais !== 'all',
    filters.status !== 'all',
    filters.responsavel !== 'all',
    filters.dataInicio !== '' || filters.dataFim !== '',
  ].filter(Boolean).length

  return (
    <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
      {/* BACKGROUND FIXO — mesma densidade escura das telas financeiras */}
      <div className="pointer-events-none fixed inset-0 -z-10 scale-105 blur-[6px] bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
      <div className="pointer-events-none fixed inset-0 -z-10 bg-black/60" />

      {/* HEADER - Componente reutilizável */}
      <HeaderBar
        title="Tarefas e Projetos"
        subtitle="Gerencie suas tarefas e acompanhe o progresso dos projetos"
        userName={user.nome}
        userRole={user.tipo === 'admin' ? 'Administrador' : user.tipo || 'Usuário'}
        userEmail={user.email || ''}
        projetos={[]}
        processos={processos}
        arvores={arvores}
        onLogout={handleLogout}
      />

      {/* CONTEÚDO COM OVERLAY ESCURO IGUAL DASHBOARD */}
      <div className="min-h-screen relative">
        {/* Overlay apenas na área do conteúdo */}
        <div className="absolute inset-0 bg-black/10 pointer-events-none" />
        <main className="relative px-4 py-4 max-w-full">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {pode('tarefas.criar') && <CreateActivityModal />}
          </div>
        </div>

        {/* Tabs de visualização */}
        <Tabs value={tabValue} onValueChange={setTabValue} className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <TabsList className="bg-transparent border border-white/15">
              <TabsTrigger value="list" className="text-white/60 data-[state=active]:bg-[#d2a948]/15 data-[state=active]:text-[#d2a948]">Lista</TabsTrigger>
              <TabsTrigger value="deadline" className="text-white/60 data-[state=active]:bg-[#d2a948]/15 data-[state=active]:text-[#d2a948]">Prazo</TabsTrigger>
              <TabsTrigger value="calendar" className="text-white/60 data-[state=active]:bg-[#d2a948]/15 data-[state=active]:text-[#d2a948]">Calendário</TabsTrigger>
            </TabsList>
            
            {/* Filters and Actions */}
            <div className="flex items-center space-x-2">
              <RelatorioButton atividades={activities || []} filtros={filters} />
              <Button variant="outline" size="sm" onClick={() => setFilterModalOpen(true)} className={`group bg-transparent hover:bg-white/10 hover:text-white hover:border-white/30 ${hasActiveFilters ? 'border-amber-500 text-amber-400 bg-amber-500/10' : 'border-white/30 text-white'}`}>
                <Filter className="mr-1 h-4 w-4" />
                Filtro
                {hasActiveFilters && (
                  <span className="ml-1 bg-amber-500 text-white text-xs rounded-full px-1.5 group-hover:bg-white/20 group-hover:text-white">{activeFilterCount}</span>
                )}
                <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSearchModalOpen(true)} className="bg-transparent border-white/30 text-white hover:bg-white/10 hover:text-white">
                <Search className="mr-1 h-4 w-4" />
                Pesquisar
              </Button>
            </div>
          </div>
          
          <TabsContent value="list" className="space-y-4">
            <div className="p-4">
              <ListaActivities filters={filters} />
            </div>
          </TabsContent>
          
          <TabsContent value="deadline" className="space-y-4">
            <div className="p-4">
              <PrazoActivities filters={filters} />
            </div>
          </TabsContent>
          
          <TabsContent value="calendar" className="space-y-4">
            <div className="p-4">
              <CalendarioActivities filters={filters} />
            </div>
          </TabsContent>
        </Tabs>

        {/* Modal de Pesquisa */}
        <SearchModal 
          open={searchModalOpen}
          onOpenChange={setSearchModalOpen}
          searchTerm={searchTerm}
          onSearchTermChange={handleSearchTermChange}
          onActivityClick={(activity) => {
            if (activity.processo?.id) {
              // countryKey em minúsculo (dados antigos podem vir "PORTUGAL")
              const pais = String(activity.processo.pais || activity.pais || '').toLowerCase()
              const paisParam = pais ? `&pais=${pais}` : ''
              const tarefaPaiId = activity.tarefaPai?.id ? `&tarefaPaiId=${activity.tarefaPai.id}` : ''
              router.push(`/kanban?processoId=${activity.processo.id}&tab=tarefas${paisParam}${tarefaPaiId}`)
            }
          }}
        />

        {/* Modal de Filtros */}
        <FilterModal 
          open={filterModalOpen}
          onOpenChange={setFilterModalOpen}
          filters={filters}
          onFiltersChange={handleFiltersChange}
          userTipo={user.tipo}
        />
      </main>
      </div>
    </div>
  )
}

// COMPONENTE: FilterModal
interface FilterModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  filters: Filters
  onFiltersChange: (filters: Filters) => void
  userTipo?: string  // ← ADICIONAR
}

function FilterModal({ 
  open, 
  onOpenChange, 
  filters, 
  onFiltersChange,
  userTipo  // ← ADICIONAR
}: FilterModalProps) {
  const { paises } = usePaises()
  const { users } = useUsers()

  // Rascunho dos filtros carimbado com os filtros aplicados: abrir o modal parte do que
  // está valendo, e um filtro trocado por fora não sobrescreve o que se está editando.
  const baseFiltros = JSON.stringify(filters)
  const [rascunho, setRascunho] = useState<{ base: string; filtros: Filters } | null>(null)
  const localFilters = rascunho?.base === baseFiltros ? rascunho.filtros : filters
  const setLocalFilters = (proximos: Filters | ((anteriores: Filters) => Filters)) => {
    const valor = typeof proximos === 'function' ? proximos(localFilters) : proximos
    setRascunho({ base: baseFiltros, filtros: valor })
  }

  const handleApplyFilters = () => {
    onFiltersChange(localFilters)
    onOpenChange(false)
  }

  const handleClearFilters = () => {
    const empty = { dataInicio: '', dataFim: '', pais: 'all', status: 'all', responsavel: 'all' }
    setLocalFilters(empty)
    onFiltersChange(empty)
  }

  const updateFilter = (key: keyof Filters, value: string) => {
    if (key === 'pais') {
      setLocalFilters(prev => ({ ...prev, pais: value, status: 'all' }))
    } else {
      setLocalFilters(prev => ({ ...prev, [key]: value }))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border-gray-200 text-gray-900">
        <DialogHeader>
          <DialogTitle className="text-gray-900">Filtrar Atividades</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-gray-700">De</Label>
              <DatePickerField
                value={localFilters.dataInicio}
                onChange={(value) => updateFilter('dataInicio', value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-gray-700">Até</Label>
              <DatePickerField
                value={localFilters.dataFim}
                onChange={(value) => updateFilter('dataFim', value)}
              />
            </div>
            <p className="text-xs text-gray-400 -mt-2 italic">*Filtrar por data de início</p>
          </div>
          
          <div className="space-y-2">
            <Label className="text-gray-700">País</Label>
            <Select value={localFilters.pais} onValueChange={(value) => updateFilter('pais', value)}>
              <SelectTrigger className="bg-white border-gray-300 text-gray-900">
                <SelectValue placeholder="Selecione um país" />
              </SelectTrigger>
              <SelectContent className="bg-white border-gray-200 text-gray-900">
                <SelectItem value="all">Todos os Países</SelectItem>
                {paises.map((p) => (
                  <SelectItem key={p.countryKey} value={p.countryKey}>
                    {p.flag ? `${p.flag} ` : ''}{p.countryLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-gray-700">Status</Label>
            <Select value={localFilters.status} onValueChange={(value) => updateFilter('status', value)}>
              <SelectTrigger className="bg-white border-gray-300 text-gray-900">
                <SelectValue placeholder="Selecione um status" />
              </SelectTrigger>
              <SelectContent className="bg-white border-gray-200 text-gray-900">
                <SelectItem value="all">Todos os Status</SelectItem>
                <SelectItem value="pendente">Pendente</SelectItem>
                <SelectItem value="concluida">Concluída</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {userTipo === 'admin' && (
          <div className="space-y-2">
            <Label className="text-gray-700">Responsável</Label>
            <Select value={localFilters.responsavel} onValueChange={(value) => updateFilter('responsavel', value)}>
              <SelectTrigger className="bg-white border-gray-300 text-gray-900">
                <SelectValue placeholder="Selecione um responsável" />
              </SelectTrigger>
              <SelectContent className="bg-white border-gray-200 text-gray-900">
                <SelectItem value="all">Todos os Responsáveis</SelectItem>
                {(users || []).map((u: { nome: string; email: string }) => (
                  <SelectItem key={u.email} value={u.email}>
                    {u.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

          <div className="flex gap-2 pt-4">
            <Button 
              onClick={handleClearFilters}
              variant="outline" 
              className="flex-1 bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Limpar Filtros
            </Button>
            <Button 
              onClick={handleApplyFilters}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
            >
              Aplicar Filtros
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// COMPONENTE: SearchModal
interface SearchModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  searchTerm: string
  onSearchTermChange: (term: string) => void
  onActivityClick?: (activity: Atividade) => void
}

function SearchModal({ 
  open, 
  onOpenChange, 
  searchTerm, 
  onSearchTermChange,
  onActivityClick
}: SearchModalProps) {
  const { activities } = useActivities()
  const { paises } = usePaises()

  // Nome do país a partir do countryKey — aceita valor antigo em maiúsculo
  const labelDoPais = (v?: string | null) => {
    if (!v) return ''
    const k = String(v).toLowerCase()
    return paises.find((p) => p.countryKey === k)?.countryLabel || v
  }
  
  const filteredActivities = useMemo(() => {
    if (searchTerm && activities && activities.length > 0) {
      return activities.filter((activity: Atividade) =>
        activity.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (activity.descricao && activity.descricao.toLowerCase().includes(searchTerm.toLowerCase()))
      )
    }
    return []
  }, [searchTerm, activities])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border-gray-200 text-gray-900 max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-gray-900">Pesquisar Atividades</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Digite para pesquisar..."
              value={searchTerm}
              onChange={(e) => onSearchTermChange(e.target.value)}
              className="pl-10 bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
            />
          </div>

          <div className="max-h-96 overflow-y-auto space-y-2">
            {filteredActivities.length > 0 ? (
              filteredActivities.map((activity: Atividade) => (
                <div 
                  key={activity.id}
                  className="p-3 rounded-lg bg-gray-50 border border-gray-200 hover:bg-gray-100 transition cursor-pointer"
                  onClick={() => {
                    onActivityClick?.(activity)
                    onOpenChange(false)
                  }}
                >
                  <h4 className="font-medium text-gray-900">{activity.nome}</h4>
                  {activity.descricao && (
                    <p className="text-sm text-gray-600 mt-1">{activity.descricao}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    {activity.pais && (
                      <Badge variant="outline" className="text-xs bg-gray-100 border-gray-300 text-gray-700">
                        {labelDoPais(activity.pais)}
                      </Badge>
                    )}
                    {activity.status?.nome && (
                      <Badge variant="outline" className="text-xs bg-gray-100 border-gray-300 text-gray-700">
                        {activity.status.nome}
                      </Badge>
                    )}
                  </div>
                </div>
              ))
            ) : searchTerm ? (
              <p className="text-center text-gray-500 py-8">Nenhuma atividade encontrada</p>
            ) : (
              <p className="text-center text-gray-500 py-8">Digite para pesquisar atividades</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// COMPONENTE: CreateActivityModal
function CreateActivityModal() {
  const [open, setOpen] = useState(false)
  const [criando, setCriando] = useState(false)
  const [formData, setFormData] = useState<ActivityFormData>({
    nome: '',
    descricao: '',
    data_termino: '',
    pais: '',
    status_id: ''
  })

  const updateFormData = (key: keyof ActivityFormData, value: string) => {
    setFormData(prev => ({ ...prev, [key]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (criando) return
    setCriando(true)
    
    try {
      const token = localStorage.getItem('authToken')
      const response = await fetch('/api/tarefas', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          titulo: formData.nome,
          descricao: formData.descricao,
          dataPrazo: formData.data_termino || null,
          // ✅ Tarefas criadas por esta página sempre ficam sem país
          pais: null,
          statusId: null
        })
      })

      if (response.ok) {
        invalidateActivities()
        setOpen(false)
        setFormData({
          nome: '',
          descricao: '',
          data_termino: '',
          pais: '',
          status_id: ''
        })
      }
    } catch (error) {
      console.error('Erro ao criar atividade:', error)
    } finally {
      setCriando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center justify-center gap-1.5 h-9">
          <span className="-mt-[2px]">+</span>
          <span>Nova Atividade</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-white border-gray-200 text-gray-900">
        <DialogHeader>
          <DialogTitle className="text-gray-900">Criar Nova Atividade</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label className="text-gray-700">Nome da Atividade</Label>
            <Input
              required
              value={formData.nome}
              onChange={(e) => updateFormData('nome', e.target.value)}
              className="bg-white border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
              placeholder="Digite o nome da atividade"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-gray-700">Descrição</Label>
            <Textarea
              value={formData.descricao}
              onChange={(e) => updateFormData('descricao', e.target.value)}
              className="bg-white border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
              placeholder="Descreva a atividade"
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-gray-700">Data de Término</Label>
            <DatePickerField
              value={formData.data_termino}
              onChange={(value) => updateFormData('data_termino', value)}
            />
          </div>

          <Button type="submit" disabled={criando} className="w-full bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
            {criando ? "Criando..." : "Criar Atividade"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// Wrapper com Suspense — exigido pelo Next para useSearchParams (deep-link ?tab/status/responsavel).
export default function ActivitiesPage() {
  return (
    <Suspense fallback={null}>
      <ActivitiesPageInner />
    </Suspense>
  )
}
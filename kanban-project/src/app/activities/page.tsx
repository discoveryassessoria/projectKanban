"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Search, Filter, ChevronDown } from "lucide-react"
import { useRouter } from "next/navigation"
import ListaActivities from "@/src/components/activitiesComponents/listaActivities"
import PrazoActivities from "@/src/components/activitiesComponents/prazoActivities"
import CalendarioActivities from "@/src/components/activitiesComponents/calendarioActivities"
import { HeaderBar } from "@/src/components/header-bar"
import { usePaises, useStatuses, useUsers, useActivities, invalidateActivities } from "@/src/hooks/useActivitiesData"
import type { Atividade, Status } from "@/src/hooks/useActivitiesData"

// Mapeamento de países para exibição
const PAIS_LABELS: Record<string, string> = {
  PORTUGAL: 'Portugal',
  ESPANHA: 'Espanha',
  ALEMANHA: 'Alemanha',
  ITALIA: 'Itália'
}

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

export default function ActivitiesPage() {
  const router = useRouter()
  const [searchModalOpen, setSearchModalOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterModalOpen, setFilterModalOpen] = useState(false)
  const [filters, setFilters] = useState<Filters>({
    dataInicio: '',
    dataFim: '',
    pais: 'all',
    status: 'all',
    responsavel: 'all'
  })
  const [mounted, setMounted] = useState(false)
  const [user, setUser] = useState<UserData>({ nome: "Usuário" })

  // Estados para árvores e processos (para o HeaderBar)
  const [arvores, setArvores] = useState<any[]>([])
  const [processos, setProcessos] = useState<any[]>([])

  // Dados
  const { activities } = useActivities()
  const { paises } = usePaises()

  useEffect(() => {
    setMounted(true)
    if (typeof window !== 'undefined') {
      const storedUser = localStorage.getItem('user')
      if (storedUser) {
        try {
          setUser(JSON.parse(storedUser))
        } catch {
          setUser({ nome: "Usuário" })
        }
      }
    }
    // Buscar dados para o HeaderBar
    buscarArvores()
    buscarProcessos()
  }, [])

  const buscarArvores = async () => {
    try {
      const response = await fetch("/api/arvore")
      if (response.ok) {
        const data = await response.json()
        setArvores(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error("Erro ao buscar árvores:", error)
    }
  }

  const buscarProcessos = async () => {
    try {
      const response = await fetch("/api/processos")
      if (response.ok) {
        const data = await response.json()
        setProcessos(data.processos || [])
      }
    } catch (error) {
      console.error("Erro ao buscar processos:", error)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem("authToken")
    localStorage.removeItem("user")
    router.push("/login")
  }

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

  return (
    <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
      {/* BACKGROUND FIXO */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />

      {/* HEADER - Componente reutilizável */}
      <HeaderBar
        title="Tarefas"
        subtitle="Gerencie suas tarefas"
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
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />
        <main className="relative px-4 py-4 max-w-full">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CreateActivityModal />
          </div>
        </div>

        {/* Tabs de visualização */}
        <Tabs defaultValue="list" className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <TabsList className="bg-transparent border border-white/30">
              <TabsTrigger value="list" className="data-[state=active]:bg-white/20 text-white">Lista</TabsTrigger>
              <TabsTrigger value="deadline" className="data-[state=active]:bg-white/20 text-white">Prazo</TabsTrigger>
              <TabsTrigger value="calendar" className="data-[state=active]:bg-white/20 text-white">Calendário</TabsTrigger>
            </TabsList>
            
            {/* Filters and Actions */}
            <div className="flex items-center space-x-2">
              <Button variant="outline" size="sm" onClick={() => setFilterModalOpen(true)} className="bg-transparent border-white/30 text-white hover:bg-white/10 hover:text-white">
                <Filter className="mr-2 h-4 w-4" />
                Filtro
                <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSearchModalOpen(true)} className="bg-transparent border-white/30 text-white hover:bg-white/10 hover:text-white">
                <Search className="mr-2 h-4 w-4" />
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
              <PrazoActivities />
            </div>
          </TabsContent>
          
          <TabsContent value="calendar" className="space-y-4">
            <div className="p-4">
              <CalendarioActivities />
            </div>
          </TabsContent>
        </Tabs>

        {/* Modal de Pesquisa */}
        <SearchModal 
          open={searchModalOpen}
          onOpenChange={setSearchModalOpen}
          searchTerm={searchTerm}
          onSearchTermChange={handleSearchTermChange}
        />

        {/* Modal de Filtros */}
        <FilterModal 
          open={filterModalOpen}
          onOpenChange={setFilterModalOpen}
          filters={filters}
          onFiltersChange={handleFiltersChange}
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
}

function FilterModal({ 
  open, 
  onOpenChange, 
  filters, 
  onFiltersChange 
}: FilterModalProps) {
  const { paises } = usePaises()
  // ✅ CORRIGIDO: Passa o país selecionado para filtrar os status
  const { statuses } = useStatuses(filters.pais)
  const { users } = useUsers()

  const handleApplyFilters = () => {
    onOpenChange(false)
  }

  const handleClearFilters = () => {
    onFiltersChange({
      dataInicio: '',
      dataFim: '',
      pais: 'all',
      status: 'all',
      responsavel: 'all'
    })
  }

  const updateFilter = (key: keyof Filters, value: string) => {
    // ✅ CORRIGIDO: Quando mudar o país, resetar o status
    if (key === 'pais') {
      onFiltersChange({ ...filters, pais: value, status: 'all' })
    } else {
      onFiltersChange({ ...filters, [key]: value })
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
              <Label className="text-gray-700">Data Início</Label>
              <Input
                type="date"
                value={filters.dataInicio}
                onChange={(e) => updateFilter('dataInicio', e.target.value)}
                className="bg-white border-gray-300 text-gray-900"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-gray-700">Data Fim</Label>
              <Input
                type="date"
                value={filters.dataFim}
                onChange={(e) => updateFilter('dataFim', e.target.value)}
                className="bg-white border-gray-300 text-gray-900"
              />
            </div>
          </div>
          
          <div className="space-y-2">
            <Label className="text-gray-700">País</Label>
            <Select value={filters.pais} onValueChange={(value) => updateFilter('pais', value)}>
              <SelectTrigger className="bg-white border-gray-300 text-gray-900">
                <SelectValue placeholder="Selecione um país" />
              </SelectTrigger>
              <SelectContent className="bg-white border-gray-200 text-gray-900">
                <SelectItem value="all">Todos os Países</SelectItem>
                {paises.map((pais) => (
                  <SelectItem key={pais} value={pais}>
                    {PAIS_LABELS[pais] || pais}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-gray-700">Status</Label>
            <Select value={filters.status} onValueChange={(value) => updateFilter('status', value)}>
              <SelectTrigger className="bg-white border-gray-300 text-gray-900">
                <SelectValue placeholder="Selecione um status" />
              </SelectTrigger>
              <SelectContent className="bg-white border-gray-200 text-gray-900">
                <SelectItem value="all">Todos os Status</SelectItem>
                {(statuses || []).map((status: Status) => (
                  <SelectItem key={status.id} value={String(status.id)}>
                    {status.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-gray-700">Responsável</Label>
            <Select value={filters.responsavel} onValueChange={(value) => updateFilter('responsavel', value)}>
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
}

function SearchModal({ 
  open, 
  onOpenChange, 
  searchTerm, 
  onSearchTermChange
}: SearchModalProps) {
  const { activities } = useActivities()
  
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
                >
                  <h4 className="font-medium text-gray-900">{activity.nome}</h4>
                  {activity.descricao && (
                    <p className="text-sm text-gray-600 mt-1">{activity.descricao}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    {activity.pais && (
                      <Badge variant="outline" className="text-xs bg-gray-100 border-gray-300 text-gray-700">
                        {PAIS_LABELS[activity.pais] || activity.pais}
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
  const [formData, setFormData] = useState<ActivityFormData>({
    nome: '',
    descricao: '',
    data_termino: '',
    pais: '',
    status_id: ''
  })

  const { paises } = usePaises()
  // ✅ CORRIGIDO: Passa o país selecionado para filtrar os status
  const { statuses } = useStatuses(formData.pais)

  const updateFormData = (key: keyof ActivityFormData, value: string) => {
    // ✅ CORRIGIDO: Quando mudar o país, resetar o status
    if (key === 'pais') {
      setFormData(prev => ({ ...prev, pais: value, status_id: '' }))
    } else {
      setFormData(prev => ({ ...prev, [key]: value }))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
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
          pais: formData.pais || 'PORTUGAL',
          statusId: formData.status_id ? parseInt(formData.status_id) : null
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
            <Input
              type="date"
              value={formData.data_termino}
              onChange={(e) => updateFormData('data_termino', e.target.value)}
              className="bg-white border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 [&::-webkit-calendar-picker-indicator]:opacity-50"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-gray-700">País</Label>
            <Select 
              value={formData.pais} 
              onValueChange={(value) => updateFormData('pais', value)}
            >
              <SelectTrigger className="bg-white border-gray-300 text-gray-900">
                <SelectValue placeholder="Selecione um país" />
              </SelectTrigger>
              <SelectContent className="bg-white border-gray-200 text-gray-900">
                {paises.map((pais) => (
                  <SelectItem key={pais} value={pais}>
                    {PAIS_LABELS[pais] || pais}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* ✅ NOVO: Select de Status (só aparece quando país selecionado) */}
          {formData.pais && statuses.length > 0 && (
            <div className="space-y-2">
              <Label className="text-gray-700">Status (opcional)</Label>
              <Select 
                value={formData.status_id} 
                onValueChange={(value) => updateFormData('status_id', value)}
              >
                <SelectTrigger className="bg-white border-gray-300 text-gray-900">
                  <SelectValue placeholder="Selecione um status" />
                </SelectTrigger>
                <SelectContent className="bg-white border-gray-200 text-gray-900">
                  {statuses.map((status: Status) => (
                    <SelectItem key={status.id} value={String(status.id)}>
                      {status.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white">
            Criar Atividade
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
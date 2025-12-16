"use client"

import { useEffect, useState, useCallback } from "react"
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
  const [filteredActivities, setFilteredActivities] = useState<Atividade[]>([])
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

  // Estados para árvores (para o HeaderBar)
  const [arvores, setArvores] = useState<any[]>([])

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
    // Buscar árvores para o HeaderBar
    buscarArvores()
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

  const handleFilteredActivitiesChange = useCallback((activities: Atividade[]) => {
    setFilteredActivities(activities)
  }, [])

  // Converter atividades para o formato do HeaderBar
  const atividadesParaHeader = (activities || [])
    .filter(a => a.id !== undefined)
    .map(a => ({
      id: a.id as number,
      nome: a.nome,
      descricao: a.descricao || null,
      data_criacao: a.data_criacao || new Date().toISOString(),
      data_termino: a.data_termino || null,
      pais: a.pais,
      status: a.status ? { nome: a.status.nome } : null,
      usuarios: a.usuarios?.map(u => ({
        usuario: {
          nome: u.usuario?.nome || '',
          email: u.usuario?.email || ''
        }
      }))
    }))

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
        atividades={atividadesParaHeader}
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
          filteredActivities={filteredActivities}
          onFilteredActivitiesChange={handleFilteredActivitiesChange}
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
  const { statuses } = useStatuses()
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
    onFiltersChange({ ...filters, [key]: value })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white/10 border-white/20 backdrop-blur-xl text-white">
        <DialogHeader>
          <DialogTitle className="text-white">Filtrar Atividades</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-white/90">Data Início</Label>
              <Input
                type="date"
                value={filters.dataInicio}
                onChange={(e) => updateFilter('dataInicio', e.target.value)}
                className="bg-white/10 border-white/20 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-white/90">Data Fim</Label>
              <Input
                type="date"
                value={filters.dataFim}
                onChange={(e) => updateFilter('dataFim', e.target.value)}
                className="bg-white/10 border-white/20 text-white"
              />
            </div>
          </div>
          
          <div className="space-y-2">
            <Label className="text-white/90">País</Label>
            <Select value={filters.pais} onValueChange={(value) => updateFilter('pais', value)}>
              <SelectTrigger className="bg-white/10 border-white/20 text-white">
                <SelectValue placeholder="Selecione um país" />
              </SelectTrigger>
              <SelectContent className="bg-[#1a1a2e] border-white/20 text-white">
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
            <Label className="text-white/90">Status</Label>
            <Select value={filters.status} onValueChange={(value) => updateFilter('status', value)}>
              <SelectTrigger className="bg-white/10 border-white/20 text-white">
                <SelectValue placeholder="Selecione um status" />
              </SelectTrigger>
              <SelectContent className="bg-[#1a1a2e] border-white/20 text-white">
                <SelectItem value="all">Todos os Status</SelectItem>
                {statuses.map((status) => (
                  <SelectItem key={status.id} value={String(status.id)}>
                    {status.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-white/90">Responsável</Label>
            <Select value={filters.responsavel} onValueChange={(value) => updateFilter('responsavel', value)}>
              <SelectTrigger className="bg-white/10 border-white/20 text-white">
                <SelectValue placeholder="Selecione um responsável" />
              </SelectTrigger>
              <SelectContent className="bg-[#1a1a2e] border-white/20 text-white">
                <SelectItem value="all">Todos os Responsáveis</SelectItem>
                {users.map((u) => (
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
              className="flex-1 bg-white/10 border-white/20 text-white hover:bg-white/20"
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
  filteredActivities: Atividade[]
  onFilteredActivitiesChange: (activities: Atividade[]) => void
}

function SearchModal({ 
  open, 
  onOpenChange, 
  searchTerm, 
  onSearchTermChange,
  filteredActivities,
  onFilteredActivitiesChange
}: SearchModalProps) {
  const { activities } = useActivities()

  useEffect(() => {
    if (searchTerm && activities && activities.length > 0) {
      const filtered = activities.filter((activity) =>
        activity.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (activity.descricao && activity.descricao.toLowerCase().includes(searchTerm.toLowerCase()))
      )
      onFilteredActivitiesChange(filtered)
    } else {
      onFilteredActivitiesChange([])
    }
  }, [searchTerm, activities, onFilteredActivitiesChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white/10 border-white/20 backdrop-blur-xl text-white max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-white">Pesquisar Atividades</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/60" />
            <Input
              placeholder="Digite para pesquisar..."
              value={searchTerm}
              onChange={(e) => onSearchTermChange(e.target.value)}
              className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-white/60"
            />
          </div>

          <div className="max-h-96 overflow-y-auto space-y-2">
            {filteredActivities.length > 0 ? (
              filteredActivities.map((activity) => (
                <div 
                  key={activity.id}
                  className="p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition cursor-pointer"
                >
                  <h4 className="font-medium text-white">{activity.nome}</h4>
                  {activity.descricao && (
                    <p className="text-sm text-white/70 mt-1">{activity.descricao}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    {activity.pais && (
                      <Badge variant="outline" className="text-xs bg-white/10 border-white/20 text-white">
                        {PAIS_LABELS[activity.pais] || activity.pais}
                      </Badge>
                    )}
                    {activity.status?.nome && (
                      <Badge variant="outline" className="text-xs bg-white/10 border-white/20 text-white">
                        {activity.status.nome}
                      </Badge>
                    )}
                  </div>
                </div>
              ))
            ) : searchTerm ? (
              <p className="text-center text-white/60 py-8">Nenhuma atividade encontrada</p>
            ) : (
              <p className="text-center text-white/60 py-8">Digite para pesquisar atividades</p>
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
  const { statuses } = useStatuses()

  const updateFormData = (key: keyof ActivityFormData, value: string) => {
    setFormData(prev => ({ ...prev, [key]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    try {
      const token = localStorage.getItem('authToken')
      const response = await fetch('/api/activities', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
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
      <DialogContent className="bg-white/10 border-white/20 backdrop-blur-xl text-white">
        <DialogHeader>
          <DialogTitle className="text-white">Criar Nova Atividade</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label className="text-white/90">Nome da Atividade</Label>
            <Input
              required
              value={formData.nome}
              onChange={(e) => updateFormData('nome', e.target.value)}
              className="bg-white/10 border-white/20 text-white"
              placeholder="Digite o nome da atividade"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-white/90">Descrição</Label>
            <Textarea
              value={formData.descricao}
              onChange={(e) => updateFormData('descricao', e.target.value)}
              className="bg-white/10 border-white/20 text-white"
              placeholder="Descreva a atividade"
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-white/90">Data de Término</Label>
            <Input
              type="date"
              required
              value={formData.data_termino}
              onChange={(e) => updateFormData('data_termino', e.target.value)}
              className="bg-white/10 border-white/20 text-white"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-white/90">País</Label>
            <Select 
              value={formData.pais} 
              onValueChange={(value) => updateFormData('pais', value)}
            >
              <SelectTrigger className="bg-white/10 border-white/20 text-white">
                <SelectValue placeholder="Selecione um país" />
              </SelectTrigger>
              <SelectContent className="bg-[#1a1a2e] border-white/20 text-white">
                {paises.map((pais) => (
                  <SelectItem key={pais} value={pais}>
                    {PAIS_LABELS[pais] || pais}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-white/90">Status</Label>
            <Select 
              value={formData.status_id} 
              onValueChange={(value) => updateFormData('status_id', value)}
            >
              <SelectTrigger className="bg-white/10 border-white/20 text-white">
                <SelectValue placeholder="Selecione um status" />
              </SelectTrigger>
              <SelectContent className="bg-[#1a1a2e] border-white/20 text-white">
                {statuses.map((status) => (
                  <SelectItem key={status.id} value={String(status.id)}>
                    {status.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white">
            Criar Atividade
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
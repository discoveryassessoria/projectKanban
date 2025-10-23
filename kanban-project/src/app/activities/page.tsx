"use client"

import { useEffect, useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Search, Filter, ChevronDown } from "lucide-react"
import ListaActivities from "@/src/components/activitiesComponents/listaActivities"
import ListaProjects from "@/src/components/activitiesComponents/listaProjects"
import PrazoActivities from "@/src/components/activitiesComponents/prazoActivities"
import CalendarioActivities from "@/src/components/activitiesComponents/calendarioActivities"
import { useProjects, useStatuses, useUsers, useActivities, invalidateActivities, invalidateProjects } from "@/src/hooks/useActivitiesData"
import type { Atividade, Projeto, Status, Usuario } from "@/src/hooks/useActivitiesData"

interface UserAtv {
  usuario: Usuario
}

interface FormData {
  nome: string
  descricao: string
  data_termino: string
  projeto_id: string
  status_id: string
}

export default function ActivitiesPage() {
  const [searchModalOpen, setSearchModalOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [filteredActivities, setFilteredActivities] = useState<Atividade[]>([])
  const [filterModalOpen, setFilterModalOpen] = useState(false)
  const [filters, setFilters] = useState({
    dataInicio: '',
    dataFim: '',
    projeto: 'all',
    status: 'all',
    responsavel: 'all'
  })

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      {/* Header */}
      <div className="flex items-center justify-between space-y-2">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Minhas Tarefas</h2>
          <p className="text-muted-foreground">
            Gerencie suas atividades e projetos
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <CreateActivityModal />
        </div>
      </div>

      {/* Top Tabs */}
      <Tabs defaultValue="activities" className="space-y-4">
        <TabsList>
          <TabsTrigger value="activities">Atividades</TabsTrigger>
          <TabsTrigger value="projects">Projetos</TabsTrigger>
        </TabsList>
        
        <TabsContent value="activities" className="space-y-4">
          {/* Secondary Tabs */}
          <Tabs defaultValue="list" className="space-y-4">
            <div className="flex items-center justify-between">
              <TabsList>
                <TabsTrigger value="list">Lista</TabsTrigger>
                <TabsTrigger value="deadline">Prazo</TabsTrigger>
                <TabsTrigger value="calendar">Calendário</TabsTrigger>
              </TabsList>
              
              {/* Filters and Actions */}
              <div className="flex items-center space-x-2">
                <Button variant="outline" size="sm" onClick={() => setFilterModalOpen(true)}>
                  <Filter className="mr-2 h-4 w-4" />
                  Filtro
                  <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => setSearchModalOpen(true)}>
                  <Search className="mr-2 h-4 w-4" />
                  Pesquisar
                </Button>
              </div>
            </div>
            
            {/* Renderizar todos os conteúdos, mas controlar visibilidade via CSS */}
            <TabsContent value="list" className="space-y-4">
              <ListaActivities filters={filters} />
            </TabsContent>
            
            <TabsContent value="deadline" className="space-y-4">
              <PrazoActivities />
            </TabsContent>
            
            <TabsContent value="calendar" className="space-y-4">
              <CalendarioActivities />
            </TabsContent>
          </Tabs>
        </TabsContent>
        
        <TabsContent value="projects" className="space-y-4">
          {/* Header para a seção de projetos */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium">Projetos</h3>
              <p className="text-sm text-muted-foreground">
                Gerencie seus projetos
              </p>
            </div>
            <CreateProjectModal />
          </div>
          <ListaProjects />
        </TabsContent>
      </Tabs>

      {/* Modal de Pesquisa */}
      <SearchModal 
        open={searchModalOpen}
        onOpenChange={setSearchModalOpen}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        filteredActivities={filteredActivities}
        setFilteredActivities={setFilteredActivities}
      />

      {/* Modal de Filtros */}
      <FilterModal 
        open={filterModalOpen}
        onOpenChange={setFilterModalOpen}
        filters={filters}
        setFilters={setFilters}
      />
    </div>
  )
}

function FilterModal({ 
  open, 
  onOpenChange, 
  filters, 
  setFilters
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  filters: any
  setFilters: (filters: any) => void
}) {
  // Usar hooks de cache para carregar dados
  const { projects } = useProjects()
  const { statuses } = useStatuses()
  const { users } = useUsers()

  const handleFilterChange = (field: string, value: string) => {
    setFilters((prev: any) => ({
      ...prev,
      [field]: value
    }))
  }

  const clearFilters = () => {
    setFilters({
      dataInicio: '',
      dataFim: '',
      projeto: 'all',
      status: 'all',
      responsavel: 'all'
    })
  }

  const applyFilters = () => {
    onOpenChange(false)
    // Não precisa mais forçar re-render, o SWR vai detectar mudança de filtros automaticamente
  }

  const hasActiveFilters = Object.values(filters).some(filter => filter !== '' && filter !== 'all')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Filtrar Atividades</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Filtros de Data de Criação */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Data de Criação</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="dataInicio" className="text-xs">De:</Label>
                <Input
                  id="dataInicio"
                  type="date"
                  value={filters.dataInicio}
                  onChange={(e) => handleFilterChange('dataInicio', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dataFim" className="text-xs">Até:</Label>
                <Input
                  id="dataFim"
                  type="date"
                  value={filters.dataFim}
                  onChange={(e) => handleFilterChange('dataFim', e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Filtros de Projeto e Status */}

          {/* Filtro por Projeto */}
          <div className="space-y-2">
            <Label htmlFor="projeto">Projeto</Label>
            <Select value={filters.projeto} onValueChange={(value) => handleFilterChange('projeto', value)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um projeto" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os projetos</SelectItem>
                {projects.map((projeto) => (
                  <SelectItem key={projeto.id} value={projeto.id?.toString() || ''}>
                    {projeto.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Filtro por Status */}
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select value={filters.status} onValueChange={(value) => handleFilterChange('status', value)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                {statuses.map((status) => (
                  <SelectItem key={status.id} value={status.id?.toString() || ''}>
                    {status.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Filtro por Responsável */}
          <div className="space-y-2">
            <Label htmlFor="responsavel">Responsável</Label>
            <Select value={filters.responsavel} onValueChange={(value) => handleFilterChange('responsavel', value)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um responsável" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os responsáveis</SelectItem>
                {users.map((usuario) => (
                  <SelectItem key={usuario.email} value={usuario.email}>
                    {usuario.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Indicador de filtros ativos */}
          {hasActiveFilters && (
            <div className="text-sm text-blue-600 bg-blue-50 p-2 rounded">
              ⚠️ Filtros ativos - {Object.values(filters).filter(f => f !== '').length} filtro(s) aplicado(s)
            </div>
          )}
        </div>

        <div className="flex justify-between pt-4">
          <Button type="button" variant="outline" onClick={clearFilters}>
            Limpar Filtros
          </Button>
          <div className="space-x-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={applyFilters}>
              Aplicar Filtros
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SearchModal({ 
  open, 
  onOpenChange, 
  searchTerm, 
  setSearchTerm, 
  filteredActivities, 
  setFilteredActivities 
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  searchTerm: string
  setSearchTerm: (term: string) => void
  filteredActivities: Atividade[]
  setFilteredActivities: (activities: Atividade[]) => void
}) {
  // Usar hook de cache para carregar todas as atividades
  const { activities = [], isLoading: isSearching } = useActivities()

  // Calcular resultados filtrados diretamente (sem useEffect para evitar loops)
  const searchResults = searchTerm.trim() === '' 
    ? activities 
    : activities.filter(atividade => 
        atividade.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
        atividade.descricao?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        atividade.projeto.nome.toLowerCase().includes(searchTerm.toLowerCase())
      )

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Sem prazo'
    
    const date = new Date(dateString)
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    })
  }

  const handleClose = () => {
    setSearchTerm('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[800px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Pesquisar Atividades</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Campo de pesquisa */}
          <div className="space-y-2">
            <Label htmlFor="search">Pesquisar por nome, descrição ou projeto</Label>
            <Input
              id="search"
              type="text"
              placeholder="Digite para pesquisar..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full"
            />
          </div>

          {/* Resultados da pesquisa */}
          <div className="border rounded-lg max-h-[400px] overflow-y-auto">
            {isSearching ? (
              <div className="p-4 text-center">
                <p className="text-sm text-muted-foreground">Carregando atividades...</p>
              </div>
            ) : searchResults.length === 0 ? (
              <div className="p-4 text-center">
                <p className="text-sm text-muted-foreground">
                  {searchTerm ? 'Nenhuma atividade encontrada' : 'Digite algo para pesquisar'}
                </p>
              </div>
            ) : (
              <div className="divide-y">
                {/* Cabeçalho da tabela */}
                <div className="bg-muted/50 px-4 py-2 text-sm font-medium">
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-4">Nome</div>
                    <div className="col-span-2">Projeto</div>
                    <div className="col-span-2">Status</div>
                    <div className="col-span-2">Criação</div>
                    <div className="col-span-2">Prazo</div>
                  </div>
                </div>
                
                {/* Linhas dos resultados */}
                {searchResults.map((atividade) => (
                  <div key={atividade.id} className="px-4 py-3 hover:bg-muted/30 transition-colors">
                    <div className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-4">
                        <div className="space-y-1">
                          <div className="font-medium text-sm">{atividade.nome}</div>
                          <div className="text-xs text-muted-foreground">
                            {atividade.descricao || 'Sem descrição'}
                          </div>
                        </div>
                      </div>
                      
                      <div className="col-span-2">
                        <div className="text-sm">{atividade.projeto.nome}</div>
                      </div>
                      
                      <div className="col-span-2">
                        <Badge 
                          className={
                            atividade.status.nome.toLowerCase() === 'concluído' || atividade.status.nome.toLowerCase() === 'concluido'
                              ? "bg-green-100 text-green-800 hover:bg-green-200 border-green-200"
                              : atividade.status.nome.toLowerCase() === 'em andamento'
                              ? "bg-yellow-100 text-yellow-800 hover:bg-yellow-200 border-yellow-200"
                              : "bg-blue-100 text-blue-800 hover:bg-blue-200 border-blue-200"
                          }
                        >
                          {atividade.status.nome}
                        </Badge>
                      </div>
                      
                      <div className="col-span-2">
                        <div className="text-sm">{formatDate(atividade.data_criacao)}</div>
                      </div>
                      
                      <div className="col-span-2">
                        <div className="text-sm">{formatDate(atividade.data_termino)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Rodapé com informações */}
          {searchResults.length > 0 && (
            <div className="text-sm text-muted-foreground text-center">
              {searchTerm ? (
                <span>Encontradas {searchResults.length} atividade(s) para "{searchTerm}"</span>
              ) : (
                <span>Total: {searchResults.length} atividade(s)</span>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end pt-4">
          <Button type="button" variant="outline" onClick={handleClose}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CreateActivityModal() {
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState<FormData>({
    nome: '',
    descricao: '',
    data_termino: '',
    projeto_id: '',
    status_id: ''
  })

  // Usar hooks de cache para carregar dados
  const { projects } = useProjects()
  const { statuses } = useStatuses()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      const response = await fetch('/api/activities', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nome: formData.nome,
          descricao: formData.descricao,
          data_termino: formData.data_termino ? new Date(formData.data_termino).toISOString() : null,
          projeto_id: parseInt(formData.projeto_id),
          status_id: parseInt(formData.status_id)
        })
      })

      if (response.ok) {
        // Resetar form
        setFormData({
          nome: '',
          descricao: '',
          data_termino: '',
          projeto_id: '',
          status_id: ''
        })
        setOpen(false)
        // Invalidar cache de atividades para recarregar
        invalidateActivities()
      } else {
        console.error('Erro ao criar atividade')
      }
    } catch (error) {
      console.error('Erro ao criar atividade:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleInputChange = (field: keyof FormData, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Criar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Criar Nova Atividade</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nome">Nome da Atividade</Label>
            <Input
              id="nome"
              value={formData.nome}
              onChange={(e) => handleInputChange('nome', e.target.value)}
              placeholder="Digite o nome da atividade"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="descricao">Descrição</Label>
            <Textarea
              id="descricao"
              value={formData.descricao}
              onChange={(e) => handleInputChange('descricao', e.target.value)}
              placeholder="Digite a descrição da atividade"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="data_termino">Data de Término</Label>
            <Input
              id="data_termino"
              type="datetime-local"
              value={formData.data_termino}
              onChange={(e) => handleInputChange('data_termino', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="projeto">Projeto</Label>
            <Select value={formData.projeto_id} onValueChange={(value) => handleInputChange('projeto_id', value)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um projeto" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((projeto) => (
                  <SelectItem key={projeto.id} value={projeto.id?.toString() || ''}>
                    {projeto.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select value={formData.status_id} onValueChange={(value) => handleInputChange('status_id', value)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um status" />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((st) => (
                  <SelectItem key={st.id} value={st.id?.toString() || ''}>
                    {st.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Criando...' : 'Criar Atividade'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CreateProjectModal() {
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState({
    nome: '',
    descricao: ''
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      const response = await fetch('/api/projetos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nome: formData.nome,
          descricao: formData.descricao
        })
      })

      if (response.ok) {
        // Resetar form
        setFormData({
          nome: '',
          descricao: ''
        })
        setOpen(false)
        // Invalidar cache de projetos para recarregar
        invalidateProjects()
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido' }))
        alert(`Erro ao criar projeto: ${errorData.error || 'Erro desconhecido'}`)
        console.error('Erro ao criar projeto:', errorData)
      }
    } catch (error) {
      alert('Erro ao criar projeto: Erro de conexão')
      console.error('Erro ao criar projeto:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Criar Projeto
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Criar Novo Projeto</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nome">Nome do Projeto</Label>
            <Input
              id="nome"
              value={formData.nome}
              onChange={(e) => handleInputChange('nome', e.target.value)}
              placeholder="Digite o nome do projeto"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="descricao">Descrição</Label>
            <Textarea
              id="descricao"
              value={formData.descricao}
              onChange={(e) => handleInputChange('descricao', e.target.value)}
              placeholder="Digite a descrição do projeto"
              rows={3}
            />
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Criando...' : 'Criar Projeto'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DevelopmentMessage({ feature }: { feature: string }) {
  return (
    <div className="border rounded-lg">
      <div className="p-8">
        <div className="flex items-center justify-center h-32">
          <div className="text-center space-y-2">
            <h3 className="text-lg font-medium">{feature}</h3>
            <p className="text-muted-foreground">Em desenvolvimento</p>
          </div>
        </div>
      </div>
    </div>
  )
}
"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Filter, X } from "lucide-react"
import { DatePickerField } from "@/components/ui/date-picker-field"

interface Processo {
  id: number
  nome: string
}

interface Usuario {
  id: number
  nome: string
}

interface FilterOptions {
  processo?: string
  status?: string
  responsavel?: string
  nomeAtividade?: string
  prioridade?: string
  dataInicio?: string
  dataFim?: string
}

interface ActivityFiltersProps {
  onFiltersChange: (filters: FilterOptions) => void
  activeFilters: FilterOptions
}

// Status de tarefas (baseado no campo concluida)
const STATUS_TAREFAS = [
  { id: 'pendente', nome: 'Pendente' },
  { id: 'concluida', nome: 'Concluída' }
]

// Prioridades disponíveis
const PRIORIDADES = [
  { id: 'BAIXA', nome: 'Baixa' },
  { id: 'MEDIA', nome: 'Média' },
  { id: 'ALTA', nome: 'Alta' },
  { id: 'URGENTE', nome: 'Urgente' }
]

export default function ActivityFilters({ onFiltersChange, activeFilters }: ActivityFiltersProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [processos, setProcessos] = useState<Processo[]>([])
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [localFilters, setLocalFilters] = useState<FilterOptions>(activeFilters)

  useEffect(() => {
    fetchProcessos()
    fetchUsuarios()
  }, [])

  useEffect(() => {
    setLocalFilters(activeFilters)
  }, [activeFilters])

  const fetchProcessos = async () => {
    try {
      const response = await fetch('/api/processos')
      if (response.ok) {
        const data = await response.json()
        setProcessos(data.processos || data || [])
      }
    } catch (error) {
      console.error('Erro ao carregar processos:', error)
    }
  }

  const fetchUsuarios = async () => {
    try {
      const response = await fetch('/api/usuarios')
      if (response.ok) {
        const data = await response.json()
        setUsuarios(data.usuarios || data || [])
      }
    } catch (error) {
      console.error('Erro ao carregar usuários:', error)
    }
  }

  const handleFilterChange = (key: keyof FilterOptions, value: string) => {
    const newFilters = {
      ...localFilters,
      [key]: value || undefined
    }
    setLocalFilters(newFilters)
  }

  const applyFilters = () => {
    onFiltersChange(localFilters)
    setIsOpen(false)
  }

  const clearFilters = () => {
    const emptyFilters = {}
    setLocalFilters(emptyFilters)
    onFiltersChange(emptyFilters)
  }

  const removeFilter = (key: keyof FilterOptions) => {
    const newFilters = { ...activeFilters }
    delete newFilters[key]
    onFiltersChange(newFilters)
  }

  const getActiveFilterCount = () => {
    return Object.values(activeFilters).filter(value => value && value !== '').length
  }

  const getStatusLabel = (statusId: string) => {
    return STATUS_TAREFAS.find(s => s.id === statusId)?.nome || statusId
  }

  const getPrioridadeLabel = (prioridadeId: string) => {
    return PRIORIDADES.find(p => p.id === prioridadeId)?.nome || prioridadeId
  }

  const activeFilterCount = getActiveFilterCount()

  return (
    <div className="flex items-center gap-2">
      {/* Filtros ativos */}
      <div className="flex items-center gap-1 flex-wrap">
        {activeFilters.nomeAtividade && (
          <Badge variant="secondary" className="text-xs bg-white/10 text-white border-white/20">
            Nome: {activeFilters.nomeAtividade}
            <Button
              variant="ghost"
              size="sm"
              className="h-3 w-3 p-0 ml-1 hover:bg-red-500/20"
              onClick={() => removeFilter('nomeAtividade')}
            >
              <X className="h-2 w-2" />
            </Button>
          </Badge>
        )}
        
        {activeFilters.processo && (
          <Badge variant="secondary" className="text-xs bg-white/10 text-white border-white/20">
            Processo: {processos.find(p => p.id.toString() === activeFilters.processo)?.nome || activeFilters.processo}
            <Button
              variant="ghost"
              size="sm"
              className="h-3 w-3 p-0 ml-1 hover:bg-red-500/20"
              onClick={() => removeFilter('processo')}
            >
              <X className="h-2 w-2" />
            </Button>
          </Badge>
        )}

        {activeFilters.status && (
          <Badge variant="secondary" className={`text-xs ${
            activeFilters.status === 'pendente' 
              ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' 
              : 'bg-green-500/20 text-green-300 border-green-500/30'
          }`}>
            Status: {getStatusLabel(activeFilters.status)}
            <Button
              variant="ghost"
              size="sm"
              className="h-3 w-3 p-0 ml-1 hover:bg-red-500/20"
              onClick={() => removeFilter('status')}
            >
              <X className="h-2 w-2" />
            </Button>
          </Badge>
        )}

        {activeFilters.prioridade && (
          <Badge variant="secondary" className="text-xs bg-white/10 text-white border-white/20">
            Prioridade: {getPrioridadeLabel(activeFilters.prioridade)}
            <Button
              variant="ghost"
              size="sm"
              className="h-3 w-3 p-0 ml-1 hover:bg-red-500/20"
              onClick={() => removeFilter('prioridade')}
            >
              <X className="h-2 w-2" />
            </Button>
          </Badge>
        )}

        {activeFilters.responsavel && (
          <Badge variant="secondary" className="text-xs bg-white/10 text-white border-white/20">
            Responsável: {usuarios.find(u => u.id.toString() === activeFilters.responsavel)?.nome || activeFilters.responsavel}
            <Button
              variant="ghost"
              size="sm"
              className="h-3 w-3 p-0 ml-1 hover:bg-red-500/20"
              onClick={() => removeFilter('responsavel')}
            >
              <X className="h-2 w-2" />
            </Button>
          </Badge>
        )}
      </div>

      {/* Botão de filtros */}
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="relative bg-transparent border-white/30 text-white hover:bg-white/10">
            <Filter className="h-4 w-4 mr-2" />
            Filtro
            {activeFilterCount > 0 && (
              <Badge variant="destructive" className="absolute -top-2 -right-2 h-5 w-5 p-0 text-xs">
                {activeFilterCount}
              </Badge>
            )}
          </Button>
        </SheetTrigger>
        <SheetContent className="bg-[#1a1a2e] border-white/10 text-white">
          <SheetHeader>
            <SheetTitle className="text-white">Filtrar Tarefas</SheetTitle>
            <SheetDescription className="text-white/60">
              Configure os filtros para encontrar tarefas específicas
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 mt-6">
            {/* Nome da tarefa */}
            <div className="space-y-2">
              <Label htmlFor="nomeAtividade" className="text-white">Nome da Tarefa</Label>
              <Input
                id="nomeAtividade"
                placeholder="Digite o nome da tarefa"
                value={localFilters.nomeAtividade || ''}
                onChange={(e) => handleFilterChange('nomeAtividade', e.target.value)}
                className="bg-white/10 border-white/20 text-white placeholder:text-white/50"
              />
            </div>

            {/* Processo vinculado */}
            <div className="space-y-2">
              <Label htmlFor="processo" className="text-white">Processo</Label>
              <Select
                value={localFilters.processo || 'all'}
                onValueChange={(value) => handleFilterChange('processo', value === 'all' ? '' : value)}
              >
                <SelectTrigger className="bg-white/10 border-white/20 text-white">
                  <SelectValue placeholder="Todos os processos" />
                </SelectTrigger>
                <SelectContent className="bg-[#1a1a2e] border-white/20">
                  <SelectItem value="all" className="text-white hover:bg-white/10">Todos os processos</SelectItem>
                  {processos.map((processo) => (
                    <SelectItem key={processo.id} value={processo.id.toString()} className="text-white hover:bg-white/10">
                      {processo.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Status */}
            <div className="space-y-2">
              <Label htmlFor="status" className="text-white">Status</Label>
              <Select
                value={localFilters.status || 'all'}
                onValueChange={(value) => handleFilterChange('status', value === 'all' ? '' : value)}
              >
                <SelectTrigger className="bg-white/10 border-white/20 text-white">
                  <SelectValue placeholder="Todos os Status" />
                </SelectTrigger>
                <SelectContent className="bg-[#1a1a2e] border-white/20">
                  <SelectItem value="all" className="text-white hover:bg-white/10">Todos os Status</SelectItem>
                  {STATUS_TAREFAS.map((status) => (
                    <SelectItem key={status.id} value={status.id} className="text-white hover:bg-white/10">
                      <span className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${
                          status.id === 'pendente' ? 'bg-yellow-400' : 'bg-green-400'
                        }`}></span>
                        {status.nome}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Prioridade */}
            <div className="space-y-2">
              <Label htmlFor="prioridade" className="text-white">Prioridade</Label>
              <Select
                value={localFilters.prioridade || 'all'}
                onValueChange={(value) => handleFilterChange('prioridade', value === 'all' ? '' : value)}
              >
                <SelectTrigger className="bg-white/10 border-white/20 text-white">
                  <SelectValue placeholder="Todas as prioridades" />
                </SelectTrigger>
                <SelectContent className="bg-[#1a1a2e] border-white/20">
                  <SelectItem value="all" className="text-white hover:bg-white/10">Todas as prioridades</SelectItem>
                  {PRIORIDADES.map((prioridade) => (
                    <SelectItem key={prioridade.id} value={prioridade.id} className="text-white hover:bg-white/10">
                      <span className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${
                          prioridade.id === 'URGENTE' ? 'bg-red-500' :
                          prioridade.id === 'ALTA' ? 'bg-orange-500' :
                          prioridade.id === 'MEDIA' ? 'bg-yellow-500' :
                          'bg-green-500'
                        }`}></span>
                        {prioridade.nome}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Responsável */}
            <div className="space-y-2">
              <Label htmlFor="responsavel" className="text-white">Responsável</Label>
              <Select
                value={localFilters.responsavel || 'all'}
                onValueChange={(value) => handleFilterChange('responsavel', value === 'all' ? '' : value)}
              >
                <SelectTrigger className="bg-white/10 border-white/20 text-white">
                  <SelectValue placeholder="Todos os Responsáveis" />
                </SelectTrigger>
                <SelectContent className="bg-[#1a1a2e] border-white/20">
                  <SelectItem value="all" className="text-white hover:bg-white/10">Todos os Responsáveis</SelectItem>
                  {usuarios.map((usuario) => (
                    <SelectItem key={usuario.id} value={usuario.id.toString()} className="text-white hover:bg-white/10">
                      {usuario.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Data Início */}
            <div className="space-y-2">
              <Label htmlFor="dataInicio" className="text-white">Data Início</Label>
              <DatePickerField
                value={localFilters.dataInicio || ''}
                onChange={(value) => handleFilterChange('dataInicio', value)}
              />
            </div>

            {/* Data Fim */}
            <div className="space-y-2">
              <Label htmlFor="dataFim" className="text-white">Data Fim</Label>
              <DatePickerField
                value={localFilters.dataFim || ''}
                onChange={(value) => handleFilterChange('dataFim', value)}
              />
            </div>

            {/* Botões */}
            <div className="flex gap-2 pt-4">
              <Button 
                variant="outline" 
                onClick={clearFilters}
                className="flex-1 bg-transparent border-white/30 text-white hover:bg-white/10"
              >
                Limpar Filtros
              </Button>
              <Button 
                onClick={applyFilters} 
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
              >
                Aplicar Filtros
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Botão para limpar todos os filtros */}
      {activeFilterCount > 0 && (
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={clearFilters}
          className="text-white/60 hover:text-white hover:bg-white/10"
        >
          Limpar filtros
        </Button>
      )}
    </div>
  )
}
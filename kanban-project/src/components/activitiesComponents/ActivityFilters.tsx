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

interface Projeto {
  id: number
  nome: string
}

interface Status {
  id: number
  nome: string
}

interface FilterOptions {
  projeto?: string
  status?: string
  responsavel?: string
  nomeAtividade?: string
}

interface ActivityFiltersProps {
  onFiltersChange: (filters: FilterOptions) => void
  activeFilters: FilterOptions
}

export default function ActivityFilters({ onFiltersChange, activeFilters }: ActivityFiltersProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [projetos, setProjetos] = useState<Projeto[]>([])
  const [statusList, setStatusList] = useState<Status[]>([])
  const [localFilters, setLocalFilters] = useState<FilterOptions>(activeFilters)

  useEffect(() => {
    fetchProjetos()
    fetchStatus()
  }, [])

  useEffect(() => {
    setLocalFilters(activeFilters)
  }, [activeFilters])

  const fetchProjetos = async () => {
    try {
      const response = await fetch('/api/projetos')
      if (response.ok) {
        const data = await response.json()
        setProjetos(data)
      }
    } catch (error) {
      console.error('Erro ao carregar projetos:', error)
    }
  }

  const fetchStatus = async () => {
    try {
      const response = await fetch('/api/status')
      if (response.ok) {
        const data = await response.json()
        setStatusList(data)
      }
    } catch (error) {
      console.error('Erro ao carregar status:', error)
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

  const activeFilterCount = getActiveFilterCount()

  return (
    <div className="flex items-center gap-2">
      {/* Filtros ativos */}
      <div className="flex items-center gap-1 flex-wrap">
        {activeFilters.nomeAtividade && (
          <Badge variant="secondary" className="text-xs">
            Nome: {activeFilters.nomeAtividade}
            <Button
              variant="ghost"
              size="sm"
              className="h-3 w-3 p-0 ml-1 hover:bg-destructive hover:text-destructive-foreground"
              onClick={() => removeFilter('nomeAtividade')}
            >
              <X className="h-2 w-2" />
            </Button>
          </Badge>
        )}
        
        {activeFilters.projeto && (
          <Badge variant="secondary" className="text-xs">
            Projeto: {projetos.find(p => p.id.toString() === activeFilters.projeto)?.nome || activeFilters.projeto}
            <Button
              variant="ghost"
              size="sm"
              className="h-3 w-3 p-0 ml-1 hover:bg-destructive hover:text-destructive-foreground"
              onClick={() => removeFilter('projeto')}
            >
              <X className="h-2 w-2" />
            </Button>
          </Badge>
        )}

        {activeFilters.status && (
          <Badge variant="secondary" className="text-xs">
            Status: {statusList.find(s => s.id.toString() === activeFilters.status)?.nome || activeFilters.status}
            <Button
              variant="ghost"
              size="sm"
              className="h-3 w-3 p-0 ml-1 hover:bg-destructive hover:text-destructive-foreground"
              onClick={() => removeFilter('status')}
            >
              <X className="h-2 w-2" />
            </Button>
          </Badge>
        )}

        {activeFilters.responsavel && (
          <Badge variant="secondary" className="text-xs">
            Responsável: {activeFilters.responsavel}
            <Button
              variant="ghost"
              size="sm"
              className="h-3 w-3 p-0 ml-1 hover:bg-destructive hover:text-destructive-foreground"
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
          <Button variant="outline" size="sm" className="relative">
            <Filter className="h-4 w-4 mr-2" />
            Filtros
            {activeFilterCount > 0 && (
              <Badge variant="destructive" className="absolute -top-2 -right-2 h-5 w-5 p-0 text-xs">
                {activeFilterCount}
              </Badge>
            )}
          </Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Filtrar Atividades</SheetTitle>
            <SheetDescription>
              Configure os filtros para encontrar atividades específicas
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 mt-6">
            {/* Nome da atividade */}
            <div className="space-y-2">
              <Label htmlFor="nomeAtividade">Nome da Atividade</Label>
              <Input
                id="nomeAtividade"
                placeholder="Digite o nome da atividade"
                value={localFilters.nomeAtividade || ''}
                onChange={(e) => handleFilterChange('nomeAtividade', e.target.value)}
              />
            </div>

            {/* Projeto */}
            <div className="space-y-2">
              <Label htmlFor="projeto">Projeto</Label>
              <Select
                value={localFilters.projeto || ''}
                onValueChange={(value) => handleFilterChange('projeto', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um projeto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Todos os projetos</SelectItem>
                  {projetos.map((projeto) => (
                    <SelectItem key={projeto.id} value={projeto.id.toString()}>
                      {projeto.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Status */}
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={localFilters.status || ''}
                onValueChange={(value) => handleFilterChange('status', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Todos os status</SelectItem>
                  {statusList.map((status) => (
                    <SelectItem key={status.id} value={status.id.toString()}>
                      {status.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Responsável */}
            <div className="space-y-2">
              <Label htmlFor="responsavel">Responsável</Label>
              <Input
                id="responsavel"
                placeholder="Nome do responsável"
                value={localFilters.responsavel || ''}
                onChange={(e) => handleFilterChange('responsavel', e.target.value)}
              />
            </div>

            {/* Botões */}
            <div className="flex gap-2 pt-4">
              <Button onClick={applyFilters} className="flex-1">
                Aplicar Filtros
              </Button>
              <Button variant="outline" onClick={clearFilters}>
                Limpar
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Botão para limpar todos os filtros */}
      {activeFilterCount > 0 && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          Limpar filtros
        </Button>
      )}
    </div>
  )
}
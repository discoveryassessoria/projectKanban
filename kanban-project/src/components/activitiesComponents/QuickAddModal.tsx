"use client"

/**
 * Modal para criação rápida de atividades
 * Permite criar uma atividade com prazo pré-definido baseado na coluna do kanban
 */

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Loader2, Calendar } from "lucide-react"
import { PrazoClassification } from "@/src/utils/prazoUtils"

interface Projeto {
  id: number
  nome: string
  descricao: string | null
  _count: {
    atividades: number
  }
}

interface Status {
  id: number
  nome: string
}

interface QuickAddModalProps {
  isOpen: boolean
  onClose: () => void
  classification: PrazoClassification
  onSubmit: (data: QuickAddFormData) => Promise<void>
  isLoading?: boolean
}

export interface QuickAddFormData {
  nome: string
  descricao: string
  projeto_id: number
  status_id: number
  prazo_category: string
}

export default function QuickAddModal({ 
  isOpen, 
  onClose, 
  classification, 
  onSubmit, 
  isLoading = false 
}: QuickAddModalProps) {
  const [formData, setFormData] = useState<QuickAddFormData>({
    nome: '',
    descricao: '',
    projeto_id: 0,
    status_id: 0,
    prazo_category: classification.category
  })
  
  const [projetos, setProjetos] = useState<Projeto[]>([])
  const [statuses, setStatuses] = useState<Status[]>([])
  const [loadingProjetos, setLoadingProjetos] = useState(false)
  const [loadingStatuses, setLoadingStatuses] = useState(false)
  const [errors, setErrors] = useState<{[key: string]: string}>({})

  // Carregar projetos quando modal abrir
  useEffect(() => {
    if (isOpen) {
      fetchProjetos()
      fetchStatuses()
      // Auto-focus no campo nome
      setTimeout(() => {
        const nomeInput = document.getElementById('quick-add-nome')
        if (nomeInput) {
          nomeInput.focus()
        }
      }, 100)
    }
  }, [isOpen])

  // Reset form quando fechar
  useEffect(() => {
    if (!isOpen) {
      setFormData({
        nome: '',
        descricao: '',
        projeto_id: 0,
        status_id: 0,
        prazo_category: classification.category
      })
      setErrors({})
    }
  }, [isOpen, classification.category])

  const fetchProjetos = async () => {
    try {
      setLoadingProjetos(true)
      const response = await fetch('/api/projetos')
      if (response.ok) {
        const data = await response.json()
        setProjetos(data)
      }
    } catch (error) {
      console.error('Erro ao carregar projetos:', error)
    } finally {
      setLoadingProjetos(false)
    }
  }

  const fetchStatuses = async () => {
    try {
      setLoadingStatuses(true)
      const response = await fetch('/api/status')
      if (response.ok) {
        const data = await response.json()
        setStatuses(data)
        
        // Definir status padrão automaticamente
        if (data.length > 0 && !formData.status_id) {
          const defaultStatus = data.find((status: Status) => 
            status.nome.toLowerCase().includes('fazer') ||
            status.nome.toLowerCase().includes('pendente') ||
            status.nome.toLowerCase().includes('novo')
          )
          
          const statusToUse = defaultStatus || data[0]
          setFormData(prev => ({ ...prev, status_id: statusToUse.id }))
        }
      }
    } catch (error) {
      console.error('Erro ao carregar status:', error)
    } finally {
      setLoadingStatuses(false)
    }
  }

  const validateForm = () => {
    const newErrors: {[key: string]: string} = {}
    
    if (!formData.nome.trim()) {
      newErrors.nome = 'Nome da atividade é obrigatório'
    }
    
    if (!formData.projeto_id || formData.projeto_id <= 0) {
      newErrors.projeto_id = 'Selecione um projeto'
    }
    
    if (!formData.status_id || formData.status_id <= 0) {
      newErrors.status_id = 'Selecione um status'
    }
    
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm()) {
      return
    }

    try {
      await onSubmit(formData)
      onClose()
    } catch (error) {
      console.error('Erro ao criar atividade:', error)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      handleSubmit(e as any)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>Adicionar Tarefa Rápida</DialogTitle>
          <DialogDescription>
            Crie uma nova atividade rapidamente com o prazo já definido.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Prazo Preview */}
          <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
            <Calendar className="h-4 w-4" />
            <span className="text-sm font-medium">Prazo:</span>
            <Badge variant={classification.color as any} className="text-xs">
              {classification.label}
            </Badge>
            <span className="text-xs text-muted-foreground ml-auto">
              {classification.description}
            </span>
          </div>

          {/* Nome */}
          <div className="space-y-2">
            <Label htmlFor="quick-add-nome">
              Nome da Atividade <span className="text-red-500">*</span>
            </Label>
            <Input
              id="quick-add-nome"
              value={formData.nome}
              onChange={(e) => setFormData(prev => ({ ...prev, nome: e.target.value }))}
              placeholder="Digite o nome da atividade..."
              className={errors.nome ? 'border-red-500' : ''}
              disabled={isLoading}
            />
            {errors.nome && (
              <p className="text-sm text-red-500">{errors.nome}</p>
            )}
          </div>

          {/* Projeto */}
          <div className="space-y-2">
            <Label htmlFor="quick-add-projeto">
              Projeto <span className="text-red-500">*</span>
            </Label>
            <Select
              value={formData.projeto_id > 0 ? formData.projeto_id.toString() : ""}
              onValueChange={(value) => setFormData(prev => ({ ...prev, projeto_id: parseInt(value) }))}
              disabled={isLoading || loadingProjetos}
            >
              <SelectTrigger className={errors.projeto_id ? 'border-red-500' : ''}>
                <SelectValue placeholder="Selecione um projeto" />
                {loadingProjetos && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
              </SelectTrigger>
              <SelectContent>
                {projetos.map((projeto) => (
                  <SelectItem key={projeto.id} value={projeto.id.toString()}>
                    <div className="flex items-center justify-between w-full">
                      <span>{projeto.nome}</span>
                      <Badge variant="outline" className="ml-2 text-xs">
                        {projeto._count.atividades} atividades
                      </Badge>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.projeto_id && (
              <p className="text-sm text-red-500">{errors.projeto_id}</p>
            )}
          </div>

          {/* Status */}
          <div className="space-y-2">
            <Label htmlFor="quick-add-status">
              Status <span className="text-red-500">*</span>
            </Label>
            <Select
              value={formData.status_id > 0 ? formData.status_id.toString() : ""}
              onValueChange={(value) => setFormData(prev => ({ ...prev, status_id: parseInt(value) }))}
              disabled={isLoading || loadingStatuses}
            >
              <SelectTrigger className={errors.status_id ? 'border-red-500' : ''}>
                <SelectValue placeholder="Selecione um status" />
                {loadingStatuses && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
              </SelectTrigger>
              <SelectContent>
                {statuses.map((status) => (
                  <SelectItem key={status.id} value={status.id.toString()}>
                    <div className="flex items-center justify-between w-full">
                      <span>{status.nome}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.status_id && (
              <p className="text-sm text-red-500">{errors.status_id}</p>
            )}
          </div>

          {/* Descrição */}
          <div className="space-y-2">
            <Label htmlFor="quick-add-descricao">Descrição (opcional)</Label>
            <Textarea
              id="quick-add-descricao"
              value={formData.descricao}
              onChange={(e) => setFormData(prev => ({ ...prev, descricao: e.target.value }))}
              placeholder="Descreva brevemente a atividade..."
              rows={3}
              disabled={isLoading}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isLoading || !formData.nome.trim() || !formData.projeto_id || !formData.status_id}
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Criar Atividade
            </Button>
          </div>

          {/* Shortcut hint */}
          <p className="text-xs text-muted-foreground text-center pt-2">
            Pressione Ctrl + Enter para criar rapidamente
          </p>
        </form>
      </DialogContent>
    </Dialog>
  )
}
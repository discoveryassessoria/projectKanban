"use client"

/**
 * Modal para criação rápida de tarefas
 * Com opção de vincular a um processo do kanban
 */

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Loader2, Calendar, Flag, User, Link2 } from "lucide-react"
import { PrazoClassification } from "@/src/utils/prazoUtils"

interface Usuario {
  id: number
  nome: string
  email?: string
}

interface Processo {
  id: number
  nome: string
  pais?: string
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
  prioridade: string
  responsavelId: number | null
  processoId: number | null
  prazo_category: string
  // Campos para compatibilidade (podem ser ignorados pelo hook)
  projeto_id?: number
  status_id?: number
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
    prioridade: 'MEDIA',
    responsavelId: null,
    processoId: null,
    prazo_category: classification.category
  })
  
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [processos, setProcessos] = useState<Processo[]>([])
  const [loadingUsuarios, setLoadingUsuarios] = useState(false)
  const [loadingProcessos, setLoadingProcessos] = useState(false)
  const [errors, setErrors] = useState<{[key: string]: string}>({})

  // Carregar dados quando modal abrir
  useEffect(() => {
    if (isOpen) {
      fetchUsuarios()
      fetchProcessos()
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
        prioridade: 'MEDIA',
        responsavelId: null,
        processoId: null,
        prazo_category: classification.category
      })
      setErrors({})
    }
  }, [isOpen, classification.category])

  const fetchUsuarios = async () => {
    try {
      setLoadingUsuarios(true)
      const response = await fetch('/api/usuarios')
      if (response.ok) {
        const data = await response.json()
        setUsuarios(data.usuarios || data || [])
      }
    } catch (error) {
      console.error('Erro ao carregar usuários:', error)
    } finally {
      setLoadingUsuarios(false)
    }
  }

  const fetchProcessos = async () => {
    try {
      setLoadingProcessos(true)
      const response = await fetch('/api/processos')
      if (response.ok) {
        const data = await response.json()
        setProcessos(data.processos || data || [])
      }
    } catch (error) {
      console.error('Erro ao carregar processos:', error)
    } finally {
      setLoadingProcessos(false)
    }
  }

  const validateForm = () => {
    const newErrors: {[key: string]: string} = {}
    
    if (!formData.nome.trim()) {
      newErrors.nome = 'Nome da tarefa é obrigatório'
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
      console.error('Erro ao criar tarefa:', error)
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
          <DialogTitle>Nova Tarefa</DialogTitle>
          <DialogDescription>
            Crie uma nova tarefa. Ela começará como pendente automaticamente.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Prazo Preview */}
          <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
            <Calendar className="h-4 w-4" />
            <span className="text-sm font-medium">Prazo:</span>
            <Badge variant="outline" className="text-xs">
              {classification.label}
            </Badge>
            <span className="text-xs text-muted-foreground ml-auto">
              {classification.description}
            </span>
          </div>

          {/* Nome */}
          <div className="space-y-2">
            <Label htmlFor="quick-add-nome">
              Nome da Tarefa <span className="text-red-500">*</span>
            </Label>
            <Input
              id="quick-add-nome"
              value={formData.nome}
              onChange={(e) => setFormData(prev => ({ ...prev, nome: e.target.value }))}
              placeholder="Digite o nome da tarefa..."
              className={errors.nome ? 'border-red-500' : ''}
              disabled={isLoading}
            />
            {errors.nome && (
              <p className="text-sm text-red-500">{errors.nome}</p>
            )}
          </div>

          {/* Processo vinculado */}
          <div className="space-y-2">
            <Label htmlFor="quick-add-processo">
              <Link2 className="h-4 w-4 inline mr-1" />
              Vincular a Processo (opcional)
            </Label>
            <Select
              value={formData.processoId?.toString() || "none"}
              onValueChange={(value) => setFormData(prev => ({ 
                ...prev, 
                processoId: value === "none" ? null : parseInt(value) 
              }))}
              disabled={isLoading || loadingProcessos}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione um processo" />
                {loadingProcessos && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem vínculo (tarefa independente)</SelectItem>
                {processos.map((processo) => (
                  <SelectItem key={processo.id} value={processo.id.toString()}>
                    <span className="flex items-center gap-2">
                      {processo.nome}
                      {processo.pais && (
                        <Badge variant="outline" className="text-xs">
                          {processo.pais}
                        </Badge>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Vincule a tarefa a um card do kanban para melhor organização
            </p>
          </div>

          {/* Prioridade */}
          <div className="space-y-2">
            <Label htmlFor="quick-add-prioridade">
              <Flag className="h-4 w-4 inline mr-1" />
              Prioridade
            </Label>
            <Select
              value={formData.prioridade}
              onValueChange={(value) => setFormData(prev => ({ ...prev, prioridade: value }))}
              disabled={isLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione a prioridade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BAIXA">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                    Baixa
                  </span>
                </SelectItem>
                <SelectItem value="MEDIA">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                    Média
                  </span>
                </SelectItem>
                <SelectItem value="ALTA">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                    Alta
                  </span>
                </SelectItem>
                <SelectItem value="URGENTE">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500"></span>
                    Urgente
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Responsável */}
          <div className="space-y-2">
            <Label htmlFor="quick-add-responsavel">
              <User className="h-4 w-4 inline mr-1" />
              Responsável (opcional)
            </Label>
            <Select
              value={formData.responsavelId?.toString() || "none"}
              onValueChange={(value) => setFormData(prev => ({ 
                ...prev, 
                responsavelId: value === "none" ? null : parseInt(value) 
              }))}
              disabled={isLoading || loadingUsuarios}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione um responsável" />
                {loadingUsuarios && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem responsável</SelectItem>
                {usuarios.map((usuario) => (
                  <SelectItem key={usuario.id} value={usuario.id.toString()}>
                    {usuario.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Descrição */}
          <div className="space-y-2">
            <Label htmlFor="quick-add-descricao">Descrição (opcional)</Label>
            <Textarea
              id="quick-add-descricao"
              value={formData.descricao}
              onChange={(e) => setFormData(prev => ({ ...prev, descricao: e.target.value }))}
              placeholder="Descreva brevemente a tarefa..."
              rows={3}
              disabled={isLoading}
            />
          </div>

          {/* Status info */}
          <div className="flex items-center gap-2 p-2 bg-yellow-50 rounded-lg border border-yellow-200">
            <Badge className="bg-yellow-100 text-yellow-700 border-yellow-300">
              Pendente
            </Badge>
            <span className="text-xs text-yellow-700">
              A tarefa será criada como pendente
            </span>
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
              disabled={isLoading || !formData.nome.trim()}
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Criar Tarefa
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
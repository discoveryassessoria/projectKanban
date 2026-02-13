"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { 
  CheckCircle2, 
  Circle, 
  Flag, 
  Calendar, 
  User, 
  Briefcase, 
  MapPin,
  Trash2,
  Plus,
  ChevronRight,
  Loader2
} from "lucide-react"
import { useUsers } from "@/src/hooks/useActivitiesData"
import { usePermissoes } from "@/src/hooks/use-permissoes"

// Mapeamento de países para exibição
const PAIS_LABELS: Record<string, string> = {
  PORTUGAL: 'Portugal',
  ESPANHA: 'Espanha',
  ALEMANHA: 'Alemanha',
  ITALIA: 'Itália'
}

const PRIORIDADE_CONFIG = {
  BAIXA: { label: 'Baixa', color: 'bg-gray-100 text-gray-600 border-gray-300', icon: '⚪' },
  MEDIA: { label: 'Média', color: 'bg-yellow-100 text-yellow-700 border-yellow-300', icon: '🟡' },
  ALTA: { label: 'Alta', color: 'bg-orange-100 text-orange-700 border-orange-300', icon: '🟠' },
  URGENTE: { label: 'Urgente', color: 'bg-red-100 text-red-700 border-red-300', icon: '🔴' }
}

interface Subtarefa {
  id: number
  titulo: string
  concluida: boolean
  responsavel?: {
    id: number
    nome: string
  }
}

interface Processo {
  id: number
  nome: string
  pais?: string
  contratantes?: {
    contratante: {
      id: number
      nome: string
    }
  }[]
}

interface Responsavel {
  id: number
  nome: string
  email?: string
}

interface Status {
  id: number
  nome: string
}

interface Tarefa {
  id: number
  titulo?: string
  nome?: string // fallback
  descricao?: string
  concluida: boolean
  prioridade: 'BAIXA' | 'MEDIA' | 'ALTA' | 'URGENTE'
  dataPrazo?: string | null
  data_termino?: string | null // fallback
  pais?: string
  processo?: Processo | null
  responsavel?: Responsavel | null
  status?: Status | null
  subtarefas?: Subtarefa[]
  createdAt?: string
  data_criacao?: string // fallback
}

interface TarefaDetailsModalProps {
  tarefa: Tarefa | null
  isOpen: boolean
  onClose: () => void
  onSave: () => void
}

export function TarefaDetailsModal({ 
  tarefa, 
  isOpen, 
  onClose, 
  onSave 
}: TarefaDetailsModalProps) {
  const { users = [] } = useUsers()
  const { pode } = usePermissoes()
  
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  
  // Form state
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [concluida, setConcluida] = useState(false)
  const [prioridade, setPrioridade] = useState<'BAIXA' | 'MEDIA' | 'ALTA' | 'URGENTE'>('MEDIA')
  const [dataPrazo, setDataPrazo] = useState('')
  const [pais, setPais] = useState('')
  const [responsavelId, setResponsavelId] = useState<string>('none')
  const [subtarefas, setSubtarefas] = useState<Subtarefa[]>([])
  const [novaSubtarefa, setNovaSubtarefa] = useState('')
  
  // Carregar dados da tarefa quando abrir o modal
  useEffect(() => {
    if (tarefa && isOpen) {
      setTitulo(tarefa.titulo || tarefa.nome || '')
      setDescricao(tarefa.descricao || '')
      setConcluida(tarefa.concluida || false)
      setPrioridade(tarefa.prioridade || 'MEDIA')
      setDataPrazo(tarefa.dataPrazo || tarefa.data_termino || '')
      setPais(tarefa.pais || '')
      setResponsavelId(tarefa.responsavel?.id?.toString() || 'none')
      setSubtarefas(tarefa.subtarefas || [])
    }
  }, [tarefa, isOpen])

  // Resetar form ao fechar
  useEffect(() => {
    if (!isOpen) {
      setTitulo('')
      setDescricao('')
      setConcluida(false)
      setPrioridade('MEDIA')
      setDataPrazo('')
      setPais('')
      setResponsavelId('none')
      setSubtarefas([])
      setNovaSubtarefa('')
    }
  }, [isOpen])

  const handleSave = async () => {
    if (!tarefa?.id) return
    
    setIsSaving(true)
    try {
      const response = await fetch(`/api/tarefas/${tarefa.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('authToken')}` },
        body: JSON.stringify({
          titulo,
          descricao,
          concluida,
          prioridade,
          dataPrazo: dataPrazo || null,
          pais: pais && pais !== 'none' ? pais : null,
          responsavelId: responsavelId && responsavelId !== 'none' ? parseInt(responsavelId) : null
        })
      })

      if (response.ok) {
        onSave()
      } else {
        const error = await response.json()
        alert(error.error || 'Erro ao salvar tarefa')
      }
    } catch (error) {
      console.error('Erro ao salvar tarefa:', error)
      alert('Erro ao salvar tarefa')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!tarefa?.id) return
    
    if (!confirm('Tem certeza que deseja excluir esta tarefa?')) return
    
    setIsDeleting(true)
    try {
      const response = await fetch(`/api/tarefas/${tarefa.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
      })

      if (response.ok) {
        onSave()
        onClose()
      } else {
        const error = await response.json()
        alert(error.error || 'Erro ao excluir tarefa')
      }
    } catch (error) {
      console.error('Erro ao excluir tarefa:', error)
      alert('Erro ao excluir tarefa')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleToggleSubtarefa = async (subtarefaId: number, novoStatus: boolean) => {
    try {
      const response = await fetch(`/api/tarefas/${subtarefaId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('authToken')}` },
        body: JSON.stringify({ concluida: novoStatus })
      })

      if (response.ok) {
        setSubtarefas(prev => 
          prev.map(s => s.id === subtarefaId ? { ...s, concluida: novoStatus } : s)
        )
      }
    } catch (error) {
      console.error('Erro ao atualizar subtarefa:', error)
    }
  }

  const handleAddSubtarefa = async () => {
    if (!novaSubtarefa.trim() || !tarefa?.id) return
    
    try {
      const response = await fetch('/api/tarefas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('authToken')}` },
        body: JSON.stringify({
          titulo: novaSubtarefa,
          tarefaPaiId: tarefa.id,
          pais: pais || 'PORTUGAL'
        })
      })

      if (response.ok) {
        const data = await response.json()
        setSubtarefas(prev => [...prev, data.tarefa])
        setNovaSubtarefa('')
      }
    } catch (error) {
      console.error('Erro ao criar subtarefa:', error)
    }
  }

  const formatDateDisplay = (dateStr: string | null | undefined) => {
    if (!dateStr) return 'Sem prazo'
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      })
    } catch {
      return 'Data inválida'
    }
  }

  if (!tarefa) return null

  const prioridadeConfig = PRIORIDADE_CONFIG[prioridade] || PRIORIDADE_CONFIG.MEDIA

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-white border-gray-200 text-gray-900 max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pb-4 border-b border-gray-100">
          <DialogTitle className="sr-only">Detalhes da Tarefa</DialogTitle>
          <div className="flex items-start gap-3">
            {/* Checkbox de status */}
            <button
              type="button"
              onClick={() => setConcluida(!concluida)}
              className="mt-1 flex-shrink-0 transition-transform hover:scale-110"
            >
              {concluida ? (
                <CheckCircle2 className="h-6 w-6 text-green-500" />
              ) : (
                <Circle className="h-6 w-6 text-gray-300 hover:text-gray-400" />
              )}
            </button>
            
            {/* Título editável */}
            <div className="flex-1">
              <Input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Título da tarefa"
                className={`text-lg font-semibold border-0 p-0 h-auto focus-visible:ring-0 bg-transparent ${
                  concluida ? 'line-through text-gray-400' : 'text-gray-900'
                }`}
              />
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 py-4">
          {/* Status (Pendente/Concluída) */}
          <div className="flex items-center gap-4">
            <Label className="text-gray-500 w-24 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Status
            </Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConcluida(false)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  !concluida 
                    ? 'bg-yellow-100 text-yellow-700 border border-yellow-300' 
                    : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'
                }`}
              >
                Pendente
              </button>
              <button
                type="button"
                onClick={() => setConcluida(true)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  concluida 
                    ? 'bg-green-100 text-green-700 border border-green-300' 
                    : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'
                }`}
              >
                Concluída
              </button>
            </div>
          </div>

          {/* Prazo */}
          <div className="flex items-center gap-4">
            <Label className="text-gray-500 w-24 flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Prazo
            </Label>
            <div className="flex-1 max-w-[200px]">
              <DatePickerField
                value={dataPrazo}
                onChange={(value) => setDataPrazo(value)}
                placeholder="Selecionar data"
                fromYear={2020}
                toYear={2030}
              />
            </div>
          </div>

          {/* Prioridade */}
          <div className="flex items-center gap-4">
            <Label className="text-gray-500 w-24 flex items-center gap-2">
              <Flag className="h-4 w-4" />
              Prioridade
            </Label>
            <div className="flex gap-2 flex-wrap">
              {(Object.keys(PRIORIDADE_CONFIG) as Array<keyof typeof PRIORIDADE_CONFIG>).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPrioridade(key)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                    prioridade === key 
                      ? PRIORIDADE_CONFIG[key].color
                      : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {PRIORIDADE_CONFIG[key].icon} {PRIORIDADE_CONFIG[key].label}
                </button>
              ))}
            </div>
          </div>

          {/* País */}
          <div className="flex items-center gap-4">
            <Label className="text-gray-500 w-24 flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              País
            </Label>
            <Select value={pais || 'none'} onValueChange={(value) => setPais(value === 'none' ? '' : value)}>
              <SelectTrigger className="w-[180px] bg-white border-gray-300">
                <SelectValue placeholder="Selecionar país" />
              </SelectTrigger>
              <SelectContent className="bg-white border-gray-200">
                <SelectItem value="none">Nenhum</SelectItem>
                <SelectItem value="PORTUGAL">🇵🇹 Portugal</SelectItem>
                <SelectItem value="ESPANHA">🇪🇸 Espanha</SelectItem>
                <SelectItem value="ITALIA">🇮🇹 Itália</SelectItem>
                <SelectItem value="ALEMANHA">🇩🇪 Alemanha</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Processo vinculado (somente leitura) */}
          {tarefa.processo && (
            <div className="flex items-center gap-4">
              <Label className="text-gray-500 w-24 flex items-center gap-2">
                <Briefcase className="h-4 w-4" />
                Processo
              </Label>
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
                <span className="text-gray-700 font-medium">{tarefa.processo.nome}</span>
                {tarefa.processo.pais && (
                  <Badge variant="outline" className="text-xs">
                    {PAIS_LABELS[tarefa.processo.pais] || tarefa.processo.pais}
                  </Badge>
                )}
                <ChevronRight className="h-4 w-4 text-gray-400" />
              </div>
            </div>
          )}

          {/* Responsável */}
          <div className="flex items-center gap-4">
            <Label className="text-gray-500 w-24 flex items-center gap-2">
              <User className="h-4 w-4" />
              Responsável
            </Label>
            <Select value={responsavelId} onValueChange={setResponsavelId}>
              <SelectTrigger className="w-[200px] bg-white border-gray-300">
                <SelectValue placeholder="Selecionar responsável" />
              </SelectTrigger>
              <SelectContent className="bg-white border-gray-200">
                <SelectItem value="none">Nenhum</SelectItem>
                {users.map((user: { nome: string; email: string; id?: number }) => (
                  <SelectItem key={user.email} value={user.id?.toString() || user.email}>
                    {user.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Descrição */}
          <div className="space-y-2">
            <Label className="text-gray-500 flex items-center gap-2">
              Descrição
            </Label>
            <Textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Adicione uma descrição para esta tarefa..."
              className="bg-white border-gray-300 text-gray-900 min-h-[100px] resize-none"
            />
          </div>

          {/* Subtarefas */}
          {subtarefas.length > 0 && (
            <div className="space-y-2">
              <Label className="text-gray-500 flex items-center gap-2">
                Subtarefas ({subtarefas.filter(s => s.concluida).length}/{subtarefas.length})
              </Label>
              <div className="space-y-1 bg-gray-50 rounded-lg p-3 border border-gray-200">
                {subtarefas.map((subtarefa) => (
                  <div 
                    key={subtarefa.id} 
                    className="flex items-center gap-2 py-1.5 px-2 hover:bg-gray-100 rounded transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => handleToggleSubtarefa(subtarefa.id, !subtarefa.concluida)}
                      className="flex-shrink-0"
                    >
                      {subtarefa.concluida ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <Circle className="h-4 w-4 text-gray-300 hover:text-gray-400" />
                      )}
                    </button>
                    <span className={`flex-1 text-sm ${subtarefa.concluida ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                      {subtarefa.titulo}
                    </span>
                    {subtarefa.responsavel && (
                      <Avatar className="h-5 w-5">
                        <AvatarFallback className="text-[10px] bg-gray-200 text-gray-600">
                          {subtarefa.responsavel.nome.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Adicionar subtarefa */}
          {pode('tarefas.criar') && <div className="flex items-center gap-2">
            <Input
              value={novaSubtarefa}
              onChange={(e) => setNovaSubtarefa(e.target.value)}
              placeholder="Adicionar subtarefa..."
              className="bg-white border-gray-300 text-gray-900"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddSubtarefa()
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleAddSubtarefa}
              disabled={!novaSubtarefa.trim()}
              className="border-gray-300 hover:bg-gray-100"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-gray-100">
          {pode('tarefas.excluir') && <Button
            type="button"
            variant="ghost"
            onClick={handleDelete}
            disabled={isDeleting}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 mr-2" />
            )}
            Excluir
          </Button>}
          
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={isSaving || !titulo.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Salvando...
                </>
              ) : (
                'Salvar'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
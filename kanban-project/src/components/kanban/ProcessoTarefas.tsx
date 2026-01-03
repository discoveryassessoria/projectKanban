"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Plus,
  Calendar,
  CheckCircle2,
  Circle,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  User,
  Flag,
  X,
  Edit2
} from "lucide-react"

interface Responsavel {
  id: number
  nome: string
  email?: string
}

interface Tarefa {
  id: number
  titulo: string
  descricao?: string
  concluida: boolean
  prioridade: string
  dataPrazo?: string
  dataConclusao?: string
  responsavel?: Responsavel
  responsavelId?: number
  subtarefas?: Tarefa[]
  tarefaPaiId?: number
}

interface ProcessoTarefasProps {
  processoId: number
  onUpdate?: () => void
}

export function ProcessoTarefas({ processoId, onUpdate }: ProcessoTarefasProps) {
  const [tarefas, setTarefas] = useState<Tarefa[]>([])
  const [loading, setLoading] = useState(true)
  const [novaTarefa, setNovaTarefa] = useState("")
  const [criando, setCriando] = useState(false)
  const [expandidas, setExpandidas] = useState<Set<number>>(new Set())
  const [novaSubtarefa, setNovaSubtarefa] = useState<{ [key: number]: string }>({})
  const [mostrarInputSubtarefa, setMostrarInputSubtarefa] = useState<number | null>(null)
  
  // Modal de edição
  const [tarefaEditando, setTarefaEditando] = useState<Tarefa | null>(null)
  const [editForm, setEditForm] = useState({
    titulo: "",
    descricao: "",
    prioridade: "MEDIA",
    dataPrazo: "",
    responsavelId: ""
  })
  const [salvando, setSalvando] = useState(false)
  
  // Lista de usuários para responsável
  const [usuarios, setUsuarios] = useState<Responsavel[]>([])

  // Buscar tarefas do processo
  const fetchTarefas = async () => {
    try {
      const response = await fetch(`/api/tarefas?processoId=${processoId}&apenasRaiz=true`)
      const data = await response.json()
      if (data.tarefas) {
        setTarefas(data.tarefas)
      }
    } catch (error) {
      console.error("Erro ao buscar tarefas:", error)
    } finally {
      setLoading(false)
    }
  }

  // Buscar usuários (com token de autenticação)
  const fetchUsuarios = async () => {
    try {
      const token = localStorage.getItem('authToken')
      const response = await fetch("/api/usuarios", {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      const data = await response.json()
      if (data.usuarios) {
        setUsuarios(data.usuarios)
      }
    } catch (error) {
      console.error("Erro ao buscar usuários:", error)
    }
  }

  useEffect(() => {
    if (processoId) {
      fetchTarefas()
      fetchUsuarios()
    }
  }, [processoId])

  // Criar nova tarefa
  const handleCriarTarefa = async () => {
    if (!novaTarefa.trim()) return

    setCriando(true)
    try {
      const response = await fetch("/api/tarefas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo: novaTarefa.trim(),
          processoId
        })
      })

      if (response.ok) {
        setNovaTarefa("")
        fetchTarefas()
        onUpdate?.()
      }
    } catch (error) {
      console.error("Erro ao criar tarefa:", error)
    } finally {
      setCriando(false)
    }
  }

  // Toggle conclusão
  const handleToggle = async (tarefaId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const response = await fetch(`/api/tarefas/${tarefaId}/toggle`, {
        method: "POST"
      })

      if (response.ok) {
        fetchTarefas()
        onUpdate?.()
      } else {
        const data = await response.json()
        if (data.error) {
          alert(data.error)
        }
      }
    } catch (error) {
      console.error("Erro ao alternar tarefa:", error)
    }
  }

  // Excluir tarefa
  const handleExcluir = async (tarefaId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm("Excluir esta tarefa?")) return

    try {
      const response = await fetch(`/api/tarefas/${tarefaId}`, {
        method: "DELETE"
      })

      if (response.ok) {
        fetchTarefas()
        onUpdate?.()
      }
    } catch (error) {
      console.error("Erro ao excluir tarefa:", error)
    }
  }

  // Criar subtarefa
  const handleCriarSubtarefa = async (tarefaPaiId: number) => {
    const titulo = novaSubtarefa[tarefaPaiId]?.trim()
    if (!titulo) return

    try {
      const response = await fetch(`/api/tarefas/${tarefaPaiId}/subtarefas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo })
      })

      if (response.ok) {
        setNovaSubtarefa({ ...novaSubtarefa, [tarefaPaiId]: "" })
        setMostrarInputSubtarefa(null)
        setExpandidas(new Set([...expandidas, tarefaPaiId]))
        fetchTarefas()
        onUpdate?.()
      }
    } catch (error) {
      console.error("Erro ao criar subtarefa:", error)
    }
  }

  // Abrir modal de edição
  const abrirEdicao = (tarefa: Tarefa) => {
    setTarefaEditando(tarefa)
    setEditForm({
      titulo: tarefa.titulo,
      descricao: tarefa.descricao || "",
      prioridade: tarefa.prioridade,
      dataPrazo: tarefa.dataPrazo ? tarefa.dataPrazo.split("T")[0] : "",
      responsavelId: tarefa.responsavelId?.toString() || ""
    })
  }

  // Salvar edição
  const handleSalvarEdicao = async () => {
    if (!tarefaEditando) return

    setSalvando(true)
    try {
      const response = await fetch(`/api/tarefas/${tarefaEditando.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo: editForm.titulo,
          descricao: editForm.descricao || null,
          prioridade: editForm.prioridade,
          dataPrazo: editForm.dataPrazo || null,
          responsavelId: editForm.responsavelId ? parseInt(editForm.responsavelId) : null
        })
      })

      if (response.ok) {
        setTarefaEditando(null)
        fetchTarefas()
        onUpdate?.()
      } else {
        alert("Erro ao salvar tarefa")
      }
    } catch (error) {
      console.error("Erro ao salvar:", error)
      alert("Erro ao salvar tarefa")
    } finally {
      setSalvando(false)
    }
  }

  // Toggle expandir/colapsar
  const toggleExpand = (tarefaId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    const newExpandidas = new Set(expandidas)
    if (newExpandidas.has(tarefaId)) {
      newExpandidas.delete(tarefaId)
    } else {
      newExpandidas.add(tarefaId)
    }
    setExpandidas(newExpandidas)
  }

  // Calcular progresso das subtarefas
  const calcularProgresso = (subtarefas: Tarefa[] = []) => {
    if (subtarefas.length === 0) return null
    const concluidas = subtarefas.filter(s => s.concluida).length
    return { concluidas, total: subtarefas.length }
  }

  // Cor da prioridade
  const getPrioridadeCor = (prioridade: string) => {
    switch (prioridade) {
      case "URGENTE": return "bg-red-500"
      case "ALTA": return "bg-orange-500"
      case "MEDIA": return "bg-yellow-500"
      case "BAIXA": return "bg-green-500"
      default: return "bg-gray-400"
    }
  }

  const getPrioridadeLabel = (prioridade: string) => {
    switch (prioridade) {
      case "URGENTE": return "Urgente"
      case "ALTA": return "Alta"
      case "MEDIA": return "Média"
      case "BAIXA": return "Baixa"
      default: return prioridade
    }
  }

  // Renderizar tarefa
  const renderTarefa = (tarefa: Tarefa, nivel: number = 0) => {
    const temSubtarefas = tarefa.subtarefas && tarefa.subtarefas.length > 0
    const expandida = expandidas.has(tarefa.id)
    const progresso = calcularProgresso(tarefa.subtarefas)
    const mostrandoInput = mostrarInputSubtarefa === tarefa.id

    return (
      <div key={tarefa.id} className={`${nivel > 0 ? 'ml-6 border-l-2 border-gray-100 pl-3' : ''}`}>
        <div 
          onClick={() => abrirEdicao(tarefa)}
          className={`
            group flex items-start gap-3 p-3 rounded-lg border transition-all cursor-pointer
            ${tarefa.concluida ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-200 hover:border-blue-300 hover:shadow-sm'}
          `}
        >
          {/* Botão de expandir (se tem subtarefas) */}
          {temSubtarefas ? (
            <button
              onClick={(e) => toggleExpand(tarefa.id, e)}
              className="mt-0.5 text-gray-400 hover:text-gray-600"
            >
              {expandida ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          ) : (
            <div className="w-4" />
          )}

          {/* Checkbox */}
          <button
            onClick={(e) => handleToggle(tarefa.id, e)}
            className="mt-0.5 flex-shrink-0"
          >
            {tarefa.concluida ? (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            ) : (
              <Circle className="h-5 w-5 text-gray-300 hover:text-blue-500" />
            )}
          </button>

          {/* Conteúdo */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className={`font-medium ${tarefa.concluida ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                {tarefa.titulo}
              </p>
              <span className={`w-2 h-2 rounded-full ${getPrioridadeCor(tarefa.prioridade)}`} title={getPrioridadeLabel(tarefa.prioridade)} />
            </div>

            {/* Progresso de subtarefas */}
            {progresso && (
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden max-w-[100px]">
                  <div 
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${(progresso.concluidas / progresso.total) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500">
                  {progresso.concluidas}/{progresso.total}
                </span>
              </div>
            )}

            {/* Meta info */}
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
              {tarefa.dataPrazo && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {new Date(tarefa.dataPrazo).toLocaleDateString('pt-BR')}
                </span>
              )}
              {tarefa.responsavel && (
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {tarefa.responsavel.nome}
                </span>
              )}
            </div>
          </div>

          {/* Ações */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {nivel === 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setMostrarInputSubtarefa(mostrandoInput ? null : tarefa.id)
                }}
                className="p-1 text-gray-400 hover:text-blue-500 rounded"
                title="Adicionar subtarefa"
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={(e) => handleExcluir(tarefa.id, e)}
              className="p-1 text-gray-400 hover:text-red-500 rounded"
              title="Excluir"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Input de subtarefa */}
        {mostrandoInput && (
          <div className="ml-10 mt-2 flex gap-2">
            <Input
              placeholder="Nova subtarefa..."
              value={novaSubtarefa[tarefa.id] || ""}
              onChange={(e) => setNovaSubtarefa({ ...novaSubtarefa, [tarefa.id]: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCriarSubtarefa(tarefa.id)
                if (e.key === "Escape") setMostrarInputSubtarefa(null)
              }}
              className="flex-1 h-8 text-sm"
              autoFocus
            />
            <Button
              size="sm"
              onClick={() => handleCriarSubtarefa(tarefa.id)}
              className="h-8"
            >
              Adicionar
            </Button>
          </div>
        )}

        {/* Subtarefas */}
        {temSubtarefas && expandida && (
          <div className="mt-2 space-y-2">
            {tarefa.subtarefas!.map(sub => renderTarefa(sub, nivel + 1))}
          </div>
        )}
      </div>
    )
  }

  const tarefasPendentes = tarefas.filter(t => !t.concluida)
  const tarefasConcluidas = tarefas.filter(t => t.concluida)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-white px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-blue-600" />
          <h3 className="font-semibold text-gray-900">Tarefas</h3>
          {tarefas.length > 0 && (
            <span className="px-2 py-0.5 bg-blue-100 text-blue-600 text-xs font-medium rounded-full">
              {tarefasPendentes.length} pendente{tarefasPendentes.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Input nova tarefa */}
      <div className="p-4 border-b flex-shrink-0">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Adicionar nova tarefa..."
            value={novaTarefa}
            onChange={(e) => setNovaTarefa(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !criando) handleCriarTarefa()
            }}
            disabled={criando}
            className="flex-1"
          />
          <Button
            onClick={handleCriarTarefa}
            disabled={criando || !novaTarefa.trim()}
            size="sm"
          >
            {criando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Lista de tarefas */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : tarefas.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-2 text-gray-300" />
            <p className="font-medium">Nenhuma tarefa ainda</p>
            <p className="text-sm">Adicione tarefas para acompanhar o progresso</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Tarefas pendentes */}
            {tarefasPendentes.map(tarefa => renderTarefa(tarefa))}

            {/* Separador */}
            {tarefasConcluidas.length > 0 && tarefasPendentes.length > 0 && (
              <div className="flex items-center gap-2 py-2">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400">Concluídas ({tarefasConcluidas.length})</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
            )}

            {/* Tarefas concluídas */}
            {tarefasConcluidas.map(tarefa => renderTarefa(tarefa))}
          </div>
        )}
      </div>

      {/* Modal de Edição */}
      {tarefaEditando && (
        <div className="fixed inset-0 bg-black/50 z-[10000] flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            {/* Header do modal */}
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-semibold text-gray-900">Editar Tarefa</h3>
              <button
                onClick={() => setTarefaEditando(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Form */}
            <div className="p-4 space-y-4">
              {/* Título */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Título
                </label>
                <Input
                  value={editForm.titulo}
                  onChange={(e) => setEditForm({ ...editForm, titulo: e.target.value })}
                  placeholder="Título da tarefa"
                />
              </div>

              {/* Descrição */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Descrição
                </label>
                <textarea
                  value={editForm.descricao}
                  onChange={(e) => setEditForm({ ...editForm, descricao: e.target.value })}
                  placeholder="Descrição opcional"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={3}
                />
              </div>

              {/* Prioridade */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Flag className="h-4 w-4 inline mr-1" />
                  Prioridade
                </label>
                <select
                  value={editForm.prioridade}
                  onChange={(e) => setEditForm({ ...editForm, prioridade: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="BAIXA">🟢 Baixa</option>
                  <option value="MEDIA">🟡 Média</option>
                  <option value="ALTA">🟠 Alta</option>
                  <option value="URGENTE">🔴 Urgente</option>
                </select>
              </div>

              {/* Data Prazo */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Calendar className="h-4 w-4 inline mr-1" />
                  Prazo
                </label>
                <Input
                  type="date"
                  value={editForm.dataPrazo}
                  onChange={(e) => setEditForm({ ...editForm, dataPrazo: e.target.value })}
                />
              </div>

              {/* Responsável */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <User className="h-4 w-4 inline mr-1" />
                  Responsável
                </label>
                <select
                  value={editForm.responsavelId}
                  onChange={(e) => setEditForm({ ...editForm, responsavelId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Sem responsável</option>
                  {usuarios.map((u) => (
                    <option key={u.id} value={u.id}>{u.nome}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-4 py-3 border-t bg-gray-50 rounded-b-lg">
              <button
                type="button"
                onClick={() => setTarefaEditando(null)}
                disabled={salvando}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSalvarEdicao}
                disabled={salvando || !editForm.titulo.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
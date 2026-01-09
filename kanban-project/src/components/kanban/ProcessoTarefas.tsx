"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import {
  Plus,
  Calendar,
  CheckCircle2,
  Circle,
  Trash2,
  Loader2,
  User,
  Flag,
  X,
  ChevronRight,
  GripVertical
} from "lucide-react"

// ==========================================
// TIPOS
// ==========================================
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

// ==========================================
// COMPONENTE: Círculo de Progresso
// ==========================================
interface CirculoProgressoProps {
  porcentagem: number
  tamanho?: number
  corFundo?: string
  corProgresso?: string
}

function CirculoProgresso({ 
  porcentagem, 
  tamanho = 48, 
  corFundo = "#e5e7eb",
  corProgresso = "#2563eb"
}: CirculoProgressoProps) {
  const raio = (tamanho - 6) / 2
  const circunferencia = 2 * Math.PI * raio
  const offset = circunferencia - (porcentagem / 100) * circunferencia
  
  // Se 100%, mostra círculo verde com check
  if (porcentagem >= 100) {
    return (
      <div 
        className="flex items-center justify-center rounded-full bg-green-500"
        style={{ width: tamanho, height: tamanho }}
      >
        <svg 
          className="text-white" 
          width={tamanho * 0.5} 
          height={tamanho * 0.5} 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth={3}
          strokeLinecap="round" 
          strokeLinejoin="round"
        >
          <path d="M5 13l4 4L19 7" />
        </svg>
      </div>
    )
  }

  return (
    <div className="relative flex items-center justify-center" style={{ width: tamanho, height: tamanho }}>
      <svg width={tamanho} height={tamanho} className="transform -rotate-90">
        {/* Círculo de fundo */}
        <circle
          cx={tamanho / 2}
          cy={tamanho / 2}
          r={raio}
          fill="none"
          stroke={corFundo}
          strokeWidth={4}
        />
        {/* Círculo de progresso */}
        <circle
          cx={tamanho / 2}
          cy={tamanho / 2}
          r={raio}
          fill="none"
          stroke={corProgresso}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={circunferencia}
          strokeDashoffset={offset}
          className="transition-all duration-500 ease-out"
        />
      </svg>
      {/* Porcentagem no centro */}
      <span className="absolute text-xs font-semibold text-gray-700">
        {Math.round(porcentagem)}%
      </span>
    </div>
  )
}

// ==========================================
// COMPONENTE: Card da Tarefa Principal
// ==========================================
interface TarefaCardProps {
  tarefa: Tarefa
  onClick: () => void
  onDelete: (e: React.MouseEvent) => void
}

function TarefaCard({ tarefa, onClick, onDelete }: TarefaCardProps) {
  const subtarefas = tarefa.subtarefas || []
  const temSubtarefas = subtarefas.length > 0
  const concluidas = subtarefas.filter(s => s.concluida).length
  const porcentagem = temSubtarefas ? (concluidas / subtarefas.length) * 100 : (tarefa.concluida ? 100 : 0)

  const getPrioridadeCor = (prioridade: string) => {
    switch (prioridade) {
      case "URGENTE": return "bg-red-500"
      case "ALTA": return "bg-orange-500"
      case "MEDIA": return "bg-yellow-500"
      case "BAIXA": return "bg-green-500"
      default: return "bg-gray-400"
    }
  }

  return (
    <div
      onClick={onClick}
      className={`
        group relative flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer
        transition-all duration-200 ease-out
        ${tarefa.concluida 
          ? 'bg-gray-50 border-gray-200 opacity-75' 
          : 'bg-white border-gray-200 hover:border-blue-400 hover:shadow-lg hover:shadow-blue-100'
        }
      `}
    >
      {/* Círculo de progresso - apenas visual */}
      <div className="flex-shrink-0">
        {temSubtarefas ? (
          <CirculoProgresso 
            porcentagem={porcentagem}
          />
        ) : (
          <div className="w-12 h-12 rounded-full border-2 border-gray-300 flex items-center justify-center">
            {tarefa.concluida ? (
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            ) : (
              <Circle className="w-8 h-8 text-gray-300" />
            )}
          </div>
        )}
      </div>

      {/* Conteúdo */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h4 className={`font-semibold text-base ${tarefa.concluida ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
            {tarefa.titulo}
          </h4>
          <span 
            className={`w-2.5 h-2.5 rounded-full ${getPrioridadeCor(tarefa.prioridade)}`} 
            title={tarefa.prioridade}
          />
        </div>

        {/* Info adicional */}
        <div className="flex items-center gap-4 text-sm text-gray-500">
          {temSubtarefas && (
            <span className="font-medium">
              {concluidas} de {subtarefas.length} {subtarefas.length === 1 ? 'subtarefa' : 'subtarefas'}
            </span>
          )}
          {tarefa.dataPrazo && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {new Date(tarefa.dataPrazo).toLocaleDateString('pt-BR')}
            </span>
          )}
          {tarefa.responsavel && (
            <span className="flex items-center gap-1">
              <User className="w-3.5 h-3.5" />
              {tarefa.responsavel.nome}
            </span>
          )}
        </div>
      </div>

      {/* Seta e ações */}
      <div className="flex items-center gap-2">
        <button
          onClick={onDelete}
          className="p-2 text-gray-400 hover:text-red-500 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
          title="Excluir"
        >
          <Trash2 className="w-4 h-4" />
        </button>
        <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-blue-500 transition-colors" />
      </div>
    </div>
  )
}

// ==========================================
// COMPONENTE: Modal de Subtarefas
// ==========================================
interface SubtarefasModalProps {
  tarefa: Tarefa
  onClose: () => void
  onUpdate: () => void
  onSubtarefaToggle?: (subtarefaId: number, concluida: boolean) => void
  onSubtarefaAdd?: (subtarefa: Tarefa) => void
  onSubtarefaRemove?: (subtarefaId: number) => void
  usuarios: Responsavel[]
}

function SubtarefasModal({ tarefa, onClose, onUpdate, onSubtarefaToggle, onSubtarefaAdd, onSubtarefaRemove, usuarios }: SubtarefasModalProps) {
  const [novaSubtarefa, setNovaSubtarefa] = useState("")
  const [criando, setCriando] = useState(false)
  const [editandoTarefa, setEditandoTarefa] = useState(false)
  const [editForm, setEditForm] = useState({
    titulo: tarefa.titulo,
    descricao: tarefa.descricao || "",
    prioridade: tarefa.prioridade,
    dataPrazo: tarefa.dataPrazo ? tarefa.dataPrazo.split("T")[0] : "",
    responsavelId: tarefa.responsavelId?.toString() || ""
  })
  const [salvando, setSalvando] = useState(false)
  
  // Estado local para optimistic updates
  const [subtarefasLocal, setSubtarefasLocal] = useState<Tarefa[]>(tarefa.subtarefas || [])
  
  // Set para rastrear subtarefas em processamento (evita cliques duplos)
  const [processando, setProcessando] = useState<Set<number>>(new Set())
  
  // Atualizar estado local quando tarefa mudar (mas não durante processamento)
  useEffect(() => {
    if (processando.size === 0) {
      setSubtarefasLocal(tarefa.subtarefas || [])
    }
  }, [tarefa.subtarefas])

  const concluidas = subtarefasLocal.filter(s => s.concluida).length
  const porcentagem = subtarefasLocal.length > 0 ? (concluidas / subtarefasLocal.length) * 100 : 0

  // Criar subtarefa com optimistic update
  const handleCriarSubtarefa = async () => {
    if (!novaSubtarefa.trim()) return

    const tituloNovo = novaSubtarefa.trim()
    const tempId = Date.now() // ID temporário
    
    // Optimistic update - adiciona imediatamente
    const novaSubtarefaTemp: Tarefa = {
      id: tempId,
      titulo: tituloNovo,
      concluida: false,
      prioridade: "MEDIA",
      tarefaPaiId: tarefa.id
    }
    
    setSubtarefasLocal(prev => [...prev, novaSubtarefaTemp])
    onSubtarefaAdd?.(novaSubtarefaTemp)
    setNovaSubtarefa("")

    setCriando(true)
    try {
      const response = await fetch(`/api/tarefas/${tarefa.id}/subtarefas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo: tituloNovo })
      })

      if (!response.ok) {
        // Reverte se falhou
        setSubtarefasLocal(prev => prev.filter(s => s.id !== tempId))
        onSubtarefaRemove?.(tempId)
        setNovaSubtarefa(tituloNovo)
      }
    } catch (error) {
      // Reverte se erro
      setSubtarefasLocal(prev => prev.filter(s => s.id !== tempId))
      onSubtarefaRemove?.(tempId)
      setNovaSubtarefa(tituloNovo)
      console.error("Erro ao criar subtarefa:", error)
    } finally {
      setCriando(false)
    }
  }

  // Toggle subtarefa com optimistic update (protegido contra cliques rápidos)
  const handleToggleSubtarefa = async (subtarefaId: number) => {
    // Se já está processando esta subtarefa, ignora
    if (processando.has(subtarefaId)) return
    
    // Marca como processando
    setProcessando(prev => new Set(prev).add(subtarefaId))
    
    // Encontra o estado atual da subtarefa
    const subtarefa = subtarefasLocal.find(s => s.id === subtarefaId)
    const novoEstado = !subtarefa?.concluida
    
    // Optimistic update - atualiza UI imediatamente
    setSubtarefasLocal(prev => 
      prev.map(s => 
        s.id === subtarefaId 
          ? { ...s, concluida: novoEstado }
          : s
      )
    )
    
    // Atualiza lista principal também (optimistic)
    onSubtarefaToggle?.(subtarefaId, novoEstado)

    try {
      const response = await fetch(`/api/tarefas/${subtarefaId}/toggle`, {
        method: "POST"
      })

      if (!response.ok) {
        // Reverte se falhou
        setSubtarefasLocal(prev => 
          prev.map(s => 
            s.id === subtarefaId 
              ? { ...s, concluida: !novoEstado }
              : s
          )
        )
        onSubtarefaToggle?.(subtarefaId, !novoEstado)
        const data = await response.json()
        if (data.error) alert(data.error)
      }
    } catch (error) {
      // Reverte se erro
      setSubtarefasLocal(prev => 
        prev.map(s => 
          s.id === subtarefaId 
            ? { ...s, concluida: !novoEstado }
            : s
        )
      )
      onSubtarefaToggle?.(subtarefaId, !novoEstado)
      console.error("Erro ao alternar subtarefa:", error)
    } finally {
      // Remove do set de processamento
      setProcessando(prev => {
        const novo = new Set(prev)
        novo.delete(subtarefaId)
        return novo
      })
    }
  }

  // Excluir subtarefa com optimistic update
  const handleExcluirSubtarefa = async (subtarefaId: number) => {
    if (!confirm("Excluir esta subtarefa?")) return

    // Guarda estado anterior para reverter se necessário
    const subtarefaRemovida = subtarefasLocal.find(s => s.id === subtarefaId)
    
    // Optimistic update - remove imediatamente
    setSubtarefasLocal(prev => prev.filter(s => s.id !== subtarefaId))
    onSubtarefaRemove?.(subtarefaId)

    try {
      const response = await fetch(`/api/tarefas/${subtarefaId}`, {
        method: "DELETE"
      })

      if (!response.ok) {
        // Reverte se falhou
        if (subtarefaRemovida) {
          setSubtarefasLocal(prev => [...prev, subtarefaRemovida])
          onSubtarefaAdd?.(subtarefaRemovida)
        }
      }
    } catch (error) {
      // Reverte se erro
      if (subtarefaRemovida) {
        setSubtarefasLocal(prev => [...prev, subtarefaRemovida])
        onSubtarefaAdd?.(subtarefaRemovida)
      }
      console.error("Erro ao excluir subtarefa:", error)
    }
  }

  // Salvar edição da tarefa principal
  const handleSalvarEdicao = async () => {
    setSalvando(true)
    try {
      const response = await fetch(`/api/tarefas/${tarefa.id}`, {
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
        setEditandoTarefa(false)
        onUpdate()
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

  const getPrioridadeLabel = (prioridade: string) => {
    switch (prioridade) {
      case "URGENTE": return "🔴 Urgente"
      case "ALTA": return "🟠 Alta"
      case "MEDIA": return "🟡 Média"
      case "BAIXA": return "🟢 Baixa"
      default: return prioridade
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[10000] flex items-center justify-center p-4">
      <div 
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header com progresso */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-5 text-white">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0 pr-4">
              {editandoTarefa ? (
                <input
                  type="text"
                  value={editForm.titulo}
                  onChange={(e) => setEditForm({ ...editForm, titulo: e.target.value })}
                  className="w-full bg-white/20 backdrop-blur border border-white/30 rounded-lg px-3 py-2 text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-white/50"
                  placeholder="Título da tarefa"
                />
              ) : (
                <h2 className="text-xl font-bold truncate">{tarefa.titulo}</h2>
              )}
              <p className="text-blue-100 text-sm mt-1">
                {subtarefasLocal.length > 0 
                  ? `${concluidas} de ${subtarefasLocal.length} subtarefas concluídas`
                  : "Nenhuma subtarefa ainda"
                }
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/20 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Barra de progresso */}
          {subtarefasLocal.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-blue-100">Progresso</span>
                <span className="font-semibold">{Math.round(porcentagem)}%</span>
              </div>
              <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-white rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${porcentagem}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Tabs: Atividades / Detalhes */}
        <div className="flex border-b">
          <button
            onClick={() => setEditandoTarefa(false)}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              !editandoTarefa 
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50' 
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Atividades
          </button>
          <button
            onClick={() => setEditandoTarefa(true)}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              editandoTarefa 
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50' 
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Detalhes
          </button>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto">
          {editandoTarefa ? (
            /* Form de edição */
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
                <textarea
                  value={editForm.descricao}
                  onChange={(e) => setEditForm({ ...editForm, descricao: e.target.value })}
                  placeholder="Descrição opcional"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <Flag className="w-4 h-4 inline mr-1" />
                    Prioridade
                  </label>
                  <select
                    value={editForm.prioridade}
                    onChange={(e) => setEditForm({ ...editForm, prioridade: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="BAIXA">🟢 Baixa</option>
                    <option value="MEDIA">🟡 Média</option>
                    <option value="ALTA">🟠 Alta</option>
                    <option value="URGENTE">🔴 Urgente</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <Calendar className="w-4 h-4 inline mr-1" />
                    Prazo
                  </label>
                  <DatePickerField
                    value={editForm.dataPrazo}
                    onChange={(value) => setEditForm({ ...editForm, dataPrazo: value })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <User className="w-4 h-4 inline mr-1" />
                  Responsável
                </label>
                <select
                  value={editForm.responsavelId}
                  onChange={(e) => setEditForm({ ...editForm, responsavelId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Sem responsável</option>
                  {usuarios.map((u) => (
                    <option key={u.id} value={u.id}>{u.nome}</option>
                  ))}
                </select>
              </div>

              <div className="pt-4 flex justify-end gap-3">
                <button
                  onClick={() => setEditandoTarefa(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSalvarEdicao}
                  disabled={salvando || !editForm.titulo.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  {salvando && <Loader2 className="w-4 h-4 animate-spin" />}
                  Salvar
                </button>
              </div>
            </div>
          ) : (
            /* Lista de subtarefas */
            <div className="p-4">
              {/* Aviso sobre ordem */}
              <div className="flex items-center gap-2 px-3 py-2 mb-4 bg-gray-50 rounded-lg text-xs text-gray-500">
                <span>ℹ️</span>
                <span>A ordem das atividades pode mudar conforme são executadas</span>
              </div>

              {/* Lista */}
              <div className="space-y-2">
                {subtarefasLocal.map((subtarefa) => (
                  <div
                    key={subtarefa.id}
                    className={`
                      group flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all
                      ${subtarefa.concluida 
                        ? 'bg-gray-50 border-gray-200' 
                        : 'bg-white border-gray-200 hover:border-blue-300'
                      }
                      ${processando.has(subtarefa.id) ? 'opacity-70' : ''}
                    `}
                  >
                    {/* Checkbox circular - apenas visual */}
                    <div
                      className={`
                        w-7 h-7 rounded-full border-2 flex-shrink-0 flex items-center justify-center
                        ${subtarefa.concluida 
                          ? 'bg-blue-600 border-blue-600' 
                          : 'border-gray-300'
                        }
                      `}
                    >
                      {subtarefa.concluida && (
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>

                    {/* Título */}
                    <span className={`flex-1 text-sm ${subtarefa.concluida ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                      {subtarefa.titulo}
                    </span>

                    {/* Botão excluir */}
                    <button
                      onClick={() => handleExcluirSubtarefa(subtarefa.id)}
                      className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>

                    {/* Seta - clicável para toggle */}
                    <button
                      onClick={() => handleToggleSubtarefa(subtarefa.id)}
                      disabled={processando.has(subtarefa.id)}
                      className={`
                        p-1.5 rounded-lg transition-all
                        ${processando.has(subtarefa.id) 
                          ? 'cursor-wait text-gray-300' 
                          : 'text-gray-400 hover:text-blue-500 hover:bg-blue-50'
                        }
                      `}
                      title={subtarefa.concluida ? "Reabrir" : "Concluir"}
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                ))}

                {subtarefasLocal.length === 0 && (
                  <div className="text-center py-8 text-gray-400">
                    <CheckCircle2 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Nenhuma subtarefa ainda</p>
                    <p className="text-xs mt-1">Adicione subtarefas abaixo</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer - Input de nova subtarefa */}
        {!editandoTarefa && (
          <div className="border-t p-4 bg-gray-50">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Adicionar nova subtarefa..."
                value={novaSubtarefa}
                onChange={(e) => setNovaSubtarefa(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !criando) handleCriarSubtarefa()
                }}
                disabled={criando}
                className="flex-1 bg-white"
              />
              <Button
                onClick={handleCriarSubtarefa}
                disabled={criando || !novaSubtarefa.trim()}
                size="sm"
                className="bg-blue-600 hover:bg-blue-700"
              >
                {criando ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ==========================================
// COMPONENTE PRINCIPAL: ProcessoTarefas
// ==========================================
export function ProcessoTarefas({ processoId, onUpdate }: ProcessoTarefasProps) {
  const [tarefas, setTarefas] = useState<Tarefa[]>([])
  const [loading, setLoading] = useState(true)
  const [novaTarefa, setNovaTarefa] = useState("")
  const [criando, setCriando] = useState(false)
  const [tarefaSelecionada, setTarefaSelecionada] = useState<Tarefa | null>(null)
  const [usuarios, setUsuarios] = useState<Responsavel[]>([])
  
  // Ref para rastrear o ID do modal aberto (evita bugs de re-abertura)
  const modalAbertoIdRef = useRef<number | null>(null)
  
  // Abrir modal
  const abrirModal = (tarefa: Tarefa) => {
    modalAbertoIdRef.current = tarefa.id
    setTarefaSelecionada(tarefa)
  }
  
  // Fechar modal e sincronizar com servidor
  const fecharModal = () => {
    modalAbertoIdRef.current = null
    setTarefaSelecionada(null)
    // Sincroniza com servidor ao fechar
    fetchTarefas(false)
    onUpdate?.()
  }

  // Buscar tarefas do processo
  const fetchTarefas = async (atualizarModal = true) => {
    try {
      const response = await fetch(`/api/tarefas?processoId=${processoId}&apenasRaiz=true`)
      const data = await response.json()
      if (data.tarefas) {
        setTarefas(data.tarefas)
        
        // Só atualiza o modal se ele ainda estiver aberto com o mesmo ID
        if (atualizarModal && modalAbertoIdRef.current !== null) {
          const atualizada = data.tarefas.find((t: Tarefa) => t.id === modalAbertoIdRef.current)
          if (atualizada) {
            setTarefaSelecionada(atualizada)
          }
        }
      }
    } catch (error) {
      console.error("Erro ao buscar tarefas:", error)
    } finally {
      setLoading(false)
    }
  }

  // Buscar usuários
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

  // Excluir tarefa
  const handleExcluir = async (tarefaId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm("Excluir esta tarefa e todas as subtarefas?")) return

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

  const handleUpdateFromModal = () => {
    fetchTarefas()
    onUpdate?.()
  }

  const tarefasPendentes = tarefas.filter(t => !t.concluida)
  const tarefasConcluidas = tarefas.filter(t => t.concluida)

  return (
    <div className="flex flex-col h-full min-h-0">
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
            className="bg-blue-600 hover:bg-blue-700"
          >
            {criando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Lista de tarefas - com scroll */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
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
            {tarefasPendentes.map(tarefa => (
              <TarefaCard
                key={tarefa.id}
                tarefa={tarefa}
                onClick={() => abrirModal(tarefa)}
                onDelete={(e) => handleExcluir(tarefa.id, e)}
              />
            ))}

            {/* Separador */}
            {tarefasConcluidas.length > 0 && tarefasPendentes.length > 0 && (
              <div className="flex items-center gap-2 py-2">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400">Concluídas ({tarefasConcluidas.length})</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
            )}

            {/* Tarefas concluídas */}
            {tarefasConcluidas.map(tarefa => (
              <TarefaCard
                key={tarefa.id}
                tarefa={tarefa}
                onClick={() => abrirModal(tarefa)}
                onDelete={(e) => handleExcluir(tarefa.id, e)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modal de Subtarefas */}
      {tarefaSelecionada && (
        <SubtarefasModal
          tarefa={tarefaSelecionada}
          onClose={fecharModal}
          onUpdate={handleUpdateFromModal}
          onSubtarefaToggle={(subtarefaId, concluida) => {
            // Optimistic update na lista principal
            setTarefas(prev => prev.map(t => {
              if (t.id === tarefaSelecionada.id && t.subtarefas) {
                return {
                  ...t,
                  subtarefas: t.subtarefas.map(s => 
                    s.id === subtarefaId ? { ...s, concluida } : s
                  )
                }
              }
              return t
            }))
          }}
          onSubtarefaAdd={(subtarefa) => {
            // Optimistic update - adiciona subtarefa na lista principal
            setTarefas(prev => prev.map(t => {
              if (t.id === tarefaSelecionada.id) {
                return {
                  ...t,
                  subtarefas: [...(t.subtarefas || []), subtarefa]
                }
              }
              return t
            }))
          }}
          onSubtarefaRemove={(subtarefaId) => {
            // Optimistic update - remove subtarefa da lista principal
            setTarefas(prev => prev.map(t => {
              if (t.id === tarefaSelecionada.id && t.subtarefas) {
                return {
                  ...t,
                  subtarefas: t.subtarefas.filter(s => s.id !== subtarefaId)
                }
              }
              return t
            }))
          }}
          usuarios={usuarios}
        />
      )}
    </div>
  )
}
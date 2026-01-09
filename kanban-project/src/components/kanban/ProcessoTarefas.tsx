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
  ChevronDown,
  GripVertical,
  ListTodo
} from "lucide-react"
import { getTarefasPorPais, type TarefaPreDefinida } from "../../lib/tarefas-config"

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
  pais: string // Nova prop para filtrar tarefas por país
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
  tamanho = 44, 
  corFundo = "#e5e7eb",
  corProgresso = "#3b82f6"
}: CirculoProgressoProps) {
  const raio = (tamanho - 6) / 2
  const circunferencia = 2 * Math.PI * raio
  const offset = circunferencia - (porcentagem / 100) * circunferencia
  
  // Se 100%, mostra círculo verde com check
  if (porcentagem >= 100) {
    return (
      <div 
        className="flex items-center justify-center rounded-full bg-emerald-500 shadow-sm shadow-emerald-200"
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
      <span className="absolute text-[11px] font-bold text-gray-600">
        {Math.round(porcentagem)}%
      </span>
    </div>
  )
}

// ==========================================
// COMPONENTE: Badge de Prioridade
// ==========================================
function BadgePrioridade({ prioridade }: { prioridade: string }) {
  const config = {
    URGENTE: { bg: "bg-red-50", text: "text-red-600", border: "border-red-200", label: "Urgente" },
    ALTA: { bg: "bg-orange-50", text: "text-orange-600", border: "border-orange-200", label: "Alta" },
    MEDIA: { bg: "bg-amber-50", text: "text-amber-600", border: "border-amber-200", label: "Média" },
    BAIXA: { bg: "bg-emerald-50", text: "text-emerald-600", border: "border-emerald-200", label: "Baixa" },
  }[prioridade] || { bg: "bg-gray-50", text: "text-gray-600", border: "border-gray-200", label: prioridade }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${config.bg} ${config.text} ${config.border}`}>
      {config.label}
    </span>
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

  // Verificar se está atrasada
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const prazo = tarefa.dataPrazo ? new Date(tarefa.dataPrazo) : null
  const atrasada = prazo && prazo < hoje && !tarefa.concluida

  return (
    <div
      onClick={onClick}
      className={`
        group relative flex items-center gap-4 p-4 rounded-xl cursor-pointer
        transition-all duration-200 ease-out border
        ${tarefa.concluida 
          ? 'bg-gray-50/80 border-gray-200/60 opacity-70' 
          : atrasada
            ? 'bg-white border-red-200 hover:border-red-300 hover:shadow-md hover:shadow-red-100/50'
            : 'bg-white border-gray-200 hover:border-blue-300 hover:shadow-md hover:shadow-blue-100/50'
        }
      `}
    >
      {/* Indicador lateral de prioridade */}
      {!tarefa.concluida && (
        <div className={`absolute left-0 top-3 bottom-3 w-1 rounded-r-full transition-all
          ${tarefa.prioridade === 'URGENTE' ? 'bg-red-500' : ''}
          ${tarefa.prioridade === 'ALTA' ? 'bg-orange-500' : ''}
          ${tarefa.prioridade === 'MEDIA' ? 'bg-amber-400' : ''}
          ${tarefa.prioridade === 'BAIXA' ? 'bg-emerald-400' : ''}
        `} />
      )}

      {/* Círculo de progresso */}
      <div className="flex-shrink-0 ml-1">
        {temSubtarefas ? (
          <CirculoProgresso porcentagem={porcentagem} />
        ) : (
          <div className={`
            w-11 h-11 rounded-full border-2 flex items-center justify-center transition-all
            ${tarefa.concluida 
              ? 'bg-emerald-500 border-emerald-500' 
              : 'border-gray-300 group-hover:border-blue-400'
            }
          `}>
            {tarefa.concluida ? (
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <Circle className="w-5 h-5 text-gray-300 group-hover:text-blue-400 transition-colors" />
            )}
          </div>
        )}
      </div>

      {/* Conteúdo */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <h4 className={`font-semibold text-[15px] leading-tight ${tarefa.concluida ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
            {tarefa.titulo}
          </h4>
        </div>

        {/* Info adicional */}
        <div className="flex items-center flex-wrap gap-2 text-xs">
          {!tarefa.concluida && <BadgePrioridade prioridade={tarefa.prioridade} />}
          
          {temSubtarefas && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 font-medium border border-blue-100">
              <ListTodo className="w-3 h-3" />
              {concluidas}/{subtarefas.length}
            </span>
          )}
          
          {tarefa.dataPrazo && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium border
              ${atrasada 
                ? 'bg-red-50 text-red-600 border-red-200' 
                : 'bg-gray-50 text-gray-600 border-gray-200'
              }
            `}>
              <Calendar className="w-3 h-3" />
              {new Date(tarefa.dataPrazo).toLocaleDateString('pt-BR')}
            </span>
          )}
          
          {tarefa.responsavel && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-50 text-gray-600 font-medium border border-gray-200">
              <User className="w-3 h-3" />
              {tarefa.responsavel.nome.split(' ')[0]}
            </span>
          )}
        </div>
      </div>

      {/* Ações */}
      <div className="flex items-center gap-1">
        <button
          onClick={onDelete}
          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
          title="Excluir"
        >
          <Trash2 className="w-4 h-4" />
        </button>
        <div className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 group-hover:text-blue-500 group-hover:bg-blue-50 transition-all">
          <ChevronRight className="w-5 h-5" />
        </div>
      </div>
    </div>
  )
}

// ==========================================
// COMPONENTE: SubtarefaItem (recursivo e expansível)
// ==========================================
interface SubtarefaItemProps {
  subtarefa: Tarefa
  nivel: number
  onToggle: (id: number) => void
  onDelete: (id: number) => void
  onUpdate: () => void
  processando: Set<number>
  usuarios: Responsavel[]
}

function SubtarefaItem({ subtarefa, nivel, onToggle, onDelete, onUpdate, processando, usuarios }: SubtarefaItemProps) {
  const [expandido, setExpandido] = useState(false)
  const [editando, setEditando] = useState(false)
  const [novaSubSub, setNovaSubSub] = useState("")
  const [criandoSubSub, setCriandoSubSub] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [subSubtarefas, setSubSubtarefas] = useState<Tarefa[]>(subtarefa.subtarefas || [])
  const [editForm, setEditForm] = useState({
    titulo: subtarefa.titulo,
    descricao: subtarefa.descricao || "",
    prioridade: subtarefa.prioridade,
    dataPrazo: subtarefa.dataPrazo ? subtarefa.dataPrazo.split("T")[0] : "",
    responsavelId: subtarefa.responsavelId?.toString() || ""
  })

  // ✅ Verificar se é uma subtarefa temporária (ID negativo)
  const isTemporaria = subtarefa.id < 0

  // Buscar sub-subtarefas quando expandir
  const fetchSubSubtarefas = async () => {
    // Não busca se for temporária
    if (isTemporaria) return
    
    try {
      const response = await fetch(`/api/tarefas/${subtarefa.id}`)
      const data = await response.json()
      if (data.tarefa?.subtarefas) {
        setSubSubtarefas(data.tarefa.subtarefas)
      }
    } catch (error) {
      console.error("Erro ao buscar sub-subtarefas:", error)
    }
  }

  // Criar sub-subtarefa
  const handleCriarSubSub = async () => {
    if (!novaSubSub.trim() || isTemporaria) return
    setCriandoSubSub(true)
    try {
      const response = await fetch(`/api/tarefas/${subtarefa.id}/subtarefas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo: novaSubSub.trim() })
      })
      if (response.ok) {
        setNovaSubSub("")
        fetchSubSubtarefas()
        onUpdate()
      }
    } catch (error) {
      console.error("Erro ao criar sub-subtarefa:", error)
    } finally {
      setCriandoSubSub(false)
    }
  }

  // Salvar edição
  const handleSalvar = async () => {
    if (isTemporaria) return
    setSalvando(true)
    try {
      const response = await fetch(`/api/tarefas/${subtarefa.id}`, {
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
        setEditando(false)
        onUpdate()
      }
    } catch (error) {
      console.error("Erro ao salvar:", error)
    } finally {
      setSalvando(false)
    }
  }

  // Toggle sub-subtarefa
  const handleToggleSubSub = async (id: number) => {
    // ✅ Não permite toggle em IDs temporários (negativos)
    if (id < 0) return
    
    try {
      const response = await fetch(`/api/tarefas/${id}/toggle`, { method: "POST" })
      if (response.ok) {
        fetchSubSubtarefas()
        onUpdate()
      }
    } catch (error) {
      console.error("Erro ao alternar sub-subtarefa:", error)
    }
  }

  // Excluir sub-subtarefa
  const handleDeleteSubSub = async (id: number) => {
    if (id < 0) return // Não exclui temporárias
    if (!confirm("Excluir esta subtarefa?")) return
    try {
      const response = await fetch(`/api/tarefas/${id}`, { method: "DELETE" })
      if (response.ok) {
        setSubSubtarefas(prev => prev.filter(s => s.id !== id))
        onUpdate()
      }
    } catch (error) {
      console.error("Erro ao excluir sub-subtarefa:", error)
    }
  }

  const handleExpandir = () => {
    if (!expandido && !isTemporaria) {
      fetchSubSubtarefas()
    }
    setExpandido(!expandido)
  }

  const concluidasSubSub = subSubtarefas.filter(s => s.concluida).length
  const temSubSubtarefas = subSubtarefas.length > 0

  return (
    <div className={`${nivel > 0 ? 'ml-6 border-l-2 border-gray-100 pl-3' : ''}`}>
      {/* Item principal */}
      <div
        className={`
          group flex items-center gap-3 px-4 py-3 rounded-xl border transition-all
          ${subtarefa.concluida 
            ? 'bg-gray-50 border-gray-200' 
            : 'bg-white border-gray-200 hover:border-blue-300'
          }
          ${processando.has(subtarefa.id) || isTemporaria ? 'opacity-70' : ''}
          ${expandido ? 'border-blue-400 shadow-sm' : ''}
        `}
      >
        {/* Checkbox circular - apenas visual (não clicável) */}
        <div
          className={`
            w-7 h-7 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all
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

        {/* Título e info */}
        <div className="flex-1 min-w-0">
          <span className={`text-sm ${subtarefa.concluida ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
            {subtarefa.titulo}
          </span>
          {isTemporaria && (
            <span className="ml-2 text-xs text-gray-400 italic">
              (salvando...)
            </span>
          )}
          {temSubSubtarefas && !isTemporaria && (
            <span className="ml-2 text-xs text-gray-400">
              ({concluidasSubSub}/{subSubtarefas.length})
            </span>
          )}
        </div>

        {/* Botão excluir */}
        {!isTemporaria && (
          <button
            onClick={() => {
              if (confirm("Excluir esta subtarefa?")) {
                onDelete(subtarefa.id)
              }
            }}
            className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}

        {/* Seta - expande/colapsa */}
        {!isTemporaria && (
          <button
            onClick={handleExpandir}
            className={`
              p-1.5 rounded-lg transition-all
              text-gray-400 hover:text-blue-500 hover:bg-blue-50
            `}
          >
            <ChevronDown className={`w-5 h-5 transition-transform ${expandido ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {/* Área expandida */}
      {expandido && !isTemporaria && (
        <div className="mt-2 ml-4 animate-in slide-in-from-top-2 duration-200">
          {/* Caixa de detalhes + subtarefas */}
          <div className="bg-gray-50 rounded-lg p-3 space-y-4">
            {editando ? (
              <>
                <Input
                  value={editForm.titulo}
                  onChange={(e) => setEditForm({ ...editForm, titulo: e.target.value })}
                  className="bg-white text-sm"
                  placeholder="Título"
                />
                <textarea
                  value={editForm.descricao}
                  onChange={(e) => setEditForm({ ...editForm, descricao: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2}
                  placeholder="Descrição opcional"
                />
                <div className="flex gap-2">
                  <select
                    value={editForm.prioridade}
                    onChange={(e) => setEditForm({ ...editForm, prioridade: e.target.value })}
                    className="flex-1 px-2 py-1.5 border rounded-lg text-xs bg-white"
                  >
                    <option value="BAIXA">🟢 Baixa</option>
                    <option value="MEDIA">🟡 Média</option>
                    <option value="ALTA">🟠 Alta</option>
                    <option value="URGENTE">🔴 Urgente</option>
                  </select>
                  <div className="flex-1">
                    <DatePickerField
                      value={editForm.dataPrazo || undefined}
                      onChange={(date) => setEditForm({ ...editForm, dataPrazo: date })}
                      placeholder="Prazo"
                    />
                  </div>
                </div>
                <select
                  value={editForm.responsavelId}
                  onChange={(e) => setEditForm({ ...editForm, responsavelId: e.target.value })}
                  className="w-full px-2 py-1.5 border rounded-lg text-xs bg-white"
                >
                  <option value="">Sem responsável</option>
                  {usuarios.map((u) => (
                    <option key={u.id} value={u.id}>{u.nome}</option>
                  ))}
                </select>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditando(false)}
                    className="h-7 text-xs"
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSalvar}
                    disabled={salvando}
                    className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
                  >
                    {salvando ? <Loader2 className="w-3 h-3 animate-spin" /> : "Salvar"}
                  </Button>
                </div>
              </>
            ) : (
              <>
                {/* Detalhes */}
                <div className="space-y-2">
                  {subtarefa.descricao ? (
                    <p className="text-sm text-gray-600">{subtarefa.descricao}</p>
                  ) : (
                    <p className="text-xs text-gray-400 italic">Sem descrição</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="px-2 py-0.5 rounded-full bg-white border text-gray-600">
                      {subtarefa.prioridade === "URGENTE" && "🔴 Urgente"}
                      {subtarefa.prioridade === "ALTA" && "🟠 Alta"}
                      {subtarefa.prioridade === "MEDIA" && "🟡 Média"}
                      {subtarefa.prioridade === "BAIXA" && "🟢 Baixa"}
                    </span>
                    {subtarefa.dataPrazo && (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border text-gray-600">
                        <Calendar className="w-3 h-3" />
                        {new Date(subtarefa.dataPrazo).toLocaleDateString('pt-BR')}
                      </span>
                    )}
                    {subtarefa.responsavel && (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border text-gray-600">
                        <User className="w-3 h-3" />
                        {subtarefa.responsavel.nome}
                      </span>
                    )}
                  </div>
                  {/* Botões de ação */}
                  <div className="flex items-center gap-2 pt-2 border-t border-gray-200 mt-2">
                    <button
                      onClick={() => onToggle(subtarefa.id)}
                      disabled={processando.has(subtarefa.id)}
                      className={`
                        flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-colors
                        ${subtarefa.concluida 
                          ? 'bg-amber-50 text-amber-600 hover:bg-amber-100 border border-amber-200' 
                          : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200'
                        }
                        disabled:opacity-50
                      `}
                    >
                      {processando.has(subtarefa.id) ? (
                        <Loader2 className="w-3 h-3 animate-spin mx-auto" />
                      ) : subtarefa.concluida ? (
                        "↩ Reabrir"
                      ) : (
                        "✓ Marcar como concluída"
                      )}
                    </button>
                    <button
                      onClick={() => setEditando(true)}
                      className="py-1.5 px-3 rounded-lg text-xs font-medium bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200 transition-colors"
                    >
                      Editar
                    </button>
                  </div>
                </div>

                {/* Subtarefas - dentro da mesma caixa */}
                {nivel < 2 && (
                  <div className="pt-3 border-t border-gray-200">
                    <h4 className="text-xs font-medium text-gray-500 mb-2">Subtarefas</h4>
                    
                    {subSubtarefas.length > 0 ? (
                      <div className="space-y-2 mb-3">
                        {subSubtarefas.map((subSub) => (
                          <SubtarefaItem
                            key={subSub.id}
                            subtarefa={subSub}
                            nivel={nivel + 1}
                            onToggle={handleToggleSubSub}
                            onDelete={handleDeleteSubSub}
                            onUpdate={onUpdate}
                            processando={new Set()}
                            usuarios={usuarios}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 mb-2">Nenhuma subtarefa</p>
                    )}

                    {/* Input nova sub-subtarefa */}
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Adicionar subtarefa..."
                        value={novaSubSub}
                        onChange={(e) => setNovaSubSub(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !criandoSubSub) handleCriarSubSub()
                        }}
                        disabled={criandoSubSub}
                        className="flex-1 h-8 text-sm bg-white"
                      />
                      <Button
                        onClick={handleCriarSubSub}
                        disabled={criandoSubSub || !novaSubSub.trim()}
                        size="sm"
                        className="h-8 w-8 p-0 bg-blue-600 hover:bg-blue-700"
                      >
                        {criandoSubSub ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Plus className="w-3 h-3" />
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
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
    // ✅ CORRIGIDO: ID temporário NEGATIVO para distinguir de IDs reais
    const tempId = -Date.now()
    
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

      if (response.ok) {
        // ✅ Atualiza com o ID real do servidor
        const data = await response.json()
        if (data.subtarefa) {
          setSubtarefasLocal(prev => 
            prev.map(s => s.id === tempId ? data.subtarefa : s)
          )
        }
        onUpdate()
      } else {
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
    // ✅ CORRIGIDO: Não permite toggle em IDs temporários (negativos)
    if (subtarefaId < 0) {
      console.log("Subtarefa ainda sendo salva, aguarde...")
      return
    }
    
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
    // ✅ Não exclui subtarefas temporárias
    if (subtarefaId < 0) return
    
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
                <span>Clique na seta para expandir detalhes e adicionar subtarefas</span>
              </div>

              {/* Lista */}
              <div className="space-y-2">
                {subtarefasLocal.map((subtarefa) => (
                  <SubtarefaItem
                    key={subtarefa.id}
                    subtarefa={subtarefa}
                    nivel={0}
                    onToggle={handleToggleSubtarefa}
                    onDelete={handleExcluirSubtarefa}
                    onUpdate={onUpdate}
                    processando={processando}
                    usuarios={usuarios}
                  />
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
export function ProcessoTarefas({ processoId, pais, onUpdate }: ProcessoTarefasProps) {
  const [tarefas, setTarefas] = useState<Tarefa[]>([])
  const [loading, setLoading] = useState(true)
  const [novaTarefa, setNovaTarefa] = useState("")
  const [criando, setCriando] = useState(false)
  const [tarefaSelecionada, setTarefaSelecionada] = useState<Tarefa | null>(null)
  const [usuarios, setUsuarios] = useState<Responsavel[]>([])
  
  // Estados para o seletor de tarefas pré-definidas
  const [mostrarSeletor, setMostrarSeletor] = useState(false)
  const [mostrarInputCustom, setMostrarInputCustom] = useState(false)
  const seletorRef = useRef<HTMLDivElement>(null)
  
  // Obter tarefas pré-definidas do país
  const tarefasPreDefinidas = getTarefasPorPais(pais)
  
  // Ref para rastrear o ID do modal aberto (evita bugs de re-abertura)
  const modalAbertoIdRef = useRef<number | null>(null)
  
  // Fechar seletor ao clicar fora
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (seletorRef.current && !seletorRef.current.contains(event.target as Node)) {
        setMostrarSeletor(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])
  
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

  // Criar nova tarefa (pré-definida ou customizada)
  const handleCriarTarefa = async (titulo?: string) => {
    const tituloFinal = titulo || novaTarefa.trim()
    if (!tituloFinal) return

    setCriando(true)
    setMostrarSeletor(false)
    setMostrarInputCustom(false)
    
    try {
      const response = await fetch("/api/tarefas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo: tituloFinal,
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
  
  // Selecionar tarefa pré-definida
  const handleSelecionarTarefaPreDefinida = (tarefa: TarefaPreDefinida) => {
    handleCriarTarefa(tarefa.nome)
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
          <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
            <CheckCircle2 className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">Tarefas</h3>
            {tarefas.length > 0 && (
              <p className="text-xs text-gray-500">
                {tarefasPendentes.length} pendente{tarefasPendentes.length !== 1 ? 's' : ''}
                {tarefasConcluidas.length > 0 && ` · ${tarefasConcluidas.length} concluída${tarefasConcluidas.length !== 1 ? 's' : ''}`}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Seletor de nova tarefa */}
      <div className="p-4 border-b flex-shrink-0 bg-gray-50/50" ref={seletorRef}>
        <div className="relative">
          {/* Botão principal / Input customizado */}
          {mostrarInputCustom ? (
            <div className="flex items-center gap-2">
              <Input
                placeholder="Nome da tarefa..."
                value={novaTarefa}
                onChange={(e) => setNovaTarefa(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !criando) handleCriarTarefa()
                  if (e.key === "Escape") {
                    setMostrarInputCustom(false)
                    setNovaTarefa("")
                  }
                }}
                disabled={criando}
                className="flex-1 bg-white"
                autoFocus
              />
              <Button
                onClick={() => handleCriarTarefa()}
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
              <Button
                onClick={() => {
                  setMostrarInputCustom(false)
                  setNovaTarefa("")
                }}
                size="sm"
                variant="ghost"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <button
              onClick={() => setMostrarSeletor(!mostrarSeletor)}
              disabled={criando}
              className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-gray-200 rounded-xl text-left hover:border-blue-300 hover:shadow-sm transition-all disabled:opacity-50 group"
            >
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                <Plus className="h-4 w-4 text-blue-600" />
              </div>
              <span className="flex-1 text-gray-500 text-sm">Adicionar nova tarefa...</span>
              <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${mostrarSeletor ? 'rotate-180' : ''}`} />
            </button>
          )}

          {/* Dropdown de opções */}
          {mostrarSeletor && !mostrarInputCustom && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-200 rounded-xl shadow-lg z-50 max-h-72 overflow-y-auto">
              {tarefasPreDefinidas.length > 0 ? (
                <>
                  <div className="px-4 py-2 border-b border-gray-100">
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Tarefas de {pais}</p>
                  </div>
                  {tarefasPreDefinidas.map((tarefa) => (
                    <button
                      key={tarefa.id}
                      onClick={() => handleSelecionarTarefaPreDefinida(tarefa)}
                      disabled={criando}
                      className="w-full px-4 py-3 text-left text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors disabled:opacity-50 flex items-center gap-3"
                    >
                      <Circle className="h-4 w-4 text-gray-300" />
                      {tarefa.nome}
                    </button>
                  ))}
                </>
              ) : (
                <div className="px-4 py-3 text-sm text-gray-500">
                  Nenhuma tarefa pré-definida para {pais}
                </div>
              )}
              
              {/* Separador */}
              <div className="border-t border-gray-100" />
              
              {/* Opção "Outro" */}
              <button
                onClick={() => {
                  setMostrarSeletor(false)
                  setMostrarInputCustom(true)
                }}
                className="w-full px-4 py-3 text-left text-sm text-blue-600 hover:bg-blue-50 transition-colors flex items-center gap-3 font-medium"
              >
                <Plus className="h-4 w-4" />
                Outro (digitar nome)
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Lista de tarefas - com scroll */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : tarefas.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="h-8 w-8 text-gray-300" />
            </div>
            <p className="font-medium text-gray-600">Nenhuma tarefa ainda</p>
            <p className="text-sm text-gray-400 mt-1">Adicione tarefas para acompanhar o progresso</p>
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
              <div className="flex items-center gap-3 py-3">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs font-medium text-gray-400 bg-gray-50 px-3 py-1 rounded-full">
                  Concluídas ({tarefasConcluidas.length})
                </span>
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
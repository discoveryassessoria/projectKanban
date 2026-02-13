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
  ListTodo,
  Play,
  MessageSquare,
  Clock,
  FileX,
  RefreshCw,
  CalendarCheck,
  CalendarClock,
  ClipboardCheck,
  FolderOpen,
  GripVertical,
  Pencil
} from "lucide-react"
import { getTarefasPorPais, type TarefaPreDefinida } from "../../lib/tarefas-config"
import { isPast, formatDateBR } from "@/src/lib/date-utils"
import { TarefaDetailModal } from "./TarefaDetailModal"
import { usePermissoes } from "@/src/hooks/use-permissoes"

// ✅ NOVO: Imports do dnd-kit para drag-and-drop
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers'

// ==========================================
// CLASSES PADRÃO PARA FORMULÁRIOS
// ==========================================
const inputClass = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm h-[42px]"

const selectClass = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm h-[42px] appearance-none cursor-pointer"

const selectStyle = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center'
} as React.CSSProperties

const selectStyleSmall = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 4px center'
} as React.CSSProperties

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
  dataInicio?: string
  observacoes?: string
  tipoSubtarefa?: string
  prazoCobranca?: number
  responsavel?: Responsavel
  responsavelId?: number
  subtarefas?: Tarefa[]
  tarefaPaiId?: number
  ordem?: number
}

// ✅ NOVO: Interface para Pessoa (requerente/contratante)
interface Pessoa {
  id: number
  nome: string
  tipo: 'REQUERENTE' | 'CONTRATANTE'
}

interface ProcessoTarefasProps {
  processoId: number
  pais: string
  onUpdate?: () => void
  pessoas?: Pessoa[]
  tarefaPaiId?: number
  atividadeId?: number  // ← Novo
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
        <circle
          cx={tamanho / 2}
          cy={tamanho / 2}
          r={raio}
          fill="none"
          stroke={corFundo}
          strokeWidth={4}
        />
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
// ✅ NOVO: COMPONENTE: Card da Tarefa Arrastável (Sortable)
// ==========================================
interface SortableTarefaCardProps {
  tarefa: Tarefa
  onClick: () => void
  onDelete: (e: React.MouseEvent) => void
}

function calcularPrioridadeMaior(subtarefas: any[]): string | null {
  const niveis: Record<string, number> = {
    'URGENTE': 4, 'ALTA': 3, 'MEDIA': 2, 'BAIXA': 1
  };
  
  if (!subtarefas || subtarefas.length === 0) return 'MEDIA';
  
  // Verifica se tarefa está efetivamente concluída
  // (marcada como concluída OU todas sub-subtarefas concluídas)
  function estaEfetivamenteConcluida(tarefa: any): boolean {
    if (tarefa.concluida) return true;
    if (tarefa.subtarefas && tarefa.subtarefas.length > 0) {
      return tarefa.subtarefas.every((s: any) => estaEfetivamenteConcluida(s));
    }
    return false;
  }
  
  const pendentes = subtarefas.filter((a: any) => !estaEfetivamenteConcluida(a));
  
  if (pendentes.length === 0) return null;
  
  let maiorPrioridade = 'BAIXA';
  let maiorNivel = 0;
  
  for (const atividade of pendentes) {
    const nivel = niveis[atividade.prioridade] || 0;
    if (nivel > maiorNivel) {
      maiorNivel = nivel;
      maiorPrioridade = atividade.prioridade;
    }
  }
  
  return maiorPrioridade;
}

function SortableTarefaCard({ tarefa, onClick, onDelete }: SortableTarefaCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tarefa.id })

  const style = {
    transform: transform ? CSS.Translate.toString(transform) : undefined,
    transition: transform ? transition : undefined,
    opacity: isDragging ? 0 : 1,
    zIndex: isDragging ? 1000 : 1,
  }

  const { pode } = usePermissoes()

  const subtarefas = tarefa.subtarefas || []
  const temSubtarefas = subtarefas.length > 0
  
  // Calcula progresso baseado nas tarefas dentro das atividades
  const calcularProgresso = () => {
    let totalTarefas = 0
    let tarefasConcluidas = 0
    
    subtarefas.forEach(atividade => {
      // A atividade conta como tarefa
      totalTarefas += 1
      const tarefasDaAtividade = atividade.subtarefas || []
      const atividadeConcluida = atividade.concluida || 
        (tarefasDaAtividade.length > 0 && tarefasDaAtividade.every(t => t.concluida))
      if (atividadeConcluida) tarefasConcluidas += 1

      // Subtarefas também contam
      totalTarefas += tarefasDaAtividade.length
      tarefasConcluidas += tarefasDaAtividade.filter(t => t.concluida).length
    })
    
    if (totalTarefas === 0) {
      return tarefa.concluida ? 100 : 0
    }
    return (tarefasConcluidas / totalTarefas) * 100
  }
  
  const porcentagem = calcularProgresso()
  const atrasada = tarefa.dataPrazo && isPast(tarefa.dataPrazo) && !tarefa.concluida

  // Conta total de tarefas dentro das atividades
  const contarTarefas = () => {
    let total = 0
    subtarefas.forEach(atividade => {
      total += 1  // A atividade (nível 2)
      const subs = atividade.subtarefas || []
      subs.forEach(sub => {
        total += 1  // Subtarefa (nível 3)
        total += (sub.subtarefas || []).length  // Sub-subtarefas (nível 4)
      })
    })
    return total
  }
  const totalTarefas = contarTarefas()

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        group relative flex items-center gap-4 p-4 rounded-xl cursor-pointer
        transition-all duration-200 ease-out border
        ${tarefa.concluida 
          ? 'bg-gray-50/80 border-gray-200/60 opacity-70' 
          : atrasada
            ? 'bg-white border-red-200 hover:border-red-300 hover:shadow-md hover:shadow-red-100/50'
            : 'bg-white border-gray-200 hover:border-blue-300 hover:shadow-md hover:shadow-blue-100/50'
        }
        ${isDragging ? 'shadow-lg ring-2 ring-blue-400' : ''}
      `}
    >
      {/* Handle de arraste - só aparece com permissão de editar */}
      {pode('tarefas.editar') && (
        <div
          {...attributes}
          {...listeners}
          className="flex-shrink-0 cursor-grab active:cursor-grabbing p-1 -ml-2 rounded hover:bg-gray-100 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-4 h-4 text-gray-400" />
        </div>
      )}

      {/* Indicador lateral de prioridade */}
      {!tarefa.concluida && calcularPrioridadeMaior(tarefa.subtarefas || []) && (
        <div className={`absolute left-0 top-3 bottom-3 w-1 rounded-r-full transition-all
          ${calcularPrioridadeMaior(tarefa.subtarefas || []) === 'URGENTE' ? 'bg-red-500' : ''}
          ${calcularPrioridadeMaior(tarefa.subtarefas || []) === 'ALTA' ? 'bg-orange-500' : ''}
          ${calcularPrioridadeMaior(tarefa.subtarefas || []) === 'MEDIA' ? 'bg-amber-400' : ''}
          ${calcularPrioridadeMaior(tarefa.subtarefas || []) === 'BAIXA' ? 'bg-emerald-400' : ''}
        `} />
      )}

      {/* Círculo de progresso ou ícone de pasta */}
      <div className="flex-shrink-0" onClick={onClick}>
        {totalTarefas > 0 ? (
          <CirculoProgresso porcentagem={porcentagem} />
        ) : (
          <div className={`
            w-11 h-11 rounded-full border-2 flex items-center justify-center transition-all
            ${tarefa.concluida 
              ? 'bg-emerald-500 border-emerald-500' 
              : 'border-gray-300 bg-gray-50 group-hover:border-blue-400'
            }
          `}>
            {tarefa.concluida ? (
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <FolderOpen className="w-5 h-5 text-gray-400 group-hover:text-blue-400 transition-colors" />
            )}
          </div>
        )}
      </div>

      {/* Conteúdo */}
      <div className="flex-1 min-w-0" onClick={onClick}>
        <div className="flex items-center gap-2 mb-1.5">
          <h4 className={`font-semibold text-[15px] leading-tight ${tarefa.concluida ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
            {tarefa.titulo}
          </h4>
        </div>

        {/* Info adicional */}
        <div className="flex items-center flex-wrap gap-2 text-xs">
          {!tarefa.concluida && calcularPrioridadeMaior(tarefa.subtarefas || []) && <BadgePrioridade prioridade={calcularPrioridadeMaior(tarefa.subtarefas || []) as string} />}
          
          {totalTarefas > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 font-medium border border-blue-100">
              <ListTodo className="w-3 h-3" />
              {totalTarefas} tarefa{totalTarefas !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Ações */}
      <div className="flex items-center gap-1">
        {pode('tarefas.excluir') && <button
          onClick={onDelete}
          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
          title="Excluir"
        >
          <Trash2 className="w-4 h-4" />
        </button>}
        <div 
          onClick={onClick}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 group-hover:text-blue-500 group-hover:bg-blue-50 transition-all cursor-pointer"
        >
          <ChevronRight className="w-5 h-5" />
        </div>
      </div>
    </div>
  )
}

// ==========================================
// COMPONENTE: Card da Tarefa Principal (tela principal - ORIGINAL, sem drag)
// ==========================================
interface TarefaCardProps {
  tarefa: Tarefa
  onClick: () => void
  onDelete: (e: React.MouseEvent) => void
}

function TarefaCard({ tarefa, onClick, onDelete }: TarefaCardProps) {
  const { pode } = usePermissoes()
  const subtarefas = tarefa.subtarefas || []
  const temSubtarefas = subtarefas.length > 0
  
  // Calcula progresso baseado nas tarefas dentro das atividades
  const calcularProgresso = () => {
    let totalTarefas = 0
    let tarefasConcluidas = 0
    
    subtarefas.forEach(atividade => {
      // A atividade conta como tarefa
      totalTarefas += 1
      const tarefasDaAtividade = atividade.subtarefas || []
      const atividadeConcluida = atividade.concluida || 
        (tarefasDaAtividade.length > 0 && tarefasDaAtividade.every(t => t.concluida))
      if (atividadeConcluida) tarefasConcluidas += 1

      // Subtarefas também contam
      totalTarefas += tarefasDaAtividade.length
      tarefasConcluidas += tarefasDaAtividade.filter(t => t.concluida).length
    })
    
    if (totalTarefas === 0) {
      return tarefa.concluida ? 100 : 0
    }
    return (tarefasConcluidas / totalTarefas) * 100
  }
  
  const porcentagem = calcularProgresso()
  const atrasada = tarefa.dataPrazo && isPast(tarefa.dataPrazo) && !tarefa.concluida

  // Conta total de tarefas dentro das atividades
  const contarTarefas = () => {
    let total = 0
    subtarefas.forEach(atividade => {
      total += 1  // A atividade (nível 2)
      const subs = atividade.subtarefas || []
      subs.forEach(sub => {
        total += 1  // Subtarefa (nível 3)
        total += (sub.subtarefas || []).length  // Sub-subtarefas (nível 4)
      })
    })
    return total
  }
  const totalTarefas = contarTarefas()

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

      {/* Círculo de progresso ou ícone de pasta */}
      <div className="flex-shrink-0 ml-1">
        {totalTarefas > 0 ? (
          <CirculoProgresso porcentagem={porcentagem} />
        ) : (
          <div className={`
            w-11 h-11 rounded-full border-2 flex items-center justify-center transition-all
            ${tarefa.concluida 
              ? 'bg-emerald-500 border-emerald-500' 
              : 'border-gray-300 bg-gray-50 group-hover:border-blue-400'
            }
          `}>
            {tarefa.concluida ? (
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <FolderOpen className="w-5 h-5 text-gray-400 group-hover:text-blue-400 transition-colors" />
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
          {!tarefa.concluida && calcularPrioridadeMaior(tarefa.subtarefas || []) && <BadgePrioridade prioridade={calcularPrioridadeMaior(tarefa.subtarefas || []) as string} />}
          
          {totalTarefas > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 font-medium border border-blue-100">
              <ListTodo className="w-3 h-3" />
              {totalTarefas} tarefa{totalTarefas !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Ações */}
      <div className="flex items-center gap-1">
        {pode('tarefas.excluir') && <button
          onClick={onDelete}
          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
          title="Excluir"
        >
          <Trash2 className="w-4 h-4" />
        </button>}
        <div className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 group-hover:text-blue-500 group-hover:bg-blue-50 transition-all">
          <ChevronRight className="w-5 h-5" />
        </div>
      </div>
    </div>
  )
}

// ==========================================
// COMPONENTE: Modal de Ação de Cobrança (Subtarefa)
// ==========================================
interface CobrancaModalProps {
  subtarefa: Tarefa
  onClose: () => void
  onUpdate: () => void
  isProcuracaoAdm?: boolean
  usuarios?: Responsavel[]
}

function CobrancaModal({ subtarefa, onClose, onUpdate, isProcuracaoAdm = false, usuarios = [] }: CobrancaModalProps) {
  const [processando, setProcessando] = useState(false)
  const [observacao, setObservacao] = useState(subtarefa.observacoes || "")
  const [responsavelId, setResponsavelId] = useState<string>(subtarefa.responsavelId?.toString() || "")
  const [novoPrazo, setNovoPrazo] = useState("")
  const [diasCobranca, setDiasCobranca] = useState(5)
  const [mostrarAlterarPrazo, setMostrarAlterarPrazo] = useState(false)

  // Salvar responsável automaticamente ao mudar
  const handleResponsavelChange = async (novoResponsavelId: string) => {
    setResponsavelId(novoResponsavelId)
    
    try {
      await fetch(`/api/tarefas/${subtarefa.id}`, {
        method: "PUT",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken")}`
        },
        body: JSON.stringify({
          responsavelId: novoResponsavelId ? parseInt(novoResponsavelId) : null
        })
      })
      onUpdate()
    } catch (error) {
      console.error("Erro ao salvar responsável:", error)
    }
  }

  const executarAcao = async (acao: string) => {
    setProcessando(true)
    try {
      const response = await fetch(`/api/tarefas/${subtarefa.id}/cobranca`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken")}`
        },
        body: JSON.stringify({
          acao,
          observacao: observacao || undefined,
          novoPrazo: novoPrazo || undefined,
          diasCobranca
        })
      })

      if (response.ok) {
        onUpdate()
        onClose()
      } else {
        const data = await response.json()
        alert(data.error || "Erro ao executar ação")
      }
    } catch (error) {
      console.error("Erro:", error)
      alert("Erro ao executar ação")
    } finally {
      setProcessando(false)
    }
  }

  return (
    <div 
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[10002] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-lg">Ação de Cobrança</h3>
              <p className="text-amber-100 text-sm mt-0.5">{subtarefa.titulo}</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Conteúdo */}
        <div className="p-6 space-y-4">
          {/* Datas */}
          <div className="flex flex-wrap gap-3 text-xs">
            {subtarefa.dataInicio && (
              <span className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-600 rounded-md">
                <CalendarCheck className="w-3 h-3" />
                Início: {formatDateBR(subtarefa.dataInicio)}
              </span>
            )}
            {subtarefa.dataPrazo && (
              <span className={`flex items-center gap-1 px-2 py-1 rounded-md ${isPast(subtarefa.dataPrazo) && !subtarefa.concluida ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-600'}`}>
                <CalendarClock className="w-3 h-3" />
                Prazo: {formatDateBR(subtarefa.dataPrazo)}
              </span>
            )}
          </div>

          {/* Campo de observações */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <MessageSquare className="w-4 h-4 inline mr-1" />
              Observações
            </label>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Ex: Cliente informou que vai enviar semana que vem..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-500"
              rows={2}
            />
          </div>

          {/* Responsável */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <User className="w-4 h-4 inline mr-1" />
              Responsável
            </label>
            <select
              value={responsavelId}
              onChange={(e) => handleResponsavelChange(e.target.value)}
              className={selectClass}
              style={selectStyle}
            >
              <option value="">Sem responsável</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>{u.nome}</option>
              ))}
            </select>
          </div>

          {/* Botões de ação */}
          <div className="space-y-2">
            {/* Recebido */}
            <button
              onClick={() => executarAcao("recebido")}
              disabled={processando}
              className="w-full flex items-center gap-3 px-4 py-3 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl text-emerald-700 font-medium transition-colors disabled:opacity-50"
            >
              <CheckCircle2 className="w-5 h-5" />
              <div className="text-left">
                <div>Documento Recebido</div>
                <div className="text-xs text-emerald-600 font-normal">Finaliza a tarefa</div>
              </div>
            </button>

            {/* Cobrado, aguardando */}
            <button
              onClick={() => executarAcao("cobrado")}
              disabled={processando}
              className="w-full flex items-center gap-3 px-4 py-3 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl text-blue-700 font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className="w-5 h-5" />
              <div className="text-left flex-1">
                <div>Cobrado, Aguardando</div>
                <div className="text-xs text-blue-600 font-normal">Cria nova cobrança em {diasCobranca} dias</div>
              </div>
              <select
                value={diasCobranca}
                onChange={(e) => setDiasCobranca(parseInt(e.target.value))}
                onClick={(e) => e.stopPropagation()}
                className="pl-3 pr-8 py-2 text-sm border border-blue-300 rounded-lg bg-white h-[38px] appearance-none cursor-pointer"
                style={selectStyle}
              >
                <option value={1}>1 dia</option>
                <option value={3}>3 dias</option>
                <option value={5}>5 dias</option>
                <option value={7}>7 dias</option>
                <option value={10}>10 dias</option>
              </select>
            </button>

            {/* Cliente não possui / Conferência */}
{isProcuracaoAdm ? (
  <button
    onClick={() => executarAcao("conferencia")}
    disabled={processando}
    className="w-full flex items-center gap-3 px-4 py-3 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-xl text-violet-700 font-medium transition-colors disabled:opacity-50"
  >
    <ClipboardCheck className="w-5 h-5" />
    <div className="text-left flex-1">
      <div>Conferir</div>
      <div className="text-xs text-violet-600 font-normal">Cria tarefa de conferência em {diasCobranca} dias</div>
    </div>
    <select
    value={diasCobranca}
    onChange={(e) => setDiasCobranca(parseInt(e.target.value))}
    onClick={(e) => e.stopPropagation()}
    className="pl-3 pr-8 py-2 text-sm border border-violet-300 rounded-lg bg-white h-[38px] appearance-none cursor-pointer"
    style={selectStyle}
  >
      <option value={1}>1 dia</option>
      <option value={3}>3 dias</option>
      <option value={5}>5 dias</option>
      <option value={7}>7 dias</option>
      <option value={10}>10 dias</option>
    </select>
  </button>
) : (
  <button
    onClick={() => executarAcao("nao_possui")}
    disabled={processando}
    className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl text-gray-700 font-medium transition-colors disabled:opacity-50"
  >
    <FileX className="w-5 h-5" />
    <div className="text-left">
      <div>Cliente Não Possui</div>
      <div className="text-xs text-gray-500 font-normal">Finaliza como não aplicável</div>
    </div>
  </button>
)}

            {/* Alterar prazo */}
            {!mostrarAlterarPrazo ? (
              <button
                onClick={() => setMostrarAlterarPrazo(true)}
                className="w-full flex items-center gap-3 px-4 py-3 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl text-amber-700 font-medium transition-colors"
              >
                <Clock className="w-5 h-5" />
                <div className="text-left">
                  <div>Alterar Prazo</div>
                  <div className="text-xs text-amber-600 font-normal">Definir nova data manualmente</div>
                </div>
              </button>
            ) : (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
                <label className="block text-sm font-medium text-amber-700">
                  Nova data de cobrança:
                </label>
                <DatePickerField
                  value={novoPrazo}
                  onChange={(value) => setNovoPrazo(value)}
                  placeholder="Selecione a data"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setMostrarAlterarPrazo(false)}
                    className="flex-1 px-3 py-2 text-sm text-gray-600 bg-white border rounded-lg hover:bg-gray-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => executarAcao("alterar_prazo")}
                    disabled={processando || !novoPrazo}
                    className="flex-1 px-3 py-2 text-sm text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-50"
                  >
                    Confirmar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Loading */}
        {processando && (
          <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
          </div>
        )}
      </div>
    </div>
  )
}

// ==========================================
// COMPONENTE: TarefaItem (Documento identidade) - COM iniciar/concluir/alterar prazo
// ==========================================
interface TarefaItemProps {
  tarefa: Tarefa
  onDelete: (id: number) => void
  onUpdate: () => void
  usuarios: Responsavel[]
  isProcuracaoAdm?: boolean
}

function TarefaItem({ tarefa, onDelete, onUpdate, usuarios, isProcuracaoAdm = false }: TarefaItemProps) {
  const { pode } = usePermissoes()
  const [expandido, setExpandido] = useState(false)
  const [editando, setEditando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [iniciando, setIniciando] = useState(false)
  const [concluindo, setConcluindo] = useState(false)
  const [prazoCobrancaConfig, setPrazoCobrancaConfig] = useState(tarefa.prazoCobranca || 5)
  const [subtarefas, setSubtarefas] = useState<Tarefa[]>(tarefa.subtarefas || [])
  const [mostrarAlterarPrazo, setMostrarAlterarPrazo] = useState(false)
  const [novoPrazo, setNovoPrazo] = useState("")
  const [mostrarCobrancaModal, setMostrarCobrancaModal] = useState(false)
  const [subtarefaSelecionada, setSubtarefaSelecionada] = useState<Tarefa | null>(null)
  const [mostrarOpcaoAguardando, setMostrarOpcaoAguardando] = useState(false)
  const [diasCobrancaAguardando, setDiasCobrancaAguardando] = useState(5)
  const [confirmandoRecebido, setConfirmandoRecebido] = useState(false)
  const [confirmandoNaoPossui, setConfirmandoNaoPossui] = useState(false)
  const [mostrarOpcaoConferencia, setMostrarOpcaoConferencia] = useState(false)
  const [diasConferencia, setDiasConferencia] = useState(5)

useEffect(() => {
  if (confirmandoRecebido) {
    const timer = setTimeout(() => setConfirmandoRecebido(false), 3000)
    return () => clearTimeout(timer)
  }
}, [confirmandoRecebido])

useEffect(() => {
  if (confirmandoNaoPossui) {
    const timer = setTimeout(() => setConfirmandoNaoPossui(false), 3000)
    return () => clearTimeout(timer)
  }
}, [confirmandoNaoPossui])

useEffect(() => {
  if (mostrarOpcaoConferencia) {
    const timer = setTimeout(() => setMostrarOpcaoConferencia(false), 3000)
    return () => clearTimeout(timer)
  }
}, [mostrarOpcaoConferencia])
  
  const [editForm, setEditForm] = useState({
    titulo: tarefa.titulo,
    descricao: tarefa.descricao || "",
    prioridade: tarefa.prioridade,
    dataPrazo: tarefa.dataPrazo ? tarefa.dataPrazo.split("T")[0] : "",
    responsavelId: tarefa.responsavelId?.toString() || "",
    observacoes: tarefa.observacoes || "",
    prazoCobranca: tarefa.prazoCobranca || 5
  })

  const isTemporaria = tarefa.id < 0
  const isCobranca = tarefa.tipoSubtarefa === "COBRANCA"
  const iniciada = !!tarefa.dataInicio

  const calcularStatus = () => {
    if (tarefa.concluida) {
      return { label: "Concluída", bg: "bg-emerald-50", text: "text-emerald-600", border: "border-emerald-200" }
    }
    if (!iniciada) {
      return { label: "Não iniciada", bg: "bg-gray-50", text: "text-gray-500", border: "border-gray-200" }
    }
    // Verificar se tem cobrança pendente
    const cobrancaPendente = subtarefas.find(s => s.tipoSubtarefa === "COBRANCA" && !s.concluida)
    if (cobrancaPendente) {
      return { label: "Aguardando", bg: "bg-amber-50", text: "text-amber-600", border: "border-amber-200" }
    }
    return { label: "Em andamento", bg: "bg-blue-50", text: "text-blue-600", border: "border-blue-200" }
  }
  
  const status = calcularStatus()

  const fetchSubtarefas = async () => {
    if (isTemporaria) return
    try {
      const response = await fetch(`/api/tarefas/${tarefa.id}`)
      const data = await response.json()
      if (data.tarefa?.subtarefas) {
        setSubtarefas(data.tarefa.subtarefas)
      }
    } catch (error) {
      console.error("Erro ao buscar subtarefas:", error)
    }
  }

  useEffect(() => {
  // Só atualiza se as props tiverem dados novos (baseado no ID da última subtarefa)
  const propsIds = (tarefa.subtarefas || []).map(s => s.id).sort().join(',')
  const localIds = subtarefas.map(s => s.id).sort().join(',')
  
    if (propsIds !== localIds && tarefa.subtarefas && tarefa.subtarefas.length > 0) {
      setSubtarefas(tarefa.subtarefas)
    }
  }, [tarefa.subtarefas])

  // Iniciar tarefa
  const handleIniciar = async () => {
    if (isTemporaria) return
    setIniciando(true)
    try {
      const response = await fetch(`/api/tarefas/${tarefa.id}/iniciar`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken")}`
        },
        body: JSON.stringify({ prazoCobranca: editForm.prazoCobranca || tarefa.prazoCobranca || 5 })
      })

      if (response.ok) {
        fetchSubtarefas()
        onUpdate()
      } else {
        const data = await response.json()
        alert(data.error || "Erro ao iniciar tarefa")
      }
    } catch (error) {
      console.error("Erro ao iniciar:", error)
      alert("Erro ao iniciar tarefa")
    } finally {
      setIniciando(false)
    }
  }

  // Marcar como concluída
  const handleConcluir = async () => {
    if (isTemporaria) return
    setConcluindo(true)
    try {
      const response = await fetch(`/api/tarefas/${tarefa.id}/toggle`, { 
        method: "POST",
        headers: { "Authorization": `Bearer ${localStorage.getItem("authToken")}` }
      })
      if (response.ok) {
        onUpdate()
      }
    } catch (error) {
      console.error("Erro ao concluir:", error)
    } finally {
      setConcluindo(false)
    }
  }

// Concluir com status específico (Recebido ou Não possui)
const handleConcluirComStatus = async (status: string) => {
  if (isTemporaria) return
  setConcluindo(true)
  try {
    // Buscar cobrança pendente para agir sobre ela
    const cobrancaPendente = subtarefas.find(s => s.tipoSubtarefa === "COBRANCA" && !s.concluida)
    const idParaAcao = cobrancaPendente?.id || tarefa.id
    
    const response = await fetch(`/api/tarefas/${idParaAcao}/cobranca`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${localStorage.getItem("authToken")}`
      },
      body: JSON.stringify({ 
        acao: status === "recebido" ? "recebido" : "nao_possui" 
      })
    })
    if (response.ok) {
      fetchSubtarefas()
      onUpdate()
    } else {
      const data = await response.json()
      alert(data.error || "Erro ao concluir tarefa")
    }
  } catch (error) {
    console.error("Erro ao concluir:", error)
    alert("Erro ao concluir tarefa")
  } finally {
    setConcluindo(false)
  }
}

// Aguardando cliente - cria nova cobrança
const handleAguardandoCliente = async () => {
  if (isTemporaria) return
  setConcluindo(true)
  try {
    // Buscar cobrança pendente para agir sobre ela
    const cobrancaPendente = subtarefas.find(s => s.tipoSubtarefa === "COBRANCA" && !s.concluida)
    const idParaAcao = cobrancaPendente?.id || tarefa.id
    
    const response = await fetch(`/api/tarefas/${idParaAcao}/cobranca`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${localStorage.getItem("authToken")}`
      },
      body: JSON.stringify({
        acao: "cobrado",
        observacao: "Aguardando cliente",
        diasCobranca: diasCobrancaAguardando
      })
    })
    if (response.ok) {
      setMostrarOpcaoAguardando(false)
      fetchSubtarefas()
      onUpdate()
    } else {
      const data = await response.json()
      alert(data.error || "Erro ao criar cobrança")
    }
  } catch (error) {
    console.error("Erro:", error)
    alert("Erro ao criar cobrança")
  } finally {
    setConcluindo(false)
  }
}

// Conferência - cria subtarefa de conferência
const handleConferencia = async () => {
  if (isTemporaria) return
  setConcluindo(true)
  try {
    const cobrancaPendente = subtarefas.find(s => s.tipoSubtarefa === "COBRANCA" && !s.concluida)
    const idParaAcao = cobrancaPendente?.id || tarefa.id
    
    const response = await fetch(`/api/tarefas/${idParaAcao}/cobranca`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${localStorage.getItem("authToken")}`
      },
      body: JSON.stringify({
        acao: "conferencia",
        diasCobranca: diasConferencia
      })
    })
    if (response.ok) {
      setMostrarOpcaoConferencia(false)
      fetchSubtarefas()
      onUpdate()
    } else {
      const data = await response.json()
      alert(data.error || "Erro ao criar conferência")
    }
  } catch (error) {
    console.error("Erro:", error)
    alert("Erro ao criar conferência")
  } finally {
    setConcluindo(false)
  }
}

  // Alterar prazo
  const handleAlterarPrazo = async () => {
    if (isTemporaria || !novoPrazo) return
    setSalvando(true)
    try {
      const response = await fetch(`/api/tarefas/${tarefa.id}`, {
        method: "PUT",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken")}`
        },
        body: JSON.stringify({ dataPrazo: novoPrazo })
      })
      if (response.ok) {
        setMostrarAlterarPrazo(false)
        setNovoPrazo("")
        onUpdate()
      }
    } catch (error) {
      console.error("Erro ao alterar prazo:", error)
    } finally {
      setSalvando(false)
    }
  }

  const handleSalvar = async () => {
    if (isTemporaria) return
    setSalvando(true)
    try {
      const response = await fetch(`/api/tarefas/${tarefa.id}`, {
        method: "PUT",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken")}`
        },
        body: JSON.stringify({
          titulo: editForm.titulo,
          descricao: editForm.descricao || null,
          prioridade: editForm.prioridade,
          dataPrazo: editForm.dataPrazo || null,
          responsavelId: editForm.responsavelId ? parseInt(editForm.responsavelId) : null,
          observacoes: editForm.observacoes || null,
          prazoCobranca: editForm.prazoCobranca
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

  // Se for subtarefa de cobrança OU conferência, renderiza no mesmo padrão
  const isConferencia = tarefa.tipoSubtarefa === "CONFERENCIA"

  if (isCobranca || isConferencia) {
    // Definir cores baseado no tipo
    const cores = isConferencia 
      ? {
          bg: tarefa.concluida ? 'bg-gray-50' : 'bg-violet-50',
          border: tarefa.concluida ? 'border-gray-200' : 'border-violet-200',
          hoverBorder: 'hover:border-violet-300',
          iconBg: tarefa.concluida ? 'bg-emerald-500' : 'bg-violet-400',
          texto: tarefa.concluida ? 'text-gray-400 line-through' : 'text-violet-800 font-medium',
          acao: 'text-violet-600'
        }
      : {
          bg: tarefa.concluida ? 'bg-gray-50' : 'bg-blue-50',
          border: tarefa.concluida ? 'border-gray-200' : 'border-blue-200',
          hoverBorder: 'hover:border-blue-300',
          iconBg: tarefa.concluida ? 'bg-emerald-500' : 'bg-blue-400',
          texto: tarefa.concluida ? 'text-gray-400 line-through' : 'text-blue-800 font-medium',
          acao: 'text-blue-600'
        }

    return (
      <>
        <div
          onClick={() => {
            if (!tarefa.concluida) {
              setSubtarefaSelecionada(tarefa)
              setMostrarCobrancaModal(true)
            }
          }}
          className={`
            group flex items-center gap-3 px-3 py-2 rounded-lg border transition-all cursor-pointer
            ${cores.bg} ${cores.border} ${!tarefa.concluida ? cores.hoverBorder : ''}
          `}
        >
          <div className={`
            w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center
            ${cores.iconBg}
          `}>
            {tarefa.concluida ? (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            ) : isConferencia ? (
              <ClipboardCheck className="w-3 h-3 text-white" />
            ) : (
              <RefreshCw className="w-3 h-3 text-white" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <span className={`text-xs ${cores.texto}`}>
              {tarefa.titulo}
            </span>
            <div className="flex gap-2 mt-0.5">
              {tarefa.dataInicio && (
                <span className="text-[10px] text-gray-400">
                  Início: {formatDateBR(tarefa.dataInicio)}
                </span>
              )}
              {tarefa.dataPrazo && (
                <span className={`text-[10px] ${isPast(tarefa.dataPrazo) && !tarefa.concluida ? 'text-red-500' : 'text-gray-400'}`}>
                  Prazo: {formatDateBR(tarefa.dataPrazo)}
                </span>
              )}
            </div>
            {tarefa.observacoes && (
              <p className={`text-[10px] mt-0.5 truncate ${isConferencia ? 'text-violet-600' : 'text-blue-600'}`}>{tarefa.observacoes}</p>
            )}
          </div>

          {!tarefa.concluida && (
            <span className={`text-xs font-medium ${cores.acao}`}>Clique para ação →</span>
          )}
        </div>

        {mostrarCobrancaModal && subtarefaSelecionada && (
  <CobrancaModal
    subtarefa={subtarefaSelecionada}
    onClose={() => {
      setMostrarCobrancaModal(false)
      setSubtarefaSelecionada(null)
    }}
    onUpdate={onUpdate}
    isProcuracaoAdm={isProcuracaoAdm}
    usuarios={usuarios}
  />
)}
      </>
    )
  }

  // Tarefa normal
  return (
    <div className="space-y-2">
      {/* Card da Tarefa */}
      <div
        className={`
          group flex items-center gap-3 px-3 py-2 rounded-lg border transition-all
          ${tarefa.concluida 
            ? 'bg-gray-50 border-gray-200' 
            : iniciada
              ? 'bg-blue-50 border-blue-200'
              : 'bg-white border-gray-200 hover:border-blue-300'
          }
          ${isTemporaria ? 'opacity-70' : ''}
        `}
      >
        {/* Checkbox/Status */}
        <div
          onClick={() => !isTemporaria && setExpandido(!expandido)}
          className={`
            w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center cursor-pointer transition-all
            ${tarefa.concluida 
              ? 'bg-emerald-500 border-emerald-500' 
              : iniciada
                ? 'bg-blue-100 border-blue-400'
                : 'border-gray-300 hover:border-blue-400'
            }
          `}
        >
          {tarefa.concluida ? (
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          ) : iniciada ? (
            <Play className="w-3 h-3 text-blue-500 fill-blue-500" />
          ) : null}
        </div>

        {/* Conteúdo */}
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpandido(!expandido)}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm ${tarefa.concluida ? 'text-gray-400' : 'text-gray-900'}`}>
              {tarefa.titulo}
            </span>
            {isTemporaria && <span className="text-xs text-gray-400 italic">(salvando...)</span>}
            
            {/* Datas e Status - na mesma linha */}
            {tarefa.dataInicio && (
              <span className="text-[10px] text-green-600">
                <CalendarCheck className="w-3 h-3 inline mr-0.5" />
                {formatDateBR(tarefa.dataInicio)}
              </span>
            )}
            {tarefa.dataPrazo && (
              <span className={`text-[10px] ${isPast(tarefa.dataPrazo) && !tarefa.concluida ? 'text-red-500' : 'text-gray-400'}`}>
                <CalendarClock className="w-3 h-3 inline mr-0.5" />
                {formatDateBR(tarefa.dataPrazo)}
              </span>
            )}
            {/* Badge de status */}
            {!isCobranca && (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${status.bg} ${status.text} ${status.border}`}>
                {status.label}
              </span>
            )}
          </div>

          {tarefa.observacoes && (
            <p className="text-[10px] text-gray-500 mt-0.5 truncate">
              <MessageSquare className="w-3 h-3 inline mr-0.5" />
              {tarefa.observacoes}
            </p>
          )}
        </div>

        {/* Ações rápidas */}
        {!isTemporaria && !tarefa.concluida && (
          <div className="flex items-center gap-1">
          </div>
        )}

        {/* Botão excluir */}
        {!isTemporaria && pode('tarefas.excluir') && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (confirm("Excluir esta tarefa?")) {
                onDelete(tarefa.id)
              }
            }}
            className="p-1 text-gray-400 hover:text-red-500 rounded opacity-0 group-hover:opacity-100 transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Seta expandir */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            setExpandido(!expandido)
          }}
          className="p-1 text-gray-400 hover:text-blue-500 rounded transition-all"
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${expandido ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Área expandida */}
      {expandido && !isTemporaria && (
        <div className="ml-6 animate-in slide-in-from-top-2 duration-200">
          <div className="bg-gray-50 rounded-lg p-3 space-y-3 border border-gray-100">
            {/* Alterar prazo */}
            {mostrarAlterarPrazo && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
                <label className="block text-xs font-medium text-amber-700">
                  Nova data de prazo:
                </label>
                <div className="flex gap-2 items-center">
                  <div className="flex-1">
                    <DatePickerField
                      value={novoPrazo}
                      onChange={(value) => setNovoPrazo(value)}
                      placeholder="Selecione a data"
                    />
                  </div>
                  <button
                    onClick={handleAlterarPrazo}
                    disabled={salvando || !novoPrazo}
                    className="px-4 h-[42px] text-sm text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-50 font-medium"
                  >
                    {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
                  </button>
                  <button
                    onClick={() => {
                      setMostrarAlterarPrazo(false)
                      setNovoPrazo("")
                    }}
                    className="px-4 h-[42px] text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {editando ? (
              <>
                <Input
                  value={editForm.titulo}
                  onChange={(e) => setEditForm({ ...editForm, titulo: e.target.value })}
                  className="bg-white text-sm"
                  placeholder="Nome da subtarefa"
                />
                <textarea
                  value={editForm.observacoes}
                  onChange={(e) => setEditForm({ ...editForm, observacoes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2}
                  placeholder="Observações..."
                />
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <Clock className="w-3 h-3" />
                    <span>Conclusão:</span>
                    <select
                      value={editForm.prazoCobranca}
                      onChange={(e) => setEditForm({ ...editForm, prazoCobranca: parseInt(e.target.value) })}
                      className="pl-1.5 pr-4 py-0.5 text-xs border border-gray-200 rounded-md bg-white appearance-none cursor-pointer"
                      style={selectStyleSmall}
                    >
                      <option value={1}>1 dia</option>
                      <option value={3}>3 dias</option>
                      <option value={5}>5 dias</option>
                      <option value={7}>7 dias</option>
                      <option value={10}>10 dias</option>
                    </select>
                  </div>
                  <div className="flex-1" />
                  <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditando(false)} className="h-7 text-xs">
                    Cancelar
                  </Button>
                  <Button size="sm" onClick={handleSalvar} disabled={salvando} className="h-7 text-xs bg-blue-600 hover:bg-blue-700">
                    {salvando ? <Loader2 className="w-3 h-3 animate-spin" /> : "Salvar"}
                  </Button>
                </div>
              </div>
              </>
            ) : (
              <>
                {/* Info da tarefa */}
                <div className="space-y-2">
                  {tarefa.descricao && (
                    <p className="text-xs text-gray-600">{tarefa.descricao}</p>
                  )}
                  
                  {tarefa.observacoes && (
                    <div className="p-2 bg-amber-50 rounded border border-amber-100">
                      <p className="text-xs text-amber-700">
                        <MessageSquare className="w-3 h-3 inline mr-1" />
                        {tarefa.observacoes}
                      </p>
                    </div>
                  )}
                  
                  <div className="flex items-center gap-2 flex-wrap">
  
                  {!tarefa.concluida && !iniciada && (
                  <div className="flex items-center gap-2 flex-wrap w-full">
                    {pode('tarefas.editar') && <button
                      onClick={() => setEditando(true)}
                      className="py-1.5 px-3 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                    >
                      Editar
                    </button>}
                    
                    {pode('tarefas.iniciar_concluir') && <button
                      onClick={handleIniciar}
                      disabled={iniciando}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-colors disabled:opacity-50 ml-auto"
                    >
                      {iniciando ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                      Iniciar
                    </button>}
                  </div>
                )}
                </div>
                    
                    {!tarefa.concluida && iniciada && (
  <div className="flex items-center gap-2 flex-wrap">
    {pode('tarefas.editar') && <button
      onClick={() => setEditando(true)}
      className="py-1.5 px-3 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
    >
      Editar
    </button>}
    
    {pode('tarefas.iniciar_concluir') && <div className="flex items-center gap-1 flex-wrap ml-auto">
      {/* Recebido */}
{!confirmandoRecebido ? (
  <button
    onClick={() => setConfirmandoRecebido(true)}
    disabled={concluindo}
    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors disabled:opacity-50"
    title="Documento recebido"
  >
    <CheckCircle2 className="w-3 h-3" />
    Recebido
  </button>
) : (
  <button
    onClick={() => {
      handleConcluirComStatus("recebido")
      setConfirmandoRecebido(false)
    }}
    disabled={concluindo}
    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50"
    title="Clique para confirmar"
  >
    {concluindo ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
    Confirmar?
  </button>
)}

{/* Não possui / Conferência */}
{isProcuracaoAdm ? (
  // Botão Conferência (estilo igual Aguardando)
  !mostrarOpcaoConferencia ? (
    <button
      onClick={() => setMostrarOpcaoConferencia(true)}
      disabled={concluindo}
      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-lg transition-colors disabled:opacity-50"
      title="Enviar para conferência"
    >
      <ClipboardCheck className="w-3 h-3" />
      Conferência
    </button>
  ) : (
    <div className="flex items-center gap-1 bg-violet-50 border border-violet-200 rounded-lg px-2 py-1">
      <select
        value={diasConferencia}
        onChange={(e) => setDiasConferencia(parseInt(e.target.value))}
        className="px-1 py-0.5 text-xs border-0 bg-transparent text-violet-700 focus:outline-none"
      >
        <option value={1}>1d</option>
        <option value={3}>3d</option>
        <option value={5}>5d</option>
        <option value={7}>7d</option>
        <option value={10}>10d</option>
      </select>
      <button
        onClick={handleConferencia}
        disabled={concluindo}
        className="px-2 py-0.5 text-xs font-medium text-white bg-violet-500 hover:bg-violet-600 rounded transition-colors disabled:opacity-50"
      >
        {concluindo ? <Loader2 className="w-3 h-3 animate-spin" /> : "OK"}
      </button>
      <button
        onClick={() => setMostrarOpcaoConferencia(false)}
        className="px-1 py-0.5 text-xs text-gray-500 hover:text-gray-700"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  )
) : (
  // Botão Não possui (mantém igual)
  !confirmandoNaoPossui ? (
    <button
      onClick={() => setConfirmandoNaoPossui(true)}
      disabled={concluindo}
      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded-lg transition-colors disabled:opacity-50"
      title="Cliente não possui o documento"
    >
      <FileX className="w-3 h-3" />
      Não possui
    </button>
  ) : (
    <button
      onClick={() => {
        handleConcluirComStatus("nao_possui")
        setConfirmandoNaoPossui(false)
      }}
      disabled={concluindo}
      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-gray-600 hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
      title="Clique para confirmar"
    >
      {concluindo ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileX className="w-3 h-3" />}
      Confirmar?
    </button>
  )
)}
      
      {!mostrarOpcaoAguardando ? (
        <button
          onClick={() => setMostrarOpcaoAguardando(true)}
          disabled={concluindo}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors disabled:opacity-50"
          title="Aguardando cliente - criar cobrança"
        >
          <RefreshCw className="w-3 h-3" />
          Aguardando
        </button>
      ) : (
        <div className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1">
          <select
            value={diasCobrancaAguardando}
            onChange={(e) => setDiasCobrancaAguardando(parseInt(e.target.value))}
            className="px-1 py-0.5 text-xs border-0 bg-transparent text-blue-700 focus:outline-none"
          >
            <option value={1}>1d</option>
            <option value={3}>3d</option>
            <option value={5}>5d</option>
            <option value={7}>7d</option>
            <option value={10}>10d</option>
          </select>
          <button
            onClick={handleAguardandoCliente}
            disabled={concluindo}
            className="px-2 py-0.5 text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 rounded transition-colors disabled:opacity-50"
          >
            {concluindo ? <Loader2 className="w-3 h-3 animate-spin" /> : "OK"}
          </button>
          <button
            onClick={() => setMostrarOpcaoAguardando(false)}
            className="px-1 py-0.5 text-xs text-gray-500 hover:text-gray-700"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      
      <button
        onClick={() => setMostrarAlterarPrazo(!mostrarAlterarPrazo)}
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors"
      >
        <Calendar className="w-3 h-3" />
        Prazo
      </button>
    </div>}
  </div>
)}
</div>

{/* Subtarefas de cobrança e conferência */}
              {subtarefas.length > 0 && (
                <div className="pt-2 border-t border-gray-200">
                  {/* Cobrança */}
                  {subtarefas.filter(s => s.tipoSubtarefa !== "CONFERENCIA").length > 0 && (
                    <>
                      <h5 className="text-[10px] font-medium text-gray-500 mb-2">Subtarefas de cobrança:</h5>
                      <div className="space-y-1 mb-3">
                        {subtarefas.filter(s => s.tipoSubtarefa !== "CONFERENCIA").map((sub) => (
                          <TarefaItem
                            key={sub.id}
                            tarefa={sub}
                            onDelete={() => {}}
                            onUpdate={() => {
                              fetchSubtarefas()
                              onUpdate()
                            }}
                            usuarios={usuarios}
                            isProcuracaoAdm={isProcuracaoAdm}
                          />
                        ))}
                      </div>
                    </>
                  )}
                  
                  {/* Conferência */}
                  {subtarefas.filter(s => s.tipoSubtarefa === "CONFERENCIA").length > 0 && (
                    <>
                      <h5 className="text-[10px] font-medium text-violet-500 mb-2">Conferências pendentes:</h5>
                      <div className="space-y-1">
                        {subtarefas.filter(s => s.tipoSubtarefa === "CONFERENCIA").map((sub) => (
                          <TarefaItem
                            key={sub.id}
                            tarefa={sub}
                            onDelete={() => {}}
                            onUpdate={() => {
                              fetchSubtarefas()
                              onUpdate()
                            }}
                            usuarios={usuarios}
                            isProcuracaoAdm={isProcuracaoAdm}
                          />
                        ))}
                      </div>
                    </>
                  )}
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
// COMPONENTE: AtividadeItem (Caio) - SEM marcar como concluída
// ==========================================
interface AtividadeItemProps {
  atividade: Tarefa
  onDelete: (id: number) => void
  onUpdate: () => void
  usuarios: Responsavel[]
  isProcuracaoAdm?: boolean
}

function AtividadeItem({ atividade, onDelete, onUpdate, usuarios, isProcuracaoAdm = false }: AtividadeItemProps) {
  const { pode } = usePermissoes()
  const [expandido, setExpandido] = useState(true)
  const [editando, setEditando] = useState(false)
  const [novaTarefa, setNovaTarefa] = useState("")
  const [criandoTarefa, setCriandoTarefa] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [tarefas, setTarefas] = useState<Tarefa[]>(atividade.subtarefas || [])
  const [editForm, setEditForm] = useState({
    titulo: atividade.titulo,
    descricao: atividade.descricao || "",
    prioridade: atividade.prioridade,
    dataPrazo: atividade.dataPrazo ? atividade.dataPrazo.split("T")[0] : "",
    responsavelId: atividade.responsavelId?.toString() || "",
    observacoes: atividade.observacoes || "",
    prazoCobranca: atividade.prazoCobranca || 5
  })

  const isTemporaria = atividade.id < 0

  const fetchTarefas = async () => {
    if (isTemporaria) return
    try {
      const response = await fetch(`/api/tarefas/${atividade.id}`)
      const data = await response.json()
      if (data.tarefa?.subtarefas) {
        setTarefas(data.tarefa.subtarefas)
      }
    } catch (error) {
      console.error("Erro ao buscar tarefas:", error)
    }
  }

  useEffect(() => {
    setTarefas(atividade.subtarefas || [])
  }, [atividade.subtarefas])

  const handleCriarTarefa = async () => {
    if (!novaTarefa.trim() || isTemporaria) return
    setCriandoTarefa(true)
    try {
      const response = await fetch(`/api/tarefas/${atividade.id}/subtarefas`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken")}`
        },
        body: JSON.stringify({ titulo: novaTarefa.trim() })
      })
      if (response.ok) {
        setNovaTarefa("")
        fetchTarefas()
        onUpdate()
      }
    } catch (error) {
      console.error("Erro ao criar tarefa:", error)
    } finally {
      setCriandoTarefa(false)
    }
  }

  const handleDeleteTarefa = async (tarefaId: number) => {
    try {
      const response = await fetch(`/api/tarefas/${tarefaId}`, { 
        method: "DELETE",
        headers: { "Authorization": `Bearer ${localStorage.getItem("authToken")}` }
      })
      if (response.ok) {
        setTarefas(prev => prev.filter(t => t.id !== tarefaId))
        onUpdate()
      }
    } catch (error) {
      console.error("Erro ao excluir tarefa:", error)
    }
  }

  const handleSalvar = async () => {
    if (isTemporaria) return
    setSalvando(true)
    try {
      const response = await fetch(`/api/tarefas/${atividade.id}`, {
        method: "PUT",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken")}`
        },
        body: JSON.stringify({
          titulo: editForm.titulo,
          descricao: editForm.descricao || null,
          prioridade: editForm.prioridade,
          dataPrazo: editForm.dataPrazo || null,
          responsavelId: editForm.responsavelId ? parseInt(editForm.responsavelId) : null,
          observacoes: editForm.observacoes || null,
          prazoCobranca: editForm.prazoCobranca
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

  const concluidasTarefas = tarefas.filter(t => t.concluida).length
  const temTarefas = tarefas.length > 0

  return (
    <div>
      {/* Card da Atividade - SEM checkbox de concluir */}
      <div
        className={`
          group flex items-center gap-3 px-4 py-3 rounded-xl border transition-all cursor-pointer
          bg-white border-gray-200 hover:border-blue-300
          ${isTemporaria ? 'opacity-70' : ''}
          ${expandido ? 'border-blue-400 shadow-sm' : ''}
        `}
        onClick={() => setExpandido(!expandido)}
      >
        {/* Ícone de pessoa/progresso */}
        <div className="w-7 h-7 rounded-full border-2 border-gray-300 flex-shrink-0 flex items-center justify-center bg-gray-50">
          {temTarefas ? (
            <span className="text-[10px] font-bold text-gray-500">{concluidasTarefas}/{tarefas.length}</span>
          ) : (
            <User className="w-3.5 h-3.5 text-gray-400" />
          )}
        </div>

        {/* Título e info */}
<div className="flex-1 min-w-0">
  <div className="flex items-center flex-wrap">
    <span className="text-sm font-medium text-gray-900">
      {atividade.titulo}
    </span>
    {isTemporaria && (
      <span className="ml-2 text-xs text-gray-400 italic">(salvando...)</span>
    )}
    {atividade.dataPrazo && (
  <span className={`ml-2 text-xs flex items-center gap-1 ${isPast(atividade.dataPrazo) ? 'text-red-500' : 'text-gray-400'}`}>
    <Calendar className="w-3 h-3" />
    {formatDateBR(atividade.dataPrazo)}
  </span>
)}
  </div>
  {atividade.observacoes && (
  <p className="text-[10px] text-gray-500 mt-0.5 truncate">
    <MessageSquare className="w-3 h-3 inline mr-0.5" />
    {atividade.observacoes}
  </p>
)}
</div>

        {/* Botão excluir */}
        {!isTemporaria && pode('tarefas.excluir') && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (confirm("Excluir esta atividade e todas as tarefas?")) {
                onDelete(atividade.id)
              }
            }}
            className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}

        {/* Seta expandir */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            setExpandido(!expandido)
          }}
          className="p-1.5 rounded-lg transition-all text-gray-400 hover:text-blue-500 hover:bg-blue-50"
        >
          <ChevronDown className={`w-5 h-5 transition-transform ${expandido ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Área expandida */}
      {expandido && !isTemporaria && (
        <div className="mt-2 ml-4 animate-in slide-in-from-top-2 duration-200">
          <div className="bg-gray-50 rounded-lg p-3 space-y-4">
            {editando ? (
              <>
                <Input
                  value={editForm.titulo}
                  onChange={(e) => setEditForm({ ...editForm, titulo: e.target.value })}
                  className="bg-white text-sm"
                  placeholder="Nome da atividade"
                />
                <textarea
                  value={editForm.observacoes}
                  onChange={(e) => setEditForm({ ...editForm, observacoes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2}
                  placeholder="Observações..."
                />
                <div className="flex justify-end gap-2">
                  <select
                    value={editForm.prioridade}
                    onChange={(e) => setEditForm({ ...editForm, prioridade: e.target.value })}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white h-[42px] appearance-none cursor-pointer"
                    style={selectStyle}
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
                  className={selectClass}
                  style={selectStyle}
                >
                  <option value="">Sem responsável</option>
                  {usuarios.map((u) => (
                    <option key={u.id} value={u.id}>{u.nome}</option>
                  ))}
                </select>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditando(false)} className="h-7 text-xs">
                    Cancelar
                  </Button>
                  <Button size="sm" onClick={handleSalvar} disabled={salvando} className="h-7 text-xs bg-blue-600 hover:bg-blue-700">
                    {salvando ? <Loader2 className="w-3 h-3 animate-spin" /> : "Salvar"}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  {atividade.observacoes && (
                    <div className="p-2 bg-amber-50 rounded-lg border border-amber-100">
                      <p className="text-xs text-amber-700">
                        <MessageSquare className="w-3 h-3 inline mr-1" />
                        {atividade.observacoes}
                      </p>
                    </div>
                  )}
                  
                  {/* Prioridade, datas e botão Editar - tudo junto */}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="px-2 py-0.5 rounded-full bg-white border text-gray-600">
                      {atividade.prioridade === "URGENTE" && "🔴 Urgente"}
                      {atividade.prioridade === "ALTA" && "🟠 Alta"}
                      {atividade.prioridade === "MEDIA" && "🟡 Média"}
                      {atividade.prioridade === "BAIXA" && "🟢 Baixa"}
                    </span>
                    {atividade.dataPrazo && (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border text-gray-600">
                        <Calendar className="w-3 h-3" />
                        {formatDateBR(atividade.dataPrazo)}
                      </span>
                    )}
                    {atividade.responsavel && (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border text-gray-600">
                        <User className="w-3 h-3" />
                        {atividade.responsavel.nome}
                      </span>
                    )}
                    {pode('tarefas.editar') && <button
                      onClick={() => setEditando(true)}
                      className="py-0.5 px-2 rounded-full text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200 transition-colors"
                    >
                      Editar
                    </button>}
                  </div>

              {/* Tarefas dentro da atividade */}
                <div className="pt-3 border-t border-gray-200">
                  <h4 className="text-xs font-medium text-gray-500 mb-2">Subtarefas</h4>
                  
                  {tarefas.length > 0 ? (
                    <div className="space-y-2 mb-3">
                      {tarefas.map((tarefa) => (
  <TarefaItem
    key={tarefa.id}
    tarefa={tarefa}
    onDelete={handleDeleteTarefa}
    onUpdate={() => {
      fetchTarefas()
      onUpdate()
    }}
    usuarios={usuarios}
    isProcuracaoAdm={isProcuracaoAdm}
  />
))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 mb-2">Nenhuma tarefa</p>
                  )}

                  {pode('tarefas.criar') && <div className="flex items-center gap-2">
                    <Input
                      placeholder="Adicionar subtarefa..."
                      value={novaTarefa}
                      onChange={(e) => setNovaTarefa(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !criandoTarefa) handleCriarTarefa()
                      }}
                      disabled={criandoTarefa}
                      className="flex-1 h-8 text-sm bg-white"
                    />
                    <Button
                      onClick={handleCriarTarefa}
                      disabled={criandoTarefa || !novaTarefa.trim()}
                      size="sm"
                      className="h-8 w-8 p-0 bg-blue-600 hover:bg-blue-700"
                    >
                      {criandoTarefa ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                    </Button>
                  </div>}
                </div>
              </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ==========================================
// COMPONENTE: Modal de Subtarefas (Atividades)
// ==========================================
interface SubtarefasModalProps {
  tarefa: Tarefa
  onClose: () => void
  onUpdate: () => void
  onSubtarefaToggle?: (subtarefaId: number, concluida: boolean) => void
  onSubtarefaAdd?: (subtarefa: Tarefa) => void
  onSubtarefaRemove?: (subtarefaId: number) => void
  usuarios: Responsavel[]
  pessoas?: Pessoa[]
  atividadeParaAbrir?: number | null  // ← Novo
  onAtividadeAberta?: () => void  // ← Novo
}

function SubtarefasModal({ tarefa, onClose, onUpdate, onSubtarefaToggle, onSubtarefaAdd, onSubtarefaRemove, usuarios, pessoas = [], atividadeParaAbrir, onAtividadeAberta }: SubtarefasModalProps) {
  const { pode } = usePermissoes()
  const [novaAtividade, setNovaAtividade] = useState("")
  const [criando, setCriando] = useState(false)
  const [editandoTitulo, setEditandoTitulo] = useState(false)
  const [tituloEditado, setTituloEditado] = useState(tarefa.titulo)
  const [salvandoTitulo, setSalvandoTitulo] = useState(false)
  const [mostrarSeletorPessoas, setMostrarSeletorPessoas] = useState(false)
  const [mostrarInputCustom, setMostrarInputCustom] = useState(false)
  const seletorPessoasRef = useRef<HTMLDivElement>(null)
  const [atividadesLocal, setAtividadesLocal] = useState<Tarefa[]>(tarefa.subtarefas || [])
  const [processando, setProcessando] = useState<Set<number>>(new Set())
  // ✅ NOVO: Estado para o modal de detalhe da tarefa (Nível 2)
  const [atividadeDetalhe, setAtividadeDetalhe] = useState<Tarefa | null>(null)

  // Auto-abrir atividade se vier da URL
  useEffect(() => {
    if (atividadeParaAbrir && atividadesLocal.length > 0) {
      // Primeiro tenta encontrar diretamente (é uma atividade nível 2)
      let atividade = atividadesLocal.find(a => a.id === atividadeParaAbrir)
      
      // Se não encontrou, procura nas subtarefas (é uma subtarefa nível 3)
      if (!atividade) {
        for (const atv of atividadesLocal) {
          const subtarefa = atv.subtarefas?.find(s => s.id === atividadeParaAbrir)
          if (subtarefa) {
            // Encontrou a subtarefa, abrir o modal da atividade pai
            atividade = atv
            break
          }
        }
      }
      
      if (atividade) {
        setAtividadeDetalhe(atividade)
        onAtividadeAberta?.()
      }
    }
  }, [atividadeParaAbrir, atividadesLocal])
  
  // ✅ NOVO: Verificar se é tarefa que precisa do seletor de pessoas
  const tituloLower = tarefa.titulo.toLowerCase()
  const tarefasComSeletorPessoas = [
    'documentos pessoais',
    'procuração administrativa',
    'procuracao administrativa',
    'procuração judicial',
    'procuracao judicial',
    'formulário consular',
    'formulario consular'
  ]
  const isDocumentosPessoais = tarefasComSeletorPessoas.some(t => tituloLower.includes(t))

  useEffect(() => {
    if (processando.size === 0) {
      setAtividadesLocal(tarefa.subtarefas || [])
    }
  }, [tarefa.subtarefas])

  // ✅ NOVO: Fechar seletor de pessoas ao clicar fora
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (seletorPessoasRef.current && !seletorPessoasRef.current.contains(event.target as Node)) {
        setMostrarSeletorPessoas(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  // ✅ NOVO: Criar atividade com nome da pessoa
  const handleCriarAtividadePessoa = async (pessoa: Pessoa) => {
    const titulo = pessoa.nome  // Apenas o nome da pessoa
    setMostrarSeletorPessoas(false)
    
    const tempId = -Date.now()
    const novaAtividadeTemp: Tarefa = {
      id: tempId,
      titulo,
      concluida: false,
      prioridade: "MEDIA",
      tarefaPaiId: tarefa.id
    }
    
    setAtividadesLocal(prev => [...prev, novaAtividadeTemp])
    onSubtarefaAdd?.(novaAtividadeTemp)

    setCriando(true)
    try {
      const response = await fetch(`/api/tarefas/${tarefa.id}/subtarefas`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken")}`
        },
        body: JSON.stringify({ titulo })
      })

      if (response.ok) {
        const data = await response.json()
        if (data.subtarefa) {
          setAtividadesLocal(prev => 
            prev.map(s => s.id === tempId ? data.subtarefa : s)
          )
        }
        onUpdate()
      } else {
        setAtividadesLocal(prev => prev.filter(s => s.id !== tempId))
        onSubtarefaRemove?.(tempId)
      }
    } catch (error) {
      setAtividadesLocal(prev => prev.filter(s => s.id !== tempId))
      onSubtarefaRemove?.(tempId)
      console.error("Erro ao criar atividade:", error)
    } finally {
      setCriando(false)
    }
  }

  // Calcula progresso baseado em todas as tarefas dentro das atividades
  const calcularProgresso = () => {
  let totalTarefas = 0
  let tarefasConcluidas = 0
  
  atividadesLocal.forEach(atividade => {
    // A atividade conta como tarefa (nível 2)
    totalTarefas += 1
    const tarefas = atividade.subtarefas || []
    
    // Subtarefas também contam (nível 3)
    tarefas.forEach(tarefa => {
      totalTarefas += 1
      if (tarefa.concluida) tarefasConcluidas += 1
      
      // Sub-subtarefas também contam (nível 4 - cobranças)
      const subSubtarefas = tarefa.subtarefas || []
      totalTarefas += subSubtarefas.length
      tarefasConcluidas += subSubtarefas.filter(s => s.concluida).length
    })
    
    // Verificar se atividade está efetivamente concluída
    const atividadeConcluida = atividade.concluida || 
      (tarefas.length > 0 && tarefas.every(t => {
        const subs = t.subtarefas || []
        return t.concluida || (subs.length > 0 && subs.every(s => s.concluida))
      }))
    if (atividadeConcluida) tarefasConcluidas += 1
  })
  
  return totalTarefas > 0 ? (tarefasConcluidas / totalTarefas) * 100 : 0
}
  
  const porcentagem = calcularProgresso()

  const handleCriarAtividade = async () => {
    if (!novaAtividade.trim()) return

    const tituloNovo = novaAtividade.trim()
    const tempId = -Date.now()
    
    const novaAtividadeTemp: Tarefa = {
      id: tempId,
      titulo: tituloNovo,
      concluida: false,
      prioridade: "MEDIA",
      tarefaPaiId: tarefa.id
    }
    
    setAtividadesLocal(prev => [...prev, novaAtividadeTemp])
    onSubtarefaAdd?.(novaAtividadeTemp)
    setNovaAtividade("")

    setCriando(true)
    try {
      const response = await fetch(`/api/tarefas/${tarefa.id}/subtarefas`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken")}`
        },
        body: JSON.stringify({ titulo: tituloNovo })
      })

      if (response.ok) {
        const data = await response.json()
        if (data.subtarefa) {
          setAtividadesLocal(prev => 
            prev.map(s => s.id === tempId ? data.subtarefa : s)
          )
        }
        onUpdate()
      } else {
        setAtividadesLocal(prev => prev.filter(s => s.id !== tempId))
        onSubtarefaRemove?.(tempId)
        setNovaAtividade(tituloNovo)
      }
    } catch (error) {
      setAtividadesLocal(prev => prev.filter(s => s.id !== tempId))
      onSubtarefaRemove?.(tempId)
      setNovaAtividade(tituloNovo)
      console.error("Erro ao criar atividade:", error)
    } finally {
      setCriando(false)
    }
  }

  const handleExcluirAtividade = async (atividadeId: number) => {
    if (atividadeId < 0) return
    
    const atividadeRemovida = atividadesLocal.find(s => s.id === atividadeId)
    
    setAtividadesLocal(prev => prev.filter(s => s.id !== atividadeId))
    onSubtarefaRemove?.(atividadeId)

    try {
      const response = await fetch(`/api/tarefas/${atividadeId}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${localStorage.getItem("authToken")}` }
      })

      if (!response.ok) {
        if (atividadeRemovida) {
          setAtividadesLocal(prev => [...prev, atividadeRemovida])
          onSubtarefaAdd?.(atividadeRemovida)
        }
      }
    } catch (error) {
      if (atividadeRemovida) {
        setAtividadesLocal(prev => [...prev, atividadeRemovida])
        onSubtarefaAdd?.(atividadeRemovida)
      }
      console.error("Erro ao excluir atividade:", error)
    }
  }

  const handleSalvarTitulo = async () => {
    if (!tituloEditado.trim()) return
    setSalvandoTitulo(true)
    try {
      const response = await fetch(`/api/tarefas/${tarefa.id}`, {
        method: "PUT",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken")}`
        },
        body: JSON.stringify({ titulo: tituloEditado.trim() })
      })

      if (response.ok) {
        setEditandoTitulo(false)
        onUpdate()
      } else {
        alert("Erro ao salvar título")
      }
    } catch (error) {
      console.error("Erro ao salvar:", error)
      alert("Erro ao salvar título")
    } finally {
      setSalvandoTitulo(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[10000] flex items-center justify-center p-4" onClick={onClose}>
      <div 
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 text-white bg-gradient-to-r from-gray-700 to-gray-800">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0 pr-4">
              {editandoTitulo ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={tituloEditado}
                    onChange={(e) => setTituloEditado(e.target.value)}
                    className="flex-1 bg-white/20 backdrop-blur border border-white/30 rounded-lg px-3 py-2 text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-white/50"
                    placeholder="Título da tarefa"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSalvarTitulo()
                      if (e.key === "Escape") { setEditandoTitulo(false); setTituloEditado(tarefa.titulo) }
                    }}
                  />
                  <button
                    onClick={handleSalvarTitulo}
                    disabled={salvandoTitulo}
                    className="p-2 hover:bg-white/20 rounded-full transition-colors"
                    title="Salvar"
                  >
                    {salvandoTitulo ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => { setEditandoTitulo(false); setTituloEditado(tarefa.titulo) }}
                    className="p-2 hover:bg-white/20 rounded-full transition-colors"
                    title="Cancelar"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold truncate">{tarefa.titulo}</h2>
                  {pode('tarefas.editar') && <button 
                    onClick={() => { setTituloEditado(tarefa.titulo); setEditandoTitulo(true) }}
                    className="p-1.5 hover:bg-white/20 rounded-full transition-colors flex-shrink-0"
                    title="Editar nome"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>}
                </div>
              )}
              <p className="text-gray-300 text-sm mt-1">
                {(() => {
                  let totalTarefas = 0
                  atividadesLocal.forEach(atividade => {
                    totalTarefas += 1  // A atividade (nível 2)
                    const subtarefas = atividade.subtarefas || []
                    subtarefas.forEach(sub => {
                      totalTarefas += 1  // Subtarefa (nível 3)
                      totalTarefas += (sub.subtarefas || []).length  // Sub-subtarefas (nível 4)
                    })
                  })
                  return totalTarefas === 0 
                    ? 'Nenhuma atividade' 
                    : `${totalTarefas} tarefa${totalTarefas !== 1 ? 's' : ''}`
                })()}
              </p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Barra de progresso */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-gray-300">Progresso</span>
              <span className="font-semibold">{Math.round(porcentagem)}%</span>
            </div>
            <div className="h-2 bg-white/20 rounded-full overflow-hidden relative">
              <div 
                className="absolute inset-y-0 left-0 bg-white rounded-full"
                style={{ 
                  width: `${porcentagem}%`,
                  transition: 'width 0.3s ease-out'
                }}
              />
            </div>
          </div>
        </div>



        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto">
            <div className="p-4">
              <div className="space-y-3">
                {atividadesLocal.map((atividade) => {
                  const isTemp = atividade.id < 0
                  const subs = atividade.subtarefas || []
                  const concluidasSubs = subs.filter(s => s.concluida).length
                  const totalSubs = subs.length
                  const atrasada = atividade.dataPrazo && isPast(atividade.dataPrazo) && !atividade.concluida
                  
                  // Calcula se está efetivamente concluída
                  const efetivamenteConcluida = atividade.concluida || 
                    (totalSubs > 0 && subs.every(s => s.concluida || (s.subtarefas && s.subtarefas.length > 0 && s.subtarefas.every(ss => ss.concluida))))

                  return (
                    <div
                      key={atividade.id}
                      onClick={() => {
                        if (!isTemp) setAtividadeDetalhe(atividade)
                      }}
                      className={`
                        group relative flex items-center gap-3 px-4 py-3 rounded-xl border transition-all cursor-pointer
                        ${efetivamenteConcluida
                          ? 'bg-gray-50 border-gray-200 opacity-70'
                          : atrasada
                            ? 'bg-white border-red-200 hover:border-red-300 hover:shadow-md hover:shadow-red-100/50'
                            : 'bg-white border-gray-200 hover:border-blue-300 hover:shadow-md hover:shadow-blue-100/50'
                        }
                        ${isTemp ? 'opacity-60' : ''}
                      `}
                    >
                      {/* Ícone de progresso ou status */}
                      <div className="flex-shrink-0">
                        {totalSubs > 0 ? (
                          <div className="w-9 h-9 rounded-full border-2 border-gray-200 flex items-center justify-center bg-gray-50">
                            <span className="text-[10px] font-bold text-gray-500">{concluidasSubs}/{totalSubs}</span>
                          </div>
                        ) : (
                          <div className={`w-9 h-9 rounded-full border-2 flex items-center justify-center
                            ${efetivamenteConcluida ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300 bg-gray-50 group-hover:border-blue-400'}
                          `}>
                            {efetivamenteConcluida ? (
                              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <User className="w-4 h-4 text-gray-400 group-hover:text-blue-400 transition-colors" />
                            )}
                          </div>
                        )}
                      </div>

                      {/* Conteúdo */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-medium ${efetivamenteConcluida ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                            {atividade.titulo}
                          </span>
                          {isTemp && <span className="text-xs text-gray-400 italic">(salvando...)</span>}
                        </div>
                        
                        {/* Info badges */}
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {atividade.dataPrazo && (
                            <span className={`text-[10px] flex items-center gap-0.5 ${atrasada ? 'text-red-500' : 'text-gray-400'}`}>
                              <Calendar className="w-3 h-3" />
                              {formatDateBR(atividade.dataPrazo)}
                            </span>
                          )}
                          {atividade.responsavel && (
                            <span className="text-[10px] flex items-center gap-0.5 text-gray-400">
                              <User className="w-3 h-3" />
                              {atividade.responsavel.nome}
                            </span>
                          )}
                          {atividade.observacoes && (
                            <span className="text-[10px] flex items-center gap-0.5 text-gray-400">
                              <MessageSquare className="w-3 h-3" />
                              {atividade.observacoes.substring(0, 30)}{atividade.observacoes.length > 30 ? '...' : ''}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Delete button */}
                      {!isTemp && pode('tarefas.excluir') && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (confirm("Excluir esta atividade e todas as tarefas?")) {
                              handleExcluirAtividade(atividade.id)
                            }
                          }}
                          className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}

                      {/* Arrow */}
                      <div className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 group-hover:text-blue-500 group-hover:bg-blue-50 transition-all">
                        <ChevronRight className="w-5 h-5" />
                      </div>
                    </div>
                  )
                })}

                {atividadesLocal.length === 0 && (
                  <div className="text-center py-8 text-gray-400">
                    <User className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Nenhuma atividade ainda</p>
                    <p className="text-xs mt-1">Adicione atividades (ex: nome da pessoa)</p>
                  </div>
                )}
              </div>
            </div>
        </div>

        {/* Footer */}
        {pode('tarefas.criar') && (
          <div className="border-t p-4 bg-gray-50" ref={seletorPessoasRef}>
            {isDocumentosPessoais && pessoas.length > 0 ? (
              // ✅ Footer especial para Documentos Pessoais
              <div className="relative">
                {mostrarInputCustom ? (
                  // Input para digitar manualmente
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Nome da atividade..."
                      value={novaAtividade}
                      onChange={(e) => setNovaAtividade(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !criando) handleCriarAtividade()
                        if (e.key === "Escape") {
                          setMostrarInputCustom(false)
                          setNovaAtividade("")
                        }
                      }}
                      disabled={criando}
                      className="flex-1 bg-white"
                      autoFocus
                    />
                    <Button
                      onClick={handleCriarAtividade}
                      disabled={criando || !novaAtividade.trim()}
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      {criando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    </Button>
                    <Button
                      onClick={() => {
                        setMostrarInputCustom(false)
                        setNovaAtividade("")
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  // Botão para abrir seletor
                  <button
                    onClick={() => setMostrarSeletorPessoas(!mostrarSeletorPessoas)}
                    disabled={criando}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-gray-200 rounded-xl text-left hover:border-blue-300 hover:shadow-sm transition-all disabled:opacity-50 group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                      <Plus className="h-4 w-4 text-blue-600" />
                    </div>
                    <span className="flex-1 text-gray-500 text-sm">Adicionar nova atividade...</span>
                    <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${mostrarSeletorPessoas ? 'rotate-180' : ''}`} />
                  </button>
                )}

                {/* Dropdown com pessoas */}
                {mostrarSeletorPessoas && !mostrarInputCustom && (
                  <div className="absolute bottom-full left-0 right-0 mb-2 bg-white border border-gray-200 rounded-xl shadow-lg z-50 max-h-72 overflow-y-auto">
                    {/* Requerentes */}
                    {pessoas.filter(p => p.tipo === 'REQUERENTE').length > 0 && (
                      <>
                        <div className="px-4 py-2 border-b border-gray-100">
                          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Requerentes</p>
                        </div>
                        {pessoas.filter(p => p.tipo === 'REQUERENTE').map((pessoa) => (
                          <button
                            key={`req-${pessoa.id}`}
                            onClick={() => handleCriarAtividadePessoa(pessoa)}
                            disabled={criando}
                            className="w-full px-4 py-3 text-left text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors disabled:opacity-50 flex items-center gap-3"
                          >
                            <User className="h-4 w-4 text-gray-300" />
                            {pessoa.nome}
                          </button>
                        ))}
                      </>
                    )}
                    
                    {/* Contratantes */}
                    {pessoas.filter(p => p.tipo === 'CONTRATANTE').length > 0 && (
                      <>
                        <div className="px-4 py-2 border-b border-gray-100 border-t">
                          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Contratantes</p>
                        </div>
                        {pessoas.filter(p => p.tipo === 'CONTRATANTE').map((pessoa) => (
                          <button
                            key={`cont-${pessoa.id}`}
                            onClick={() => handleCriarAtividadePessoa(pessoa)}
                            disabled={criando}
                            className="w-full px-4 py-3 text-left text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors disabled:opacity-50 flex items-center gap-3"
                          >
                            <User className="h-4 w-4 text-gray-300" />
                            {pessoa.nome}
                          </button>
                        ))}
                      </>
                    )}
                    
                    <div className="border-t border-gray-100" />
                    
                    {/* Opção para digitar manualmente */}
                    <button
                      onClick={() => {
                        setMostrarSeletorPessoas(false)
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
            ) : (
              // Footer padrão para outras tarefas
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Adicionar nova atividade..."
                  value={novaAtividade}
                  onChange={(e) => setNovaAtividade(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !criando) handleCriarAtividade()
                  }}
                  disabled={criando}
                  className="flex-1 bg-white"
                />
                <Button
                  onClick={handleCriarAtividade}
                  disabled={criando || !novaAtividade.trim()}
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {criando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ✅ NOVO: Modal de detalhe da atividade (Nível 2) */}
      {atividadeDetalhe && (
        <TarefaDetailModal
          tarefa={atividadeDetalhe}
          onClose={() => setAtividadeDetalhe(null)}
          onUpdate={() => {
            // Atualizar a atividade no estado local
            const fetchAtualizada = async () => {
              try {
                const response = await fetch(`/api/tarefas/${atividadeDetalhe.id}`)
                const data = await response.json()
                if (data.tarefa) {
                  setAtividadesLocal(prev => prev.map(a => 
                    a.id === atividadeDetalhe.id ? { ...a, ...data.tarefa } : a
                  ))
                  setAtividadeDetalhe(data.tarefa)
                }
              } catch (error) {
                console.error("Erro ao atualizar:", error)
              }
            }
            fetchAtualizada()
            onUpdate()
          }}
          usuarios={usuarios}
          isProcuracaoAdm={
            tarefa.titulo.toLowerCase().includes('procuração administrativa') || 
            tarefa.titulo.toLowerCase().includes('procuracao administrativa')
          }
        />
      )}

    </div>
  )
}

// ==========================================
// COMPONENTE PRINCIPAL: ProcessoTarefas (COM DRAG-AND-DROP)
// ==========================================
export function ProcessoTarefas({ processoId, pais, onUpdate, pessoas = [], tarefaPaiId, atividadeId }: ProcessoTarefasProps) {
  const [tarefas, setTarefas] = useState<Tarefa[]>([])
  const [loading, setLoading] = useState(true)
  const [novaTarefa, setNovaTarefa] = useState("")
  const [criando, setCriando] = useState(false)
  const [tarefaSelecionada, setTarefaSelecionada] = useState<Tarefa | null>(null)
  const [usuarios, setUsuarios] = useState<Responsavel[]>([])
  const [mostrarSeletor, setMostrarSeletor] = useState(false)
  const [mostrarInputCustom, setMostrarInputCustom] = useState(false)
  const seletorRef = useRef<HTMLDivElement>(null)
  
  const tarefasPreDefinidas = getTarefasPorPais(pais)
  const modalAbertoIdRef = useRef<number | null>(null)
  const [atividadeParaAbrir, setAtividadeParaAbrir] = useState<number | null>(null)

  const { pode } = usePermissoes()

  const [activeId, setActiveId] = useState<number | null>(null)

  const [dragCount, setDragCount] = useState(0)

  // ✅ NOVO: Configuração dos sensores para drag-and-drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Precisa arrastar 8px antes de ativar
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )
  
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (seletorRef.current && !seletorRef.current.contains(event.target as Node)) {
        setMostrarSeletor(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])
  
  const abrirModal = (tarefa: Tarefa) => {
    modalAbertoIdRef.current = tarefa.id
    setTarefaSelecionada(tarefa)
  }
  
  const fecharModal = () => {
    modalAbertoIdRef.current = null
    setTarefaSelecionada(null)
    fetchTarefas(false)
    onUpdate?.()
  }

  const fetchTarefas = async (atualizarModal = true) => {
    try {
      const response = await fetch(`/api/tarefas?processoId=${processoId}&apenasRaiz=true`)
      const data = await response.json()
      if (data.tarefas) {
        // Ordenar por campo 'ordem'
        const tarefasOrdenadas = data.tarefas.sort((a: Tarefa, b: Tarefa) => (a.ordem || 0) - (b.ordem || 0))
        setTarefas(tarefasOrdenadas)
        
        if (atualizarModal && modalAbertoIdRef.current !== null) {
          const atualizada = tarefasOrdenadas.find((t: Tarefa) => t.id === modalAbertoIdRef.current)
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

  const fetchUsuarios = async () => {
    try {
      const token = localStorage.getItem('authToken')
      const response = await fetch("/api/usuarios", {
        headers: { 'Authorization': `Bearer ${token}` }
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

const autoOpenDoneRef = useRef(false)

useEffect(() => {
  if (autoOpenDoneRef.current || tarefas.length === 0 || tarefaSelecionada) return
  
  // Prioridade 1: atividadeId (abre direto o modal da atividade)
  if (atividadeId) {
    const id = Number(atividadeId)
    
    // Procurar o container que contém essa atividade (nível 2)
    for (const container of tarefas) {
      const atividade = container.subtarefas?.find(s => s.id === id)
      if (atividade) {
        autoOpenDoneRef.current = true
        setAtividadeParaAbrir(id)
        abrirModal(container)
        return
      }
      
      // Se não encontrou, procurar nas subtarefas das atividades (nível 3)
      for (const atividade of container.subtarefas || []) {
        const subtarefa = atividade.subtarefas?.find(s => s.id === id)
        if (subtarefa) {
          // Encontrou no nível 3: abrir container e depois a atividade pai
          autoOpenDoneRef.current = true
          setAtividadeParaAbrir(atividade.id)  // Abrir a atividade pai (Elaine)
          abrirModal(container)
          return
        }
        
        // Se não encontrou, procurar nas sub-subtarefas (nível 4 - cobrança dentro de subtarefa)
        for (const subtarefa of atividade.subtarefas || []) {
          const subSubtarefa = subtarefa.subtarefas?.find(s => s.id === id)
          if (subSubtarefa) {
            // Encontrou no nível 4: abrir container e depois a atividade avô
            autoOpenDoneRef.current = true
            setAtividadeParaAbrir(atividade.id)  // Abrir a atividade (Elaine)
            abrirModal(container)
            return
          }
        }
      }
    }
  }
  
  // Prioridade 2: tarefaPaiId (comportamento antigo - abre o container)
  // ... resto do código
  
  // Prioridade 2: tarefaPaiId (comportamento antigo - abre o container)
  if (tarefaPaiId) {
    const id = Number(tarefaPaiId)
    
    let container = tarefas.find(t => t.id === id)
    
    if (!container) {
      container = tarefas.find(t => 
        t.subtarefas?.some(s => s.id === id)
      )
    }
    
    if (container) {
      autoOpenDoneRef.current = true
      abrirModal(container)
    }
  }
}, [tarefaPaiId, atividadeId, tarefas])

  const handleCriarTarefa = async (titulo?: string) => {
    const tituloFinal = titulo || novaTarefa.trim()
    if (!tituloFinal) return

    setCriando(true)
    setMostrarSeletor(false)
    setMostrarInputCustom(false)
    
    try {
      // ✅ Definir ordem baseada na posição no array de tarefas pré-definidas
      const indicePredefinido = tarefasPreDefinidas.findIndex(
        t => t.nome.toLowerCase() === tituloFinal.toLowerCase()
      )
      // Se está na lista, usa o índice. Se não, vai pro final (999+)
      const ordem = indicePredefinido >= 0 
        ? indicePredefinido 
        : 999 + tarefas.filter(t => (t.ordem || 0) >= 999).length
      
      const response = await fetch("/api/tarefas", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken")}`
        },
        body: JSON.stringify({ 
          titulo: tituloFinal, 
          processoId,
          ordem
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
  
  const handleSelecionarTarefaPreDefinida = (tarefa: TarefaPreDefinida) => {
    handleCriarTarefa(tarefa.nome)
  }

  const handleExcluir = async (tarefaId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm("Excluir esta tarefa e todas as subtarefas?")) return

    try {
      const response = await fetch(`/api/tarefas/${tarefaId}`, { 
        method: "DELETE",
        headers: { "Authorization": `Bearer ${localStorage.getItem("authToken")}` }
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

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as number)
  }

  // ✅ NOVO: Handler para quando termina de arrastar
  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveId(null)
    setDragCount(c => c + 1)
    if (!pode('tarefas.editar')) return
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = tarefas.findIndex((t) => t.id === active.id)
      const newIndex = tarefas.findIndex((t) => t.id === over.id)

      // Atualizar estado local imediatamente (otimista)
      const novaOrdem = arrayMove(tarefas, oldIndex, newIndex)
      setTarefas(novaOrdem)

      // Salvar no banco
      try {
        const tarefasComOrdem = novaOrdem.map((t, index) => ({
          id: t.id,
          ordem: index
        }))

        await fetch('/api/tarefas/reordenar', {
          method: 'PUT',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem("authToken")}`
          },
          body: JSON.stringify({ tarefas: tarefasComOrdem })
        })
      } catch (error) {
        console.error('Erro ao salvar ordem:', error)
        // Reverter em caso de erro
        fetchTarefas()
      }
    }
  }

  // Verifica se tarefa está efetivamente concluída (campo direto OU progresso 100%)
  const isTarefaEfetivamenteConcluida = (t: Tarefa): boolean => {
    if (t.concluida) return true

    const subs = t.subtarefas || []
    if (subs.length === 0) return false

    let total = 0
    let concluidas = 0

    subs.forEach(atividade => {
      total += 1
      const tarefasDaAtividade = atividade.subtarefas || []
      const atividadeConcluida = atividade.concluida || 
        (tarefasDaAtividade.length > 0 && tarefasDaAtividade.every(s => s.concluida))
      if (atividadeConcluida) concluidas += 1

      total += tarefasDaAtividade.length
      concluidas += tarefasDaAtividade.filter(s => s.concluida).length
    })

    return total > 0 && concluidas === total
  }

  const tarefasPendentes = tarefas.filter(t => !isTarefaEfetivamenteConcluida(t))
  const tarefasConcluidas = tarefas.filter(t => isTarefaEfetivamenteConcluida(t))

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header - MANTÉM "Tarefas" */}
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
      {pode('tarefas.criar') && <div className="p-4 border-b flex-shrink-0 bg-gray-50/50" ref={seletorRef}>
        <div className="relative">
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
                {criando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
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
              
              <div className="border-t border-gray-100" />
              
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
      </div>}

      {/* ✅ ATUALIZADO: Lista de tarefas com DnD Context */}
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
            {pode('tarefas.ver') ? (
              <>
                <p className="font-medium text-gray-600">Nenhuma tarefa ainda</p>
                <p className="text-sm text-gray-400 mt-1">
                  {pode('tarefas.criar') 
                    ? 'Adicione tarefas para acompanhar o progresso' 
                    : 'Nenhuma tarefa foi adicionada a este processo'}
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-gray-600">Acesso restrito</p>
                <p className="text-sm text-gray-400 mt-1">Você não tem permissão para visualizar tarefas</p>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* ✅ NOVO: Lista arrastável de tarefas pendentes */}
            <DndContext
              key={dragCount}
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis, restrictToParentElement]}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={tarefasPendentes.map(t => t.id)}
                strategy={verticalListSortingStrategy}
              >
                {tarefasPendentes.map(tarefa => (
                  <SortableTarefaCard
                    key={tarefa.id}
                    tarefa={tarefa}
                    onClick={() => abrirModal(tarefa)}
                    onDelete={(e) => handleExcluir(tarefa.id, e)}
                  />
                ))}
              </SortableContext>
              <DragOverlay>
                {activeId ? (() => {
                  const tarefa = tarefasPendentes.find(t => t.id === activeId)
                  return tarefa ? (
                    <TarefaCard
                      tarefa={tarefa}
                      onClick={() => {}}
                      onDelete={() => {}}
                    />
                  ) : null
                })() : null}
              </DragOverlay>
            </DndContext>

            {tarefasConcluidas.length > 0 && tarefasPendentes.length > 0 && (
              <div className="flex items-center gap-3 py-3">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs font-medium text-gray-400 bg-gray-50 px-3 py-1 rounded-full">
                  Concluídas ({tarefasConcluidas.length})
                </span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
            )}

            {/* Tarefas concluídas (sem drag) */}
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
          pessoas={pessoas}
          atividadeParaAbrir={atividadeParaAbrir}  // ← Novo
          onAtividadeAberta={() => setAtividadeParaAbrir(null)}  // ← Novo
        />
      )}
    </div>
  )
}
// src/components/kanban/TarefaDetailModal.tsx

"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import {
  X,
  Send,
  User,
  Calendar,
  Clock,
  MessageSquare,
  CheckCircle2,
  Play,
  RefreshCw,
  FileX,
  ClipboardCheck,
  CalendarCheck,
  CalendarClock,
  Loader2,
  ChevronDown,
  Flag,
  Pencil,
  Plus,
  Trash2,
  History,
  MessageCircle,
  ArrowRight,
  AlertCircle
} from "lucide-react"
import { isPast, formatDateBR } from "@/src/lib/date-utils"
import { usePermissoes } from "@/src/hooks/use-permissoes"

// ==========================================
// STYLES (reusados do ProcessoTarefas)
// ==========================================
const selectClass = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm h-[42px] appearance-none cursor-pointer"

const selectStyle = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center'
} as React.CSSProperties

// ==========================================
// TYPES
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
  statusTarefa?: string
  createdAt?: string
}

interface HistoricoEntry {
  id: number
  acao: string
  descricao: string
  dados?: any
  createdAt: string
  usuario?: { id: number; nome: string; email?: string }
  tarefa?: { id: number; titulo: string; tarefaPaiId?: number }
}

interface TarefaDetailModalProps {
  tarefa: Tarefa
  onClose: () => void
  onUpdate: () => void
  usuarios: Responsavel[]
  isProcuracaoAdm?: boolean
}

// ==========================================
// HELPER: Ícone e cor por tipo de ação
// ==========================================
function getAcaoConfig(acao: string) {
  switch (acao) {
    case "COMENTARIO":
      return { icon: MessageCircle, bg: "bg-blue-100", text: "text-blue-600", label: "Comentário" }
    case "CRIADA":
      return { icon: Plus, bg: "bg-green-100", text: "text-green-600", label: "Criada" }
    case "INICIADA":
      return { icon: Play, bg: "bg-amber-100", text: "text-amber-600", label: "Iniciada" }
    case "CONCLUIDA":
      return { icon: CheckCircle2, bg: "bg-emerald-100", text: "text-emerald-600", label: "Concluída" }
    case "COBRADA":
      return { icon: RefreshCw, bg: "bg-blue-100", text: "text-blue-600", label: "Cobrada" }
    case "AGUARDANDO_CLIENTE":
      return { icon: Clock, bg: "bg-amber-100", text: "text-amber-600", label: "Aguardando" }
    case "NAO_POSSUI":
      return { icon: FileX, bg: "bg-gray-100", text: "text-gray-600", label: "Não possui" }
    case "CONFERENCIA":
      return { icon: ClipboardCheck, bg: "bg-violet-100", text: "text-violet-600", label: "Conferência" }
    case "STATUS_ALTERADO":
      return { icon: ArrowRight, bg: "bg-purple-100", text: "text-purple-600", label: "Status alterado" }
    case "PRAZO_ALTERADO":
      return { icon: Calendar, bg: "bg-orange-100", text: "text-orange-600", label: "Prazo alterado" }
    default:
      return { icon: History, bg: "bg-gray-100", text: "text-gray-500", label: acao }
  }
}

// ==========================================
// HELPER: Formatar data relativa
// ==========================================
function formatRelativeDate(dateStr: string) {
  const date = new Date(dateStr)
  const day = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return `${day} às ${time}`
}

// ==========================================
// COMPONENTE: SubtarefaLine (simplificado para o modal)
// ==========================================
interface SubtarefaLineProps {
  tarefa: Tarefa
  onUpdate: () => void
  usuarios: Responsavel[]
  isProcuracaoAdm?: boolean
  mostrarBotaoIniciar?: boolean  // ← NOVO
}

function SubtarefaLine({ tarefa, onUpdate, usuarios, isProcuracaoAdm = false, mostrarBotaoIniciar = true }: SubtarefaLineProps) {
  const { pode } = usePermissoes()
  const [processando, setProcessando] = useState(false)
  const [expandido, setExpandido] = useState(false)
  const [editando, setEditando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [subtarefas, setSubtarefas] = useState<Tarefa[]>(tarefa.subtarefas || [])

  const [editForm, setEditForm] = useState({
    titulo: tarefa.titulo,
    prioridade: tarefa.prioridade,
    dataPrazo: tarefa.dataPrazo ? tarefa.dataPrazo.split("T")[0] : "",
    responsavelId: tarefa.responsavelId?.toString() || "",
    observacoes: tarefa.observacoes || "",
    prazoCobranca: tarefa.prazoCobranca || 5
  })

  const iniciada = !!tarefa.dataInicio
  const isCobranca = tarefa.tipoSubtarefa === "COBRANCA"
  const isConferencia = tarefa.tipoSubtarefa === "CONFERENCIA"

  useEffect(() => {
    setSubtarefas(tarefa.subtarefas || [])
  }, [tarefa.subtarefas])

  const fetchSubtarefas = async () => {
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

  const calcularStatus = () => {
    if (tarefa.concluida) {
      return { label: "Concluída", bg: "bg-emerald-50", text: "text-emerald-600", border: "border-emerald-200" }
    }
    if (!iniciada) {
      return { label: "Não iniciada", bg: "bg-gray-50", text: "text-gray-500", border: "border-gray-200" }
    }
    const cobrancaPendente = subtarefas.find(s => s.tipoSubtarefa === "COBRANCA" && !s.concluida)
    if (cobrancaPendente) {
      return { label: "Aguardando", bg: "bg-amber-50", text: "text-amber-600", border: "border-amber-200" }
    }
    return { label: "Em andamento", bg: "bg-blue-50", text: "text-blue-600", border: "border-blue-200" }
  }

  const status = calcularStatus()

  // Iniciar tarefa
  const handleIniciar = async () => {
    setProcessando(true)
    try {
      const response = await fetch(`/api/tarefas/${tarefa.id}/iniciar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prazoCobranca: editForm.prazoCobranca || 5 })
      })
      if (response.ok) {
        fetchSubtarefas()
        onUpdate()
      }
    } catch (error) {
      console.error("Erro ao iniciar:", error)
    } finally {
      setProcessando(false)
    }
  }

  // Concluir com status
  const handleConcluirComStatus = async (statusAcao: string) => {
    setProcessando(true)
    try {
      const cobrancaPendente = subtarefas.find(s => s.tipoSubtarefa === "COBRANCA" && !s.concluida)
      const idParaAcao = cobrancaPendente?.id || tarefa.id

      const response = await fetch(`/api/tarefas/${idParaAcao}/cobranca`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: statusAcao })
      })
      if (response.ok) {
        fetchSubtarefas()
        onUpdate()
      }
    } catch (error) {
      console.error("Erro:", error)
    } finally {
      setProcessando(false)
    }
  }

  // Aguardando cliente
  const handleAguardando = async (dias: number) => {
    setProcessando(true)
    try {
      const cobrancaPendente = subtarefas.find(s => s.tipoSubtarefa === "COBRANCA" && !s.concluida)
      const idParaAcao = cobrancaPendente?.id || tarefa.id

      const response = await fetch(`/api/tarefas/${idParaAcao}/cobranca`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "cobrado", observacao: "Aguardando cliente", diasCobranca: dias })
      })
      if (response.ok) {
        fetchSubtarefas()
        onUpdate()
      }
    } catch (error) {
      console.error("Erro:", error)
    } finally {
      setProcessando(false)
    }
  }

  // Salvar edição
  const handleSalvar = async () => {
    setSalvando(true)
    try {
      const response = await fetch(`/api/tarefas/${tarefa.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo: editForm.titulo,
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

  // Render subtarefa de cobrança/conferência (compacto)
  if (isCobranca || isConferencia) {
    const cores = isConferencia
      ? { bg: tarefa.concluida ? 'bg-gray-50' : 'bg-violet-50', border: tarefa.concluida ? 'border-gray-200' : 'border-violet-200', text: tarefa.concluida ? 'text-gray-400 line-through' : 'text-violet-800' }
      : { bg: tarefa.concluida ? 'bg-gray-50' : 'bg-blue-50', border: tarefa.concluida ? 'border-gray-200' : 'border-blue-200', text: tarefa.concluida ? 'text-gray-400 line-through' : 'text-blue-800' }

    return (
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${cores.bg} ${cores.border}`}>
        <div className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center ${tarefa.concluida ? 'bg-emerald-500' : isConferencia ? 'bg-violet-400' : 'bg-blue-400'}`}>
          {tarefa.concluida ? (
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
          ) : isConferencia ? (
            <ClipboardCheck className="w-2.5 h-2.5 text-white" />
          ) : (
            <RefreshCw className="w-2.5 h-2.5 text-white" />
          )}
        </div>
        <span className={`flex-1 ${cores.text}`}>{tarefa.titulo}</span>
        {tarefa.dataPrazo && (
          <span className={`text-[10px] ${isPast(tarefa.dataPrazo) && !tarefa.concluida ? 'text-red-500' : 'text-gray-400'}`}>
            {formatDateBR(tarefa.dataPrazo)}
          </span>
        )}
      </div>
    )
  }

  // Tarefa normal
  return (
    <div className="space-y-1">
      <div
        className={`
          group flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all
          ${tarefa.concluida ? 'bg-gray-50 border-gray-200' : iniciada ? 'bg-blue-50/50 border-blue-200' : 'bg-white border-gray-200 hover:border-blue-300'}
        `}
      >
        {/* Status circle */}
        <div className={`
          w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center
          ${tarefa.concluida ? 'bg-emerald-500 border-emerald-500' : iniciada ? 'bg-blue-100 border-blue-400' : 'border-gray-300'}
        `}>
          {tarefa.concluida ? (
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
          ) : iniciada ? (
            <Play className="w-3 h-3 text-blue-500 fill-blue-500" />
          ) : null}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpandido(!expandido)}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm ${tarefa.concluida ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
              {tarefa.titulo}
            </span>
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${status.bg} ${status.text} ${status.border}`}>
              {status.label}
            </span>
            {tarefa.dataPrazo && (
              <span className={`text-[10px] flex items-center gap-0.5 ${isPast(tarefa.dataPrazo) && !tarefa.concluida ? 'text-red-500' : 'text-gray-400'}`}>
                <CalendarClock className="w-3 h-3" />
                {formatDateBR(tarefa.dataPrazo)}
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

        {/* Actions */}
        {!tarefa.concluida && !iniciada && mostrarBotaoIniciar && (
          <button
            onClick={handleIniciar}
            disabled={processando}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-colors disabled:opacity-50"
          >
            {processando ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Iniciar
          </button>
        )}

        {!tarefa.concluida && iniciada && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => handleConcluirComStatus("recebido")}
              disabled={processando}
              className="px-2 py-1 text-[10px] font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md transition-colors disabled:opacity-50"
              title="Recebido"
            >
              <CheckCircle2 className="w-3 h-3" />
            </button>
            <button
              onClick={() => handleAguardando(5)}
              disabled={processando}
              className="px-2 py-1 text-[10px] font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md transition-colors disabled:opacity-50"
              title="Aguardando (5 dias)"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
            {isProcuracaoAdm ? (
              <button
                onClick={() => handleConcluirComStatus("conferencia")}
                disabled={processando}
                className="px-2 py-1 text-[10px] font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-md transition-colors disabled:opacity-50"
                title="Conferência"
              >
                <ClipboardCheck className="w-3 h-3" />
              </button>
            ) : (
              <button
                onClick={() => handleConcluirComStatus("nao_possui")}
                disabled={processando}
                className="px-2 py-1 text-[10px] font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded-md transition-colors disabled:opacity-50"
                title="Não possui"
              >
                <FileX className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {/* Delete button */}
        {pode('tarefas.excluir') && <button
          onClick={async () => {
            if (!confirm("Excluir esta subtarefa?")) return
            try {
              const response = await fetch(`/api/tarefas/${tarefa.id}`, { method: "DELETE" })
              if (response.ok) onUpdate()
            } catch (error) {
              console.error("Erro ao excluir:", error)
            }
          }}
          className="p-1 text-gray-400 hover:text-red-500 rounded transition-all opacity-0 group-hover:opacity-100"
        >
          <Trash2 className="w-4 h-4" />
        </button>
        }

        {/* Expand toggle */}
        <button
          onClick={() => setExpandido(!expandido)}
          className="p-1 text-gray-400 hover:text-blue-500 rounded transition-all"
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${expandido ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Expanded details */}
      {expandido && (
        <div className="ml-9 space-y-2 animate-in slide-in-from-top-2 duration-200">
          {editando ? (
            <div className="bg-gray-50 rounded-lg p-3 space-y-2 border border-gray-100">
              <Input value={editForm.titulo} onChange={(e) => setEditForm({...editForm, titulo: e.target.value})} className="bg-white text-sm" placeholder="Nome" />
              <textarea value={editForm.observacoes} onChange={(e) => setEditForm({...editForm, observacoes: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" rows={2} placeholder="Observações..." />
              <div className="flex gap-2">
                <select value={editForm.prioridade} onChange={(e) => setEditForm({...editForm, prioridade: e.target.value})} className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-xs bg-white appearance-none cursor-pointer" style={selectStyle}>
                  <option value="BAIXA">🟢 Baixa</option>
                  <option value="MEDIA">🟡 Média</option>
                  <option value="ALTA">🟠 Alta</option>
                  <option value="URGENTE">🔴 Urgente</option>
                </select>
                <select value={editForm.responsavelId} onChange={(e) => setEditForm({...editForm, responsavelId: e.target.value})} className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-xs bg-white appearance-none cursor-pointer" style={selectStyle}>
                  <option value="">Sem responsável</option>
                  {usuarios.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEditando(false)} className="h-7 text-xs">Cancelar</Button>
                <Button size="sm" onClick={handleSalvar} disabled={salvando} className="h-7 text-xs bg-blue-600 hover:bg-blue-700">
                  {salvando ? <Loader2 className="w-3 h-3 animate-spin" /> : "Salvar"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => setEditando(true)} className="px-2 py-1 rounded text-[10px] font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
                Editar
              </button>
              {tarefa.responsavel && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-white border text-[10px] text-gray-600">
                  <User className="w-3 h-3" /> {tarefa.responsavel.nome}
                </span>
              )}
            </div>
          )}

          {/* Cobrança subtarefas */}
          {subtarefas.length > 0 && (
            <div className="space-y-1">
              {subtarefas.map(sub => (
                <SubtarefaLine key={sub.id} tarefa={sub} onUpdate={() => { fetchSubtarefas(); onUpdate() }} usuarios={usuarios} isProcuracaoAdm={isProcuracaoAdm} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ==========================================
// COMPONENTE PRINCIPAL: TarefaDetailModal
// ==========================================
export function TarefaDetailModal({ tarefa, onClose, onUpdate, usuarios, isProcuracaoAdm = false }: TarefaDetailModalProps) {
  const { pode } = usePermissoes()
  const [editandoTitulo, setEditandoTitulo] = useState(false)
  const [tituloEditado, setTituloEditado] = useState(tarefa.titulo)
  const [salvandoTitulo, setSalvandoTitulo] = useState(false)

  // Subtarefas
  const [subtarefas, setSubtarefas] = useState<Tarefa[]>(tarefa.subtarefas || [])
  const [novaTarefa, setNovaTarefa] = useState("")
  const [criandoTarefa, setCriandoTarefa] = useState(false)

  // Edição de campos
  const [editandoCampos, setEditandoCampos] = useState(false)
  const [salvandoCampos, setSalvandoCampos] = useState(false)
  const [editForm, setEditForm] = useState({
    prioridade: tarefa.prioridade || "MEDIA",
    dataPrazo: tarefa.dataPrazo ? tarefa.dataPrazo.split("T")[0] : "",
    responsavelId: tarefa.responsavelId?.toString() || "",
    observacoes: tarefa.observacoes || ""
  })

  // Histórico
  const [historico, setHistorico] = useState<HistoricoEntry[]>([])
  const [loadingHistorico, setLoadingHistorico] = useState(true)
  const [novoComentario, setNovoComentario] = useState("")
  const [enviandoComentario, setEnviandoComentario] = useState(false)
  const feedRef = useRef<HTMLDivElement>(null)

  // Progresso
  const calcularProgresso = () => {
    let total = 0, concluidas = 0
    subtarefas.forEach(sub => {
      total += 1
      const subs = sub.subtarefas || []
      const subConcluida = sub.concluida || (subs.length > 0 && subs.every(s => s.concluida))
      if (subConcluida) concluidas += 1
      total += subs.length
      concluidas += subs.filter(s => s.concluida).length
    })
    return total > 0 ? (concluidas / total) * 100 : 0
  }
  const porcentagem = calcularProgresso()

  // Fetch subtarefas atualizadas
  const fetchSubtarefas = async () => {
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

  // Fetch histórico
  const fetchHistorico = async () => {
    try {
      const response = await fetch(`/api/tarefas/${tarefa.id}/historico`)
      const data = await response.json()
      if (data.historico) {
        setHistorico(data.historico)
      }
    } catch (error) {
      console.error("Erro ao buscar histórico:", error)
    } finally {
      setLoadingHistorico(false)
    }
  }

  useEffect(() => {
    fetchSubtarefas()
    fetchHistorico()
  }, [tarefa.id])

  useEffect(() => {
    setSubtarefas(tarefa.subtarefas || [])
  }, [tarefa.subtarefas])

  // Salvar título
  const handleSalvarTitulo = async () => {
    if (!tituloEditado.trim()) return
    setSalvandoTitulo(true)
    try {
      const response = await fetch(`/api/tarefas/${tarefa.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo: tituloEditado.trim() })
      })
      if (response.ok) {
        setEditandoTitulo(false)
        onUpdate()
      }
    } catch (error) {
      console.error("Erro ao salvar título:", error)
    } finally {
      setSalvandoTitulo(false)
    }
  }

  // Salvar campos editados
  const handleSalvarCampos = async () => {
    setSalvandoCampos(true)
    try {
      const response = await fetch(`/api/tarefas/${tarefa.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prioridade: editForm.prioridade,
          dataPrazo: editForm.dataPrazo || null,
          responsavelId: editForm.responsavelId ? parseInt(editForm.responsavelId) : null,
          observacoes: editForm.observacoes || null
        })
      })
      if (response.ok) {
        setEditandoCampos(false)
        onUpdate()
      }
    } catch (error) {
      console.error("Erro ao salvar:", error)
    } finally {
      setSalvandoCampos(false)
    }
  }

  // Criar subtarefa
  const handleCriarTarefa = async () => {
    if (!novaTarefa.trim()) return
    setCriandoTarefa(true)
    try {
      const response = await fetch(`/api/tarefas/${tarefa.id}/subtarefas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo: novaTarefa.trim() })
      })
      if (response.ok) {
        setNovaTarefa("")
        fetchSubtarefas()
        fetchHistorico()   // ← ADICIONA ESTA LINHA
        onUpdate()
      }
    } catch (error) {
      console.error("Erro ao criar subtarefa:", error)
    } finally {
      setCriandoTarefa(false)
    }
  }

  // Excluir subtarefa
  const handleExcluirSubtarefa = async (id: number) => {
    if (!confirm("Excluir esta subtarefa?")) return
    try {
      const response = await fetch(`/api/tarefas/${id}`, { method: "DELETE" })
      if (response.ok) {
        fetchSubtarefas()
        onUpdate()
      }
    } catch (error) {
      console.error("Erro ao excluir:", error)
    }
  }

  // Enviar comentário
  const handleEnviarComentario = async () => {
    if (!novoComentario.trim()) return
    setEnviandoComentario(true)
    try {
        // Pegar usuário logado do localStorage
        let usuarioId: number | null = null
        try {
        const storedUser = localStorage.getItem('user')
        if (storedUser) {
            const userData = JSON.parse(storedUser)
            usuarioId = userData.id || null
        }
        } catch {}

      const response = await fetch(`/api/tarefas/${tarefa.id}/historico`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          texto: novoComentario.trim(),
          usuarioId,
          acao: "COMENTARIO"
        })
      })
      if (response.ok) {
        setNovoComentario("")
        // Reset textarea height
        const textarea = document.querySelector('.comment-textarea') as HTMLTextAreaElement
        if (textarea) textarea.style.height = 'auto'
        fetchHistorico()
        // Scroll to top do feed (newest first)
        if (feedRef.current) {
          feedRef.current.scrollTop = 0
        }
        // Reset textarea height
        const ta = document.querySelector('textarea[placeholder="Escreva um comentário..."]') as HTMLTextAreaElement
        if (ta) ta.style.height = 'auto'
      }
    } catch (error) {
      console.error("Erro ao enviar comentário:", error)
    } finally {
      setEnviandoComentario(false)
    }
  }

  // Prioridade config
  const prioridadeConfig: Record<string, { emoji: string; label: string; color: string }> = {
    URGENTE: { emoji: "🔴", label: "Urgente", color: "text-red-600" },
    ALTA: { emoji: "🟠", label: "Alta", color: "text-orange-600" },
    MEDIA: { emoji: "🟡", label: "Média", color: "text-amber-600" },
    BAIXA: { emoji: "🟢", label: "Baixa", color: "text-emerald-600" },
  }

  const prioridade = prioridadeConfig[tarefa.prioridade] || prioridadeConfig.MEDIA

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[10001] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ====== HEADER ====== */}
        <div className="px-6 py-4 border-b bg-white flex-shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0 pr-4">
              {editandoTitulo ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={tituloEditado}
                    onChange={(e) => setTituloEditado(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg font-semibold"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSalvarTitulo()
                      if (e.key === "Escape") { setEditandoTitulo(false); setTituloEditado(tarefa.titulo) }
                    }}
                  />
                  <button onClick={handleSalvarTitulo} disabled={salvandoTitulo} className="p-2 hover:bg-gray-100 rounded-lg">
                    {salvandoTitulo ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4 text-blue-600" />}
                  </button>
                  <button onClick={() => { setEditandoTitulo(false); setTituloEditado(tarefa.titulo) }} className="p-2 hover:bg-gray-100 rounded-lg">
                    <X className="w-4 h-4 text-gray-400" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-gray-900 truncate">{tarefa.titulo}</h2>
                  <button onClick={() => { setTituloEditado(tarefa.titulo); setEditandoTitulo(true) }} className="p-1.5 hover:bg-gray-100 rounded-lg flex-shrink-0">
                    <Pencil className="w-4 h-4 text-gray-400" />
                  </button>
                </div>
              )}

              {/* Progress bar */}
              <div className="mt-3 flex items-center gap-3">
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${porcentagem}%` }} />
                </div>
                <span className="text-sm font-semibold text-gray-600">{Math.round(porcentagem)}%</span>
                <span className="text-xs text-gray-400">
                  {(() => {
                    let total = 0
                    subtarefas.forEach(sub => {
                      total += 1  // A subtarefa (nível 3)
                      total += (sub.subtarefas || []).length  // Sub-subtarefas (nível 4 - cobranças)
                    })
                    return `${total} subtarefa${total !== 1 ? 's' : ''}`
                  })()}
                </span>
              </div>
            </div>

            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>
        </div>

        {/* ====== BODY - TWO COLUMNS ====== */}
        <div className="flex-1 flex overflow-hidden min-h-0">

          {/* ===== LEFT COLUMN - TASK INFO & SUBTASKS ===== */}
          <div className="flex-1 overflow-y-auto border-r">
            <div className="p-6 space-y-6">

              {/* Campos da tarefa */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Detalhes</h3>
                  {!editandoCampos ? (
                    <button onClick={() => setEditandoCampos(true)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                      Editar
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => setEditandoCampos(false)} className="text-xs text-gray-500 hover:text-gray-700">Cancelar</button>
                      <button onClick={handleSalvarCampos} disabled={salvandoCampos} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                        {salvandoCampos ? "Salvando..." : "Salvar"}
                      </button>
                    </div>
                  )}
                </div>

                {editandoCampos ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">Prioridade</label>
                        <select value={editForm.prioridade} onChange={(e) => setEditForm({...editForm, prioridade: e.target.value})} className={selectClass} style={selectStyle}>
                          <option value="BAIXA">🟢 Baixa</option>
                          <option value="MEDIA">🟡 Média</option>
                          <option value="ALTA">🟠 Alta</option>
                          <option value="URGENTE">🔴 Urgente</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">Responsável</label>
                        <select value={editForm.responsavelId} onChange={(e) => setEditForm({...editForm, responsavelId: e.target.value})} className={selectClass} style={selectStyle}>
                          <option value="">Sem responsável</option>
                          {usuarios.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Prazo</label>
                      <DatePickerField value={editForm.dataPrazo || undefined} onChange={(v) => setEditForm({...editForm, dataPrazo: v})} placeholder="Selecione o prazo" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Observações</label>
                      <textarea value={editForm.observacoes} onChange={(e) => setEditForm({...editForm, observacoes: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" rows={3} placeholder="Observações da tarefa..." />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                    <div>
                      <span className="text-[10px] text-gray-400 uppercase">Prioridade</span>
                      <p className={`text-sm font-medium ${prioridade.color}`}>{prioridade.emoji} {prioridade.label}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-gray-400 uppercase">Responsável</span>
                      <p className="text-sm font-medium text-gray-900">
                        {tarefa.responsavel?.nome || <span className="text-gray-400">Não atribuído</span>}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-gray-400 uppercase">Prazo</span>
                      <p className={`text-sm font-medium ${tarefa.dataPrazo && isPast(tarefa.dataPrazo) ? 'text-red-500' : 'text-gray-900'}`}>
                        {tarefa.dataPrazo ? formatDateBR(tarefa.dataPrazo) : <span className="text-gray-400">Sem prazo</span>}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-gray-400 uppercase">Criada em</span>
                      <p className="text-sm font-medium text-gray-900">
                        {tarefa.createdAt ? formatDateBR(tarefa.createdAt) : "—"}
                      </p>
                    </div>
                    {tarefa.observacoes && (
                      <div className="col-span-2">
                        <span className="text-[10px] text-gray-400 uppercase">Observações</span>
                        <p className="text-sm text-gray-700 mt-0.5 bg-amber-50 rounded-lg p-2 border border-amber-100">
                          {tarefa.observacoes}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="border-t border-gray-200" />

              {/* Subtarefas */}
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Subtarefas ({subtarefas.length})
                </h3>

                {subtarefas.length > 0 ? (
                  <div className="space-y-2">
                    {subtarefas.map((sub, index) => {
                      // Mostrar "Iniciar" só na primeira subtarefa não iniciada,
                      // e somente se nenhuma outra está EM ANDAMENTO (iniciada e não concluída)
                      const algumaEmAndamento = subtarefas.some(s => !!s.dataInicio && !s.concluida)
                      const primeiraNaoIniciada = subtarefas.findIndex(s => !s.dataInicio && !s.concluida)
                      const mostrarIniciar = !algumaEmAndamento && index === primeiraNaoIniciada

                      return (
                        <SubtarefaLine
                          key={sub.id}
                          tarefa={sub}
                          onUpdate={() => { fetchSubtarefas(); fetchHistorico(); onUpdate() }}
                          usuarios={usuarios}
                          isProcuracaoAdm={isProcuracaoAdm}
                          mostrarBotaoIniciar={mostrarIniciar}
                        />
                      )
                    })}
                  </div>
                ) : (
                  <div className="text-center py-6 text-gray-400">
                    <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Nenhuma subtarefa ainda</p>
                  </div>
                )}

                {/* Add subtarefa */}
                {pode('tarefas.criar') && <div className="flex items-center gap-2 mt-3">
                  <Input
                    placeholder="Adicionar subtarefa..."
                    value={novaTarefa}
                    onChange={(e) => setNovaTarefa(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !criandoTarefa) handleCriarTarefa() }}
                    disabled={criandoTarefa}
                    className="flex-1 h-9 text-sm"
                  />
                  <Button onClick={handleCriarTarefa} disabled={criandoTarefa || !novaTarefa.trim()} size="sm" className="h-9 bg-blue-600 hover:bg-blue-700">
                    {criandoTarefa ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  </Button>
                </div>
                }
              </div>
            </div>
          </div>

          {/* ===== RIGHT COLUMN - ACTIVITY FEED ===== */}
          <div className="w-[380px] flex-shrink-0 flex flex-col bg-gray-50/50">
            {/* Feed header */}
            <div className="px-4 py-3 border-b bg-white flex-shrink-0">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
                <History className="w-4 h-4" />
                Atividade
              </h3>
            </div>

            {/* Comment input */}
            <div className="px-4 py-3 border-b bg-white flex-shrink-0">
              <div className="flex items-center gap-2">
                <textarea
                    value={novoComentario}
                    onChange={(e) => setNovoComentario(e.target.value)}
                    placeholder="Escreva um comentário..."
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-h-[38px] max-h-[120px]"                    rows={1}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        handleEnviarComentario()
                      }
                    }}
                    onInput={(e) => {
                      const target = e.target as HTMLTextAreaElement
                      target.style.height = 'auto'
                      target.style.height = Math.min(target.scrollHeight, 120) + 'px'
                    }}
                />
                <button
                    onClick={handleEnviarComentario}
                    disabled={enviandoComentario || !novoComentario.trim()}
                    className="self-center p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {enviandoComentario ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Feed content */}
            <div ref={feedRef} className="flex-1 overflow-y-auto">
              {loadingHistorico ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : historico.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <MessageCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Nenhuma atividade ainda</p>
                  <p className="text-xs mt-1">Comentários e ações aparecerão aqui</p>
                </div>
              ) : (
                <div className="px-4 py-3 space-y-1">
                  {historico.map((entry, index) => {
                    const config = getAcaoConfig(entry.acao)
                    const Icon = config.icon
                    const isComentario = entry.acao === "COMENTARIO"
                    const isSubtarefa = entry.tarefa && entry.tarefa.tarefaPaiId === tarefa.id

                    return (
                      <div key={entry.id} className={`group ${isComentario ? 'py-3' : 'py-2'}`}>
                        <div className="flex gap-3">
                          {/* Avatar/Icon */}
                          <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center ${config.bg}`}>
                            {isComentario && entry.usuario ? (
                              <span className={`text-xs font-bold ${config.text}`}>
                                {entry.usuario.nome.charAt(0).toUpperCase()}
                              </span>
                            ) : (
                              <Icon className={`w-4 h-4 ${config.text}`} />
                            )}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              {entry.usuario && (
                                <span className="text-xs font-semibold text-gray-800">{entry.usuario.nome}</span>
                              )}
                              {!isComentario && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${config.bg} ${config.text}`}>
                                  {config.label}
                                </span>
                              )}
                              <span className="text-[10px] text-gray-400">{formatRelativeDate(entry.createdAt)}</span>
                            </div>

                            {isComentario ? (
                              <div className="mt-1 p-3 bg-white rounded-lg border border-gray-200 shadow-sm">
                                <p className="text-sm text-gray-700 whitespace-pre-wrap">{entry.descricao}</p>
                              </div>
                            ) : (
                              <p className="text-xs text-gray-600 mt-0.5">
                                {entry.descricao}
                                {isSubtarefa && entry.tarefa && (
                                  <span className="text-gray-400 ml-1">
                                    em "{entry.tarefa.titulo}"
                                  </span>
                                )}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Divider */}
                        {index < historico.length - 1 && (
                          <div className="ml-4 mt-2 border-l-2 border-gray-100 h-2" />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
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
const selectClass = "w-full px-3 py-2 border border-white/15 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#7dd3fc]/25 focus:border-[#7dd3fc]/50 bg-[#1b2027] text-sm h-[42px] appearance-none cursor-pointer"

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
  publicCode?: string | null
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
      return { icon: MessageCircle, bg: "bg-[#7dd3fc]/15", text: "text-[#7dd3fc]", label: "Comentário" }
    case "CRIADA":
      return { icon: Plus, bg: "bg-[#4ade80]/15", text: "text-[#4ade80]", label: "Criada" }
    case "INICIADA":
      return { icon: Play, bg: "bg-[#d2a948]/15", text: "text-[#d2a948]", label: "Iniciada" }
    case "CONCLUIDA":
      return { icon: CheckCircle2, bg: "bg-[#4ade80]/15", text: "text-[#4ade80]", label: "Concluída" }
    case "COBRADA":
      return { icon: RefreshCw, bg: "bg-[#7dd3fc]/15", text: "text-[#7dd3fc]", label: "Cobrada" }
    case "AGUARDANDO_CLIENTE":
      return { icon: Clock, bg: "bg-[#d2a948]/15", text: "text-[#d2a948]", label: "Aguardando" }
    case "NAO_POSSUI":
      return { icon: FileX, bg: "bg-[#252c35]", text: "text-white/68", label: "Não possui" }
    case "CONFERENCIA":
      return { icon: ClipboardCheck, bg: "bg-[#a78bfa]/15", text: "text-[#a78bfa]", label: "Conferência" }
    case "STATUS_ALTERADO":
      return { icon: ArrowRight, bg: "bg-[#a78bfa]/15", text: "text-[#a78bfa]", label: "Status alterado" }
    case "PRAZO_ALTERADO":
      return { icon: Calendar, bg: "bg-[#fbbf24]/15", text: "text-[#fbbf24]", label: "Prazo alterado" }
    default:
      return { icon: History, bg: "bg-[#252c35]", text: "text-white/55", label: acao }
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
      const response = await fetch(`/api/tarefas/${tarefa.id}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
      })
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
      return { label: "Concluída", bg: "bg-[#4ade80]/15", text: "text-[#4ade80]", border: "border-[#4ade80]/30" }
    }
    if (!iniciada) {
      return { label: "Não iniciada", bg: "bg-[#20262e]", text: "text-white/55", border: "border-white/10" }
    }
    const cobrancaPendente = subtarefas.find(s => s.tipoSubtarefa === "COBRANCA" && !s.concluida)
    if (cobrancaPendente) {
      return { label: "Aguardando", bg: "bg-[#d2a948]/12", text: "text-[#d2a948]", border: "border-[#d2a948]/30" }
    }
    return { label: "Em andamento", bg: "bg-[#7dd3fc]/12", text: "text-[#7dd3fc]", border: "border-[#7dd3fc]/30" }
  }

  const status = calcularStatus()

  // Iniciar tarefa
  const handleIniciar = async () => {
    setProcessando(true)
    try {
      const response = await fetch(`/api/tarefas/${tarefa.id}/iniciar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${localStorage.getItem("authToken")}` },
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
      // Se EU sou a cobrança/conferência, age direto em mim
      const isEuCobranca = tarefa.tipoSubtarefa === "COBRANCA" || tarefa.tipoSubtarefa === "CONFERENCIA"
      const cobrancaPendente = !isEuCobranca ? subtarefas.find(s => s.tipoSubtarefa === "COBRANCA" && !s.concluida) : null
      const idParaAcao = isEuCobranca ? tarefa.id : (cobrancaPendente?.id || tarefa.id)

      const response = await fetch(`/api/tarefas/${idParaAcao}/cobranca`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${localStorage.getItem("authToken")}` },
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
      const isEuCobranca = tarefa.tipoSubtarefa === "COBRANCA" || tarefa.tipoSubtarefa === "CONFERENCIA"
      const cobrancaPendente = !isEuCobranca ? subtarefas.find(s => s.tipoSubtarefa === "COBRANCA" && !s.concluida) : null
      const idParaAcao = isEuCobranca ? tarefa.id : (cobrancaPendente?.id || tarefa.id)

      const response = await fetch(`/api/tarefas/${idParaAcao}/cobranca`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${localStorage.getItem("authToken")}` },
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
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${localStorage.getItem("authToken")}` },
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

  // Render subtarefa de cobrança/conferência (com ações)
  if (isCobranca || isConferencia) {
    const cores = isConferencia
      ? { bg: tarefa.concluida ? 'bg-[#20262e]' : 'bg-[#a78bfa]/12', border: tarefa.concluida ? 'border-white/10' : 'border-[#a78bfa]/30', text: tarefa.concluida ? 'text-white/40 line-through' : 'text-[#a78bfa]' }
      : { bg: tarefa.concluida ? 'bg-[#20262e]' : 'bg-[#7dd3fc]/12', border: tarefa.concluida ? 'border-white/10' : 'border-[#7dd3fc]/30', text: tarefa.concluida ? 'text-white/40 line-through' : 'text-[#7dd3fc]' }

    return (
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${cores.bg} ${cores.border}`}>
        <div className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center ${tarefa.concluida ? 'bg-[#4ade80]/15' : isConferencia ? 'bg-[#a78bfa]/15' : 'bg-[#7dd3fc]/15'}`}>
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
          <span className={`text-[10px] ${isPast(tarefa.dataPrazo) && !tarefa.concluida ? 'text-[#f87171]' : 'text-white/40'}`}>
            {formatDateBR(tarefa.dataPrazo)}
          </span>
        )}
        {/* Botões de ação para cobrança/conferência pendentes */}
        {!tarefa.concluida && pode('tarefas.iniciar_concluir') && (
          <div className="flex items-center gap-1 ml-1">
            <button
              onClick={() => handleConcluirComStatus("recebido")}
              disabled={processando}
              className="px-1.5 py-0.5 text-[10px] font-medium text-[#4ade80] bg-[#4ade80]/15 hover:bg-[#4ade80]/15 border border-[#4ade80]/30 rounded transition-colors disabled:opacity-50"
              title="Recebido"
            >
              <CheckCircle2 className="w-3 h-3" />
            </button>
            <button
              onClick={() => handleAguardando(5)}
              disabled={processando}
              className="px-1.5 py-0.5 text-[10px] font-medium text-[#7dd3fc] bg-[#7dd3fc]/12 hover:bg-[#7dd3fc]/15 border border-[#7dd3fc]/30 rounded transition-colors disabled:opacity-50"
              title="Cobrar novamente (5 dias)"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
            {isProcuracaoAdm ? (
              <button
                onClick={() => handleConcluirComStatus("conferencia")}
                disabled={processando}
                className="px-1.5 py-0.5 text-[10px] font-medium text-[#a78bfa] bg-[#a78bfa]/12 hover:bg-[#a78bfa]/15 border border-[#a78bfa]/30 rounded transition-colors disabled:opacity-50"
                title="Conferência"
              >
                <ClipboardCheck className="w-3 h-3" />
              </button>
            ) : (
              <button
                onClick={() => handleConcluirComStatus("nao_possui")}
                disabled={processando}
                className="px-1.5 py-0.5 text-[10px] font-medium text-white/68 bg-[#252c35] hover:bg-[#252c35] border border-white/10 rounded transition-colors disabled:opacity-50"
                title="Não possui"
              >
                <FileX className="w-3 h-3" />
              </button>
            )}
          </div>
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
          ${tarefa.concluida ? 'bg-[#20262e] border-white/10' : iniciada ? 'bg-[#7dd3fc]/12/50 border-[#7dd3fc]/30' : 'bg-[#1b2027] border-white/10 hover:border-[#7dd3fc]/40'}
        `}
      >
        {/* Status circle */}
        <div className={`
          w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center
          ${tarefa.concluida ? 'bg-[#4ade80]/15 border-[#4ade80]/30' : iniciada ? 'bg-[#7dd3fc]/15 border-[#7dd3fc]/30' : 'border-white/15'}
        `}>
          {tarefa.concluida ? (
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
          ) : iniciada ? (
            <Play className="w-3 h-3 text-[#7dd3fc] fill-blue-500" />
          ) : null}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpandido(!expandido)}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm ${tarefa.concluida ? 'text-white/40 line-through' : 'text-white/95'}`}>
              {tarefa.titulo}
            </span>
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${status.bg} ${status.text} ${status.border}`}>
              {status.label}
            </span>
            {tarefa.dataPrazo && (
              <span className={`text-[10px] flex items-center gap-0.5 ${isPast(tarefa.dataPrazo) && !tarefa.concluida ? 'text-[#f87171]' : 'text-white/40'}`}>
                <CalendarClock className="w-3 h-3" />
                {formatDateBR(tarefa.dataPrazo)}
              </span>
            )}
          </div>
          {tarefa.observacoes && (
            <p className="text-[10px] text-white/55 mt-0.5 truncate">
              <MessageSquare className="w-3 h-3 inline mr-0.5" />
              {tarefa.observacoes}
            </p>
          )}
        </div>

        {/* Actions */}
        {!tarefa.concluida && !iniciada && mostrarBotaoIniciar && pode('tarefas.iniciar_concluir') && (
          <button
            onClick={handleIniciar}
            disabled={processando}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#0c0f13] bg-[#d2a948] hover:bg-[#c19a3e] rounded-lg transition-colors disabled:opacity-50"
          >
            {processando ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Iniciar
          </button>
        )}

        {!tarefa.concluida && iniciada && pode('tarefas.iniciar_concluir') && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => handleConcluirComStatus("recebido")}
              disabled={processando}
              className="px-2 py-1 text-[10px] font-medium text-[#4ade80] bg-[#4ade80]/15 hover:bg-[#4ade80]/15 border border-[#4ade80]/30 rounded-md transition-colors disabled:opacity-50"
              title="Recebido"
            >
              <CheckCircle2 className="w-3 h-3" />
            </button>
            <button
              onClick={() => handleAguardando(5)}
              disabled={processando}
              className="px-2 py-1 text-[10px] font-medium text-[#7dd3fc] bg-[#7dd3fc]/12 hover:bg-[#7dd3fc]/15 border border-[#7dd3fc]/30 rounded-md transition-colors disabled:opacity-50"
              title="Aguardando (5 dias)"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
            {isProcuracaoAdm ? (
              <button
                onClick={() => handleConcluirComStatus("conferencia")}
                disabled={processando}
                className="px-2 py-1 text-[10px] font-medium text-[#a78bfa] bg-[#a78bfa]/12 hover:bg-[#a78bfa]/15 border border-[#a78bfa]/30 rounded-md transition-colors disabled:opacity-50"
                title="Conferência"
              >
                <ClipboardCheck className="w-3 h-3" />
              </button>
            ) : (
              <button
                onClick={() => handleConcluirComStatus("nao_possui")}
                disabled={processando}
                className="px-2 py-1 text-[10px] font-medium text-white/68 bg-[#252c35] hover:bg-[#252c35] border border-white/10 rounded-md transition-colors disabled:opacity-50"
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
              const response = await fetch(`/api/tarefas/${tarefa.id}`, { method: "DELETE", headers: { "Authorization": `Bearer ${localStorage.getItem("authToken")}` } })
              if (response.ok) onUpdate()
            } catch (error) {
              console.error("Erro ao excluir:", error)
            }
          }}
          className="p-1 text-white/40 hover:text-[#f87171] rounded transition-all opacity-0 group-hover:opacity-100"
        >
          <Trash2 className="w-4 h-4" />
        </button>
        }

        {/* Expand toggle */}
        <button
          onClick={() => setExpandido(!expandido)}
          className="p-1 text-white/40 hover:text-[#7dd3fc] rounded transition-all"
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${expandido ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Expanded details */}
      {expandido && (
        <div className="ml-9 space-y-2 animate-in slide-in-from-top-2 duration-200">
          {editando ? (
            <div className="bg-[#20262e] rounded-lg p-3 space-y-2 border border-white/10">
              <Input value={editForm.titulo} onChange={(e) => setEditForm({...editForm, titulo: e.target.value})} className="bg-[#1b2027] text-sm" placeholder="Nome" />
              <textarea value={editForm.observacoes} onChange={(e) => setEditForm({...editForm, observacoes: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm bg-[#1b2027] resize-none focus:outline-none focus:ring-1 focus:ring-[#7dd3fc]/25 focus:border-[#7dd3fc]/50" rows={2} placeholder="Observações..." />
              <div className="flex gap-2">
                <select value={editForm.prioridade} onChange={(e) => setEditForm({...editForm, prioridade: e.target.value})} className="flex-1 px-2 py-1.5 border border-white/15 rounded-lg text-xs bg-[#1b2027] appearance-none cursor-pointer" style={selectStyle}>
                  <option value="BAIXA">🟢 Baixa</option>
                  <option value="MEDIA">🟡 Média</option>
                  <option value="ALTA">🟠 Alta</option>
                  <option value="URGENTE">🔴 Urgente</option>
                </select>
                <select value={editForm.responsavelId} onChange={(e) => setEditForm({...editForm, responsavelId: e.target.value})} className="flex-1 px-2 py-1.5 border border-white/15 rounded-lg text-xs bg-[#1b2027] appearance-none cursor-pointer" style={selectStyle}>
                  <option value="">Sem responsável</option>
                  {usuarios.map(u => <option key={u.id} value={u.id}>{u.publicCode ? u.publicCode + ' — ' : ''}{u.nome}</option>)}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEditando(false)} className="h-7 text-xs">Cancelar</Button>
                <Button size="sm" onClick={handleSalvar} disabled={salvando} className="h-7 text-xs bg-[#2563eb] hover:bg-[#1d4ed8] text-white">
                  {salvando ? <Loader2 className="w-3 h-3 animate-spin" /> : "Salvar"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              {pode('tarefas.editar') && <button onClick={() => setEditando(true)} className="px-2 py-1 rounded text-[10px] font-medium bg-[#252c35] text-white/68 hover:bg-[#252c35] transition-colors">
                Editar
              </button>}
              {tarefa.responsavel && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#1b2027] border text-[10px] text-white/68">
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
  const [tituloLocal, setTituloLocal] = useState(tarefa.titulo)
  const [tituloEditado, setTituloEditado] = useState(tarefa.titulo)  // ← Adicionar esta linha
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

  const [dadosLocais, setDadosLocais] = useState({
    prioridade: tarefa.prioridade || "MEDIA",
    dataPrazo: tarefa.dataPrazo,
    responsavelNome: tarefa.responsavel?.nome,
    observacoes: tarefa.observacoes
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
      const response = await fetch(`/api/tarefas/${tarefa.id}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
      })
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
      const response = await fetch(`/api/tarefas/${tarefa.id}/historico`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
      })
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

  // Adicionar:
  const fetchTarefaCompleta = async () => {
    try {
      const response = await fetch(`/api/tarefas/${tarefa.id}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
      })
      const data = await response.json()
      if (data.tarefa) {
        const t = data.tarefa
        setTituloLocal(t.titulo)
        setTituloEditado(t.titulo)
        setSubtarefas(t.subtarefas || [])
        setDadosLocais({
          prioridade: t.prioridade || "MEDIA",
          dataPrazo: t.dataPrazo,
          responsavelNome: t.responsavel?.nome,
          observacoes: t.observacoes
        })
        setEditForm({
          prioridade: t.prioridade || "MEDIA",
          dataPrazo: t.dataPrazo ? t.dataPrazo.split("T")[0] : "",
          responsavelId: t.responsavelId?.toString() || "",
          observacoes: t.observacoes || ""
        })
      }
    } catch (error) {
      console.error("Erro ao buscar tarefa:", error)
    }
  }

  // Salvar título
  const handleSalvarTitulo = async () => {
    if (!tituloEditado.trim()) return
    setSalvandoTitulo(true)
    try {
      const response = await fetch(`/api/tarefas/${tarefa.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${localStorage.getItem("authToken")}` },
        body: JSON.stringify({ titulo: tituloEditado.trim() })
      })
      if (response.ok) {
        setEditandoTitulo(false)
        setTituloLocal(tituloEditado.trim())
        fetchTarefaCompleta()
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
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${localStorage.getItem("authToken")}` },
        body: JSON.stringify({
          prioridade: editForm.prioridade,
          dataPrazo: editForm.dataPrazo || null,
          responsavelId: editForm.responsavelId ? parseInt(editForm.responsavelId) : null,
          observacoes: editForm.observacoes || null
        })
      })
      if (response.ok) {
        setEditandoCampos(false)
        fetchTarefaCompleta()
        fetchHistorico()
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
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${localStorage.getItem("authToken")}` },
        body: JSON.stringify({ titulo: novaTarefa.trim() })
      })
      if (response.ok) {
        setNovaTarefa("")
        fetchTarefaCompleta()
        fetchHistorico()
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
      const response = await fetch(`/api/tarefas/${id}`, { method: "DELETE", headers: { "Authorization": `Bearer ${localStorage.getItem("authToken")}` } })
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
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${localStorage.getItem("authToken")}` },
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
    URGENTE: { emoji: "🔴", label: "Urgente", color: "text-[#f87171]" },
    ALTA: { emoji: "🟠", label: "Alta", color: "text-[#fbbf24]" },
    MEDIA: { emoji: "🟡", label: "Média", color: "text-[#d2a948]" },
    BAIXA: { emoji: "🟢", label: "Baixa", color: "text-[#4ade80]" },
  }

  const prioridade = prioridadeConfig[dadosLocais.prioridade] || prioridadeConfig.MEDIA

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[10001] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#1b2027] text-white/95 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ====== HEADER ====== */}
        <div className="px-6 py-4 border-b bg-[#1b2027] flex-shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0 pr-4">
              {editandoTitulo ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={tituloEditado}
                    onChange={(e) => setTituloEditado(e.target.value)}
                    className="flex-1 px-3 py-2 border border-white/15 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#7dd3fc]/25 focus:border-[#7dd3fc]/50 text-lg font-semibold"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSalvarTitulo()
                      if (e.key === "Escape") { setEditandoTitulo(false); setTituloEditado(tarefa.titulo) }
                    }}
                  />
                  <button onClick={handleSalvarTitulo} disabled={salvandoTitulo} className="p-2 hover:bg-[#252c35] rounded-lg">
                    {salvandoTitulo ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4 text-[#7dd3fc]" />}
                  </button>
                  <button onClick={() => { setEditandoTitulo(false); setTituloEditado(tarefa.titulo) }} className="p-2 hover:bg-[#252c35] rounded-lg">
                    <X className="w-4 h-4 text-white/40" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-white/95 truncate">{tituloLocal}</h2>
                  {pode('tarefas.editar') && <button onClick={() => { setTituloEditado(tarefa.titulo); setEditandoTitulo(true) }} className="p-1.5 hover:bg-[#252c35] rounded-lg flex-shrink-0">
                    <Pencil className="w-4 h-4 text-white/40" />
                  </button>}
                </div>
              )}

              {/* Progress bar */}
              <div className="mt-3 flex items-center gap-3">
                <div className="flex-1 h-2 bg-[#252c35] rounded-full overflow-hidden">
                  <div className="h-full bg-[#7dd3fc] rounded-full transition-all duration-500" style={{ width: `${porcentagem}%` }} />
                </div>
                <span className="text-sm font-semibold text-white/68">{Math.round(porcentagem)}%</span>
                <span className="text-xs text-white/40">
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

            <button onClick={onClose} className="p-2 hover:bg-[#252c35] rounded-lg transition-colors">
              <X className="w-5 h-5 text-white/40" />
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
                  <h3 className="text-xs font-semibold text-white/55 uppercase tracking-wide">Detalhes</h3>
                  {!editandoCampos ? (
                    pode('tarefas.editar') && <button onClick={() => setEditandoCampos(true)} className="text-xs text-[#7dd3fc] hover:text-[#7dd3fc] font-medium">
                      Editar
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => setEditandoCampos(false)} className="text-xs text-white/55 hover:text-white/80">Cancelar</button>
                      <button onClick={handleSalvarCampos} disabled={salvandoCampos} className="text-xs text-[#7dd3fc] hover:text-[#7dd3fc] font-medium">
                        {salvandoCampos ? "Salvando..." : "Salvar"}
                      </button>
                    </div>
                  )}
                </div>

                {editandoCampos ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-white/55 mb-1 block">Prioridade</label>
                        <select value={editForm.prioridade} onChange={(e) => setEditForm({...editForm, prioridade: e.target.value})} className={selectClass} style={selectStyle}>
                          <option value="BAIXA">🟢 Baixa</option>
                          <option value="MEDIA">🟡 Média</option>
                          <option value="ALTA">🟠 Alta</option>
                          <option value="URGENTE">🔴 Urgente</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-white/55 mb-1 block">Responsável</label>
                        <select value={editForm.responsavelId} onChange={(e) => setEditForm({...editForm, responsavelId: e.target.value})} className={selectClass} style={selectStyle}>
                          <option value="">Sem responsável</option>
                          {usuarios.map(u => <option key={u.id} value={u.id}>{u.publicCode ? u.publicCode + ' — ' : ''}{u.nome}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-white/55 mb-1 block">Prazo</label>
                      <DatePickerField value={editForm.dataPrazo || undefined} onChange={(v) => setEditForm({...editForm, dataPrazo: v})} placeholder="Selecione o prazo" />
                    </div>
                    <div>
                      <label className="text-xs text-white/55 mb-1 block">Observações</label>
                      <textarea value={editForm.observacoes} onChange={(e) => setEditForm({...editForm, observacoes: e.target.value})} className="w-full px-3 py-2 border border-white/15 rounded-lg text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[#7dd3fc]/25 focus:border-[#7dd3fc]/50" rows={3} placeholder="Observações da tarefa..." />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                    <div>
                      <span className="text-[10px] text-white/40 uppercase">Prioridade</span>
                      <p className={`text-sm font-medium ${prioridade.color}`}>{prioridade.emoji} {prioridade.label}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-white/40 uppercase">Responsável</span>
                      <p className="text-sm font-medium text-white/95">
                        {dadosLocais.responsavelNome || <span className="text-white/40">Não atribuído</span>}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-white/40 uppercase">Prazo</span>
                      <p className={`text-sm font-medium ${dadosLocais.dataPrazo && isPast(dadosLocais.dataPrazo) ? 'text-[#f87171]' : 'text-white/95'}`}>
                        {dadosLocais.dataPrazo ? formatDateBR(dadosLocais.dataPrazo) : <span className="text-white/40">Sem prazo</span>}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-white/40 uppercase">Criada em</span>
                      <p className="text-sm font-medium text-white/95">
                        {tarefa.createdAt ? formatDateBR(tarefa.createdAt) : "—"}
                      </p>
                    </div>
                    {dadosLocais.observacoes && (
                      <div className="col-span-2">
                        <span className="text-[10px] text-white/40 uppercase">Observações</span>
                        <p className="text-sm text-white/80 mt-0.5 bg-[#d2a948]/12 rounded-lg p-2 border border-[#d2a948]/30">
                          {dadosLocais.observacoes}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="border-t border-white/10" />

              {/* Subtarefas */}
              <div>
                <h3 className="text-xs font-semibold text-white/55 uppercase tracking-wide mb-3">
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
                          onUpdate={() => { fetchTarefaCompleta(); fetchHistorico(); onUpdate() }}
                          usuarios={usuarios}
                          isProcuracaoAdm={isProcuracaoAdm}
                          mostrarBotaoIniciar={mostrarIniciar}
                        />
                      )
                    })}
                  </div>
                ) : (
                  <div className="text-center py-6 text-white/40">
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
                  <Button onClick={handleCriarTarefa} disabled={criandoTarefa || !novaTarefa.trim()} size="sm" className="h-9 bg-[#2563eb] hover:bg-[#1d4ed8] text-white">
                    {criandoTarefa ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  </Button>
                </div>
                }
              </div>
            </div>
          </div>

          {/* ===== RIGHT COLUMN - ACTIVITY FEED ===== */}
          <div className="w-[380px] flex-shrink-0 flex flex-col bg-[#20262e]/50">
            {/* Feed header */}
            <div className="px-4 py-3 border-b bg-[#1b2027] flex-shrink-0">
              <h3 className="text-xs font-semibold text-white/55 uppercase tracking-wide flex items-center gap-2">
                <History className="w-4 h-4" />
                Atividade
              </h3>
            </div>

            {/* Comment input */}
            {pode('tarefas.editar') && <div className="px-4 py-3 border-b bg-[#1b2027] flex-shrink-0">
              <div className="flex items-center gap-2">
                <textarea
                    value={novoComentario}
                    onChange={(e) => setNovoComentario(e.target.value)}
                    placeholder="Escreva um comentário..."
                    className="flex-1 px-3 py-2 border border-white/10 rounded-lg text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[#7dd3fc]/25 focus:border-[#7dd3fc]/50 focus:border-transparent min-h-[38px] max-h-[120px]"                    rows={1}
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
                    className="self-center p-2 bg-[#2563eb] hover:bg-[#1d4ed8] text-white rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {enviandoComentario ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </div>}

            {/* Feed content */}
            <div ref={feedRef} className="flex-1 overflow-y-auto">
              {loadingHistorico ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-white/40" />
                </div>
              ) : historico.length === 0 ? (
                <div className="text-center py-12 text-white/40">
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
                                <span className="text-xs font-semibold text-white/95">{entry.usuario.nome}</span>
                              )}
                              {!isComentario && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${config.bg} ${config.text}`}>
                                  {config.label}
                                </span>
                              )}
                              <span className="text-[10px] text-white/40">{formatRelativeDate(entry.createdAt)}</span>
                            </div>

                            {isComentario ? (
                              <div className="mt-1 p-3 bg-[#1b2027] rounded-lg border border-white/10 shadow-sm">
                                <p className="text-sm text-white/80 whitespace-pre-wrap">{entry.descricao}</p>
                              </div>
                            ) : (
                              <p className="text-xs text-white/68 mt-0.5">
                                {entry.descricao}
                                {isSubtarefa && entry.tarefa && (
                                  <span className="text-white/40 ml-1">
                                    em "{entry.tarefa.titulo}"
                                  </span>
                                )}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Divider */}
                        {index < historico.length - 1 && (
                          <div className="ml-4 mt-2 border-l-2 border-white/10 h-2" />
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
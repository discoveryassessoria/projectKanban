// src/components/kanban/ProcessoEventos.tsx
"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import {
  Plus,
  Calendar,
  MapPin,
  Clock,
  Trash2,
  Edit2,
  X,
  Check,
  Building2,
  Users,
  FileText,
  Bell,
  AlertCircle,
} from "lucide-react"

interface Evento {
  id: number
  titulo: string
  descricao?: string
  tipo: string
  dataInicio: string
  dataFim?: string
  diaInteiro: boolean
  local?: string
  lembreteDias?: number
  cor?: string
  observacoes?: string
}

interface ProcessoEventosProps {
  processoId: number
  onUpdate?: () => void
}

const TIPOS_EVENTO = [
  { value: "CONSULADO", label: "Consulado", icon: Building2, cor: "#3b82f6" },
  { value: "CARTORIO", label: "Cartório", icon: FileText, cor: "#8b5cf6" },
  { value: "REUNIAO", label: "Reunião", icon: Users, cor: "#10b981" },
  { value: "PRAZO", label: "Prazo", icon: AlertCircle, cor: "#ef4444" },
  { value: "AUDIENCIA", label: "Audiência", icon: Building2, cor: "#f59e0b" },
  { value: "ENTREGA_DOCUMENTO", label: "Entrega de Documento", icon: FileText, cor: "#06b6d4" },
  { value: "OUTRO", label: "Outro", icon: Calendar, cor: "#ec4899" },
]

export function ProcessoEventos({ processoId, onUpdate }: ProcessoEventosProps) {
  const [eventos, setEventos] = useState<Evento[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)

  // Form state
  const [titulo, setTitulo] = useState("")
  const [descricao, setDescricao] = useState("")
  const [tipo, setTipo] = useState("OUTRO")
  const [dataInicio, setDataInicio] = useState("")
  const [horaInicio, setHoraInicio] = useState("")
  const [dataFim, setDataFim] = useState("")
  const [horaFim, setHoraFim] = useState("")
  const [diaInteiro, setDiaInteiro] = useState(false)
  const [local, setLocal] = useState("")
  const [lembreteDias, setLembreteDias] = useState("")

  useEffect(() => {
    fetchEventos()
  }, [processoId])

  const fetchEventos = async () => {
    try {
      const res = await fetch(`/api/eventos?processoId=${processoId}`)
      const data = await res.json()
      setEventos(data.eventos || [])
    } catch (error) {
      console.error("Erro ao buscar eventos:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const resetForm = () => {
    setTitulo("")
    setDescricao("")
    setTipo("OUTRO")
    setDataInicio("")
    setHoraInicio("")
    setDataFim("")
    setHoraFim("")
    setDiaInteiro(false)
    setLocal("")
    setLembreteDias("")
    setEditingId(null)
    setShowForm(false)
  }

  const handleSubmit = async () => {
    if (!titulo.trim() || !dataInicio) {
      alert("Título e data são obrigatórios")
      return
    }

    try {
      const dataInicioCompleta = diaInteiro
        ? `${dataInicio}T00:00:00`
        : `${dataInicio}T${horaInicio || "00:00"}:00`

      const dataFimCompleta = dataFim
        ? diaInteiro
          ? `${dataFim}T23:59:59`
          : `${dataFim}T${horaFim || "23:59"}:00`
        : null

      const payload = {
        processoId,
        titulo,
        descricao: descricao || null,
        tipo,
        dataInicio: dataInicioCompleta,
        dataFim: dataFimCompleta,
        diaInteiro,
        local: local || null,
        lembreteDias: lembreteDias ? parseInt(lembreteDias) : null,
        cor: TIPOS_EVENTO.find((t) => t.value === tipo)?.cor,
      }

      const url = editingId ? `/api/eventos/${editingId}` : "/api/eventos"
      const method = editingId ? "PUT" : "POST"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        resetForm()
        fetchEventos()
        onUpdate?.()
      } else {
        alert("Erro ao salvar evento")
      }
    } catch (error) {
      console.error("Erro ao salvar evento:", error)
      alert("Erro ao salvar evento")
    }
  }

  const handleEdit = (evento: Evento) => {
    const dataIni = new Date(evento.dataInicio)
    setTitulo(evento.titulo)
    setDescricao(evento.descricao || "")
    setTipo(evento.tipo)
    setDataInicio(dataIni.toISOString().split("T")[0])
    setHoraInicio(dataIni.toTimeString().slice(0, 5))
    if (evento.dataFim) {
      const dataF = new Date(evento.dataFim)
      setDataFim(dataF.toISOString().split("T")[0])
      setHoraFim(dataF.toTimeString().slice(0, 5))
    }
    setDiaInteiro(evento.diaInteiro)
    setLocal(evento.local || "")
    setLembreteDias(evento.lembreteDias?.toString() || "")
    setEditingId(evento.id)
    setShowForm(true)
  }

  const handleDelete = async (id: number) => {
    if (!confirm("Tem certeza que deseja excluir este evento?")) return

    try {
      const res = await fetch(`/api/eventos/${id}`, { method: "DELETE" })
      if (res.ok) {
        fetchEventos()
        onUpdate?.()
      }
    } catch (error) {
      console.error("Erro ao excluir evento:", error)
    }
  }

  const formatarData = (dataStr: string, diaInteiro: boolean) => {
    const data = new Date(dataStr)
    const dataFormatada = data.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
    if (diaInteiro) return dataFormatada
    const hora = data.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    })
    return `${dataFormatada} às ${hora}`
  }

  const getTipoConfig = (tipoValue: string) => {
    return TIPOS_EVENTO.find((t) => t.value === tipoValue) || TIPOS_EVENTO[6]
  }

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100">
              <Calendar className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Eventos</h2>
              <p className="text-sm text-gray-500">
                {eventos.length} {eventos.length === 1 ? "evento" : "eventos"}
              </p>
            </div>
          </div>

          {!showForm && (
            <Button
              onClick={() => setShowForm(true)}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Novo Evento
            </Button>
          )}
        </div>

        {/* Formulário */}
        {showForm && (
          <div className="mb-6 p-4 bg-gray-50 rounded-xl border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-gray-900">
                {editingId ? "Editar Evento" : "Novo Evento"}
              </h3>
              <button
                onClick={resetForm}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Título */}
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Título *</label>
                <Input
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder="Ex: Reunião no Consulado"
                />
              </div>

              {/* Tipo */}
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Tipo</label>
                <div className="grid grid-cols-4 gap-2">
                  {TIPOS_EVENTO.map((t) => {
                    const Icon = t.icon
                    return (
                      <button
                        key={t.value}
                        onClick={() => setTipo(t.value)}
                        className={`p-2 rounded-lg border text-sm flex flex-col items-center gap-1 transition-colors ${
                          tipo === t.value
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-gray-200 hover:border-gray-300 text-gray-600"
                        }`}
                      >
                        <Icon className="h-4 w-4" style={{ color: t.cor }} />
                        <span className="text-xs">{t.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Dia inteiro */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="diaInteiro"
                  checked={diaInteiro}
                  onChange={(e) => setDiaInteiro(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <label htmlFor="diaInteiro" className="text-sm text-gray-600">
                  Dia inteiro
                </label>
              </div>

              {/* Data/Hora */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">
                    Data Início *
                  </label>
                  <DatePickerField
                    value={dataInicio}
                    onChange={(value) => setDataInicio(value)}
                    placeholder="dd/mm/aaaa"
                />
                </div>
                {!diaInteiro && (
                  <div>
                    <label className="text-sm text-gray-600 mb-1 block">Hora</label>
                    <Input
                      type="time"
                      value={horaInicio}
                      onChange={(e) => setHoraInicio(e.target.value)}
                    />
                  </div>
                )}
              </div>

            {!diaInteiro && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">
                    Data Fim (opcional)
                  </label>
                  <DatePickerField
                    value={dataFim}
                    onChange={(value) => setDataFim(value)}
                    placeholder="dd/mm/aaaa"
                />
                </div>
                {dataFim && (
                  <div>
                    <label className="text-sm text-gray-600 mb-1 block">Hora</label>
                    <Input
                      type="time"
                      value={horaFim}
                      onChange={(e) => setHoraFim(e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}

              {/* Local */}
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Local</label>
                <Input
                  value={local}
                  onChange={(e) => setLocal(e.target.value)}
                  placeholder="Ex: Consulado de São Paulo"
                />
              </div>

              {/* Lembrete */}
              <div>
                <label className="text-sm text-gray-600 mb-1 block">
                  Lembrete (dias antes)
                </label>
                <Input
                  type="number"
                  value={lembreteDias}
                  onChange={(e) => setLembreteDias(e.target.value)}
                  placeholder="Ex: 3"
                  min="0"
                />
              </div>

              {/* Descrição */}
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Descrição</label>
                <textarea
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Detalhes do evento..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>

              {/* Botões */}
              <div className="flex gap-2 pt-2">
                <Button onClick={handleSubmit} className="bg-blue-600 hover:bg-blue-700">
                  <Check className="h-4 w-4 mr-1.5" />
                  {editingId ? "Salvar" : "Criar Evento"}
                </Button>
                <Button variant="outline" onClick={resetForm}>
                  Cancelar
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Lista de eventos */}
        {eventos.length === 0 ? (
          <div className="text-center py-12">
            <Calendar className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p className="text-gray-500">Nenhum evento cadastrado</p>
            <p className="text-sm text-gray-400 mt-1">
              Clique em "Novo Evento" para adicionar
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {eventos.map((evento) => {
              const tipoConfig = getTipoConfig(evento.tipo)
              const Icon = tipoConfig.icon

              return (
                <div
                  key={evento.id}
                  className="p-4 bg-white rounded-xl border border-gray-200 hover:border-gray-300 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div
                        className="p-2 rounded-lg"
                        style={{ backgroundColor: `${tipoConfig.cor}15` }}
                      >
                        <Icon
                          className="h-5 w-5"
                          style={{ color: tipoConfig.cor }}
                        />
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900">{evento.titulo}</h4>
                        <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {formatarData(evento.dataInicio, evento.diaInteiro)}
                          </span>
                          {evento.local && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3.5 w-3.5" />
                              {evento.local}
                            </span>
                          )}
                        </div>
                        {evento.descricao && (
                          <p className="text-sm text-gray-500 mt-2">
                            {evento.descricao}
                          </p>
                        )}
                        {evento.lembreteDias && (
                          <span className="inline-flex items-center gap-1 mt-2 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-full">
                            <Bell className="h-3 w-3" />
                            Lembrete {evento.lembreteDias} dias antes
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleEdit(evento)}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(evento.id)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
"use client"

import type React from "react"

import { useEffect, useState } from "react"
import { AlertCircle, CheckCircle2 } from "lucide-react"
import type { Atividade } from "@/src/types/kanban"

interface AtividadeComProjeto extends Atividade {
  projeto: {
    id: number
    nome: string
  }
  status: {
    id: number
    nome: string
  }
}

interface GroupedAtividades {
  vencido: AtividadeComProjeto[]
  hoje: AtividadeComProjeto[]
  essaSemana: AtividadeComProjeto[]
  proximaSemana: AtividadeComProjeto[]
  semPrazo: AtividadeComProjeto[]
  concluidas: AtividadeComProjeto[]
}

export default function PrazosPage() {
  const [atividades, setAtividades] = useState<GroupedAtividades>({
    vencido: [],
    hoje: [],
    essaSemana: [],
    proximaSemana: [],
    semPrazo: [],
    concluidas: [],
  })
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetchAllAtividades()
  }, [])

  const fetchAllAtividades = async () => {
    try {
      // Fetch all projects with their activities
      const response = await fetch("/api/projetos")
      if (!response.ok) throw new Error("Falha ao buscar projetos")

      const { projetos } = await response.json()

      // Flatten all activities from all projects
      const allAtividades: AtividadeComProjeto[] = []
      projetos.forEach((projeto: any) => {
        projeto.atividades.forEach((atividade: any) => {
          allAtividades.push({
            ...atividade,
            projeto: {
              id: projeto.id,
              nome: projeto.nome,
            },
            status: projeto.status.find((s: any) => s.id === atividade.statusId) || {
              id: atividade.statusId,
              nome: "Desconhecido",
            },
          })
        })
      })

      // Group activities by deadline
      const grouped = groupAtividadesByDeadline(allAtividades)
      setAtividades(grouped)
    } catch (error) {
      console.error(error)
      alert("Não foi possível carregar as atividades.")
    } finally {
      setIsLoading(false)
    }
  }

  const groupAtividadesByDeadline = (atividades: AtividadeComProjeto[]): GroupedAtividades => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const endOfWeek = new Date(today)
    endOfWeek.setDate(endOfWeek.getDate() + (7 - today.getDay()))

    const endOfNextWeek = new Date(endOfWeek)
    endOfNextWeek.setDate(endOfNextWeek.getDate() + 7)

    const grouped: GroupedAtividades = {
      vencido: [],
      hoje: [],
      essaSemana: [],
      proximaSemana: [],
      semPrazo: [],
      concluidas: [],
    }

    atividades.forEach((atividade) => {
      // Check if completed
      const isConcluido = atividade.status.nome.toLowerCase() === "concluído"

      if (isConcluido) {
        grouped.concluidas.push(atividade)
        return
      }

      // Check deadline
      if (!atividade.data) {
        grouped.semPrazo.push(atividade)
        return
      }

      const deadline = new Date(atividade.data)
      deadline.setHours(0, 0, 0, 0)

      if (deadline < today) {
        grouped.vencido.push(atividade)
      } else if (deadline.getTime() === today.getTime()) {
        grouped.hoje.push(atividade)
      } else if (deadline <= endOfWeek) {
        grouped.essaSemana.push(atividade)
      } else if (deadline <= endOfNextWeek) {
        grouped.proximaSemana.push(atividade)
      } else {
        grouped.semPrazo.push(atividade)
      }
    })

    return grouped
  }

  const handleAtividadeClick = (atividade: AtividadeComProjeto) => {
    // Navigate to the project page
    window.location.href = `/kanban?projetoId=${atividade.projeto.id}`
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
          <p className="text-zinc-400">Carregando prazos...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Prazos</h1>

        <div className="grid gap-4">
          {/* Vencido */}
          <DeadlineColumn
            title="Vencido"
            atividades={atividades.vencido}
            icon={<AlertCircle className="h-5 w-5 text-red-500" />}
            color="red"
            onAtividadeClick={handleAtividadeClick}
          />

          {/* Vencimento hoje */}
          <DeadlineColumn
            title="Vencimento hoje"
            atividades={atividades.hoje}
            color="orange"
            onAtividadeClick={handleAtividadeClick}
          />

          {/* Vencimento essa semana */}
          <DeadlineColumn
            title="Vencimento essa semana"
            atividades={atividades.essaSemana}
            color="yellow"
            onAtividadeClick={handleAtividadeClick}
          />

          {/* Vencimento na próxima semana */}
          <DeadlineColumn
            title="Vencimento na próxima semana"
            atividades={atividades.proximaSemana}
            color="blue"
            onAtividadeClick={handleAtividadeClick}
          />

          {/* Sem prazo */}
          <DeadlineColumn
            title="Sem prazo"
            atividades={atividades.semPrazo}
            color="gray"
            onAtividadeClick={handleAtividadeClick}
          />

          {/* Concluídas */}
          <DeadlineColumn
            title="Concluídas"
            atividades={atividades.concluidas}
            icon={<CheckCircle2 className="h-5 w-5 text-green-500" />}
            color="green"
            onAtividadeClick={handleAtividadeClick}
          />
        </div>
      </div>
    </div>
  )
}

interface DeadlineColumnProps {
  title: string
  atividades: AtividadeComProjeto[]
  icon?: React.ReactNode
  color: "red" | "orange" | "yellow" | "blue" | "gray" | "green"
  onAtividadeClick: (atividade: AtividadeComProjeto) => void
}

function DeadlineColumn({ title, atividades, icon, color, onAtividadeClick }: DeadlineColumnProps) {
  const colorClasses = {
    red: "border-red-800 bg-red-950/20",
    orange: "border-orange-800 bg-orange-950/20",
    yellow: "border-yellow-800 bg-yellow-950/20",
    blue: "border-blue-800 bg-blue-950/20",
    gray: "border-zinc-800 bg-zinc-900/20",
    green: "border-green-800 bg-green-950/20",
  }

  return (
    <div className={`rounded-lg border ${colorClasses[color]} p-4`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-lg font-semibold">{title}</h2>
          <span className="px-2 py-0.5 text-xs font-medium bg-zinc-800 text-zinc-400 rounded-full">
            {atividades.length}
          </span>
        </div>
      </div>

      {atividades.length === 0 ? (
        <p className="text-zinc-500 text-sm">Nenhuma atividade</p>
      ) : (
        <div className="space-y-2">
          {atividades.map((atividade) => (
            <div
              key={`${atividade.projeto.id}-${atividade.id}`}
              onClick={() => onAtividadeClick(atividade)}
              className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 hover:border-zinc-700 transition-colors cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-zinc-100 truncate">{atividade.nome}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-zinc-500">{atividade.projeto.nome}</span>
                    <span className="text-xs text-zinc-600">•</span>
                    <span className="text-xs text-zinc-500">{atividade.status.nome}</span>
                  </div>
                  {atividade.data && (
                    <p className="text-xs text-zinc-400 mt-1">{new Date(atividade.data).toLocaleDateString("pt-BR")}</p>
                  )}
                  {atividade.responsavel && (
                    <p className="text-xs text-zinc-400 mt-1">Responsável: {atividade.responsavel}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

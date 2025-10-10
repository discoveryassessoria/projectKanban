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
      if (!atividade.data_termino) {
        grouped.semPrazo.push(atividade)
        return
      }

      const deadline = new Date(atividade.data_termino)
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
      <div className="min-h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 dark:border-indigo-400 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Carregando prazos...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Prazos</h1>

        <div className="flex gap-4 overflow-x-auto pb-4">
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
    red: "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/30",
    orange: "border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/30",
    yellow: "border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-950/30",
    blue: "border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30",
    gray: "border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800",
    green: "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30",
  }

  return (
    <div className={`rounded-lg border ${colorClasses[color]} p-4 min-w-80 flex-shrink-0 text-gray-900 dark:text-gray-100`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        </div>
        <span className="px-2 py-0.5 text-xs font-medium bg-gray-800 dark:bg-gray-700 text-white rounded-full">
          {atividades.length}
        </span>
      </div>

      {atividades.length === 0 ? (
        <p className="text-gray-700 dark:text-gray-400 text-sm font-medium">Nenhuma atividade</p>
      ) : (
        <div className="space-y-2">
          {atividades.map((atividade) => (
            <div
              key={`${atividade.projeto.id}-${atividade.id}`}
              onClick={() => onAtividadeClick(atividade)}
              className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-sm transition-all cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">{atividade.nome}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-700 dark:text-gray-300 font-medium">{atividade.projeto.nome}</span>
                    <span className="text-xs text-gray-600 dark:text-gray-500">•</span>
                    <span className="text-xs text-gray-700 dark:text-gray-300 font-medium">{atividade.status.nome}</span>
                  </div>
                  {atividade.data_termino && (
                    <p className="text-xs text-gray-700 dark:text-gray-300 mt-1 font-medium">{new Date(atividade.data_termino).toLocaleDateString("pt-BR")}</p>
                  )}
                  {atividade.usuarios?.[0] && (
                    <p className="text-xs text-gray-700 dark:text-gray-300 mt-1 font-medium">Responsável: {atividade.usuarios[0].usuario.nome}</p>
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

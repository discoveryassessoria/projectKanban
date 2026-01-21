"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Search, Bell, LogOut } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import type { ProcessoWithStatus } from "@/src/types/kanban"
import { parseLocalDate, formatDateBR, getToday, isToday, isPast, isWithinDays } from "@/src/lib/date-utils"

// Mapeamento de bandeiras por país
const BANDEIRAS_PAIS: Record<string, string> = {
  ALEMANHA: "🇩🇪",
  ESPANHA: "🇪🇸",
  ITALIA: "🇮🇹",
  PORTUGAL: "🇵🇹",
}

interface HeaderBarProps {
  title: string
  subtitle: string
  userName?: string
  userRole?: string
  userEmail?: string
  projetos?: Array<{
    id: number | string
    nome: string
    descricao?: string | null
  }>
  processos?: ProcessoWithStatus[]
  arvores?: Array<{
    id: number | string
    nome: string
    descricao?: string | null
    pessoas?: any[]
  }>
  onLogout?: () => void
}

interface TarefaNotificacao {
  id: number
  titulo: string
  dataPrazo: string | null
  concluida: boolean
  createdAt: string
  processoId: number | null
  processoNome: string
  pais: string | null
  responsavelId: number | null
  responsavelEmail: string | null
}

export function HeaderBar({ 
  title, 
  subtitle, 
  userName = "Usuário",
  userRole = "Usuário",
  userEmail = "",
  projetos = [],
  processos = [],
  arvores = [],
  onLogout 
}: HeaderBarProps) {
  const [currentTime, setCurrentTime] = useState<string>("")
  const [currentDate, setCurrentDate] = useState<string>("")
  const [searchQuery, setSearchQuery] = useState("")
  const [showSearchResults, setShowSearchResults] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [searchResults, setSearchResults] = useState<{
    processos: ProcessoWithStatus[]
  }>({ processos: [] })

  const [notificacoes, setNotificacoes] = useState<{
    vencidas: TarefaNotificacao[]
    hoje: TarefaNotificacao[]
    proximos3Dias: TarefaNotificacao[]
    novas: TarefaNotificacao[]
  }>({ vencidas: [], hoje: [], proximos3Dias: [], novas: [] })
  const [totalNotificacoes, setTotalNotificacoes] = useState(0)

  const router = useRouter()

  // Buscar notificações diretamente da API
  const fetchNotificacoes = useCallback(async () => {
    try {
      const response = await fetch('/api/tarefas')
      if (!response.ok) return

      const data = await response.json()
      const tarefas = data.tarefas || []
      if (!Array.isArray(tarefas)) return

      const vencidas: TarefaNotificacao[] = []
      const hojeList: TarefaNotificacao[] = []
      const proximos3Dias: TarefaNotificacao[] = []
      const novas: TarefaNotificacao[] = []

      const umDiaAtras = new Date()
      umDiaAtras.setDate(umDiaAtras.getDate() - 1)

      tarefas.forEach((t: any) => {
        const tarefa: TarefaNotificacao = {
          id: t.id,
          titulo: t.titulo || 'Sem título',
          dataPrazo: t.dataPrazo || null,
          concluida: t.concluida || false,
          createdAt: t.createdAt,
          processoId: t.processoId || t.processo?.id || null,
          processoNome: t.processo?.nome || 'Sem processo',
          pais: t.pais || t.processo?.pais || null,
          responsavelId: t.responsavelId || t.responsavel?.id || null,
          responsavelEmail: t.responsavel?.email || null
        }

        // Filtrar por responsável
        const semResponsavel = !tarefa.responsavelId
        const souResponsavel = userEmail && tarefa.responsavelEmail === userEmail
        
        if (!semResponsavel && !souResponsavel) {
          return
        }

        // ✅ CORRIGIDO: Usar funções de comparação de data corretas
        if (!tarefa.concluida && tarefa.dataPrazo) {
          if (isPast(tarefa.dataPrazo)) {
            vencidas.push(tarefa)
          } else if (isToday(tarefa.dataPrazo)) {
            hojeList.push(tarefa)
          } else if (isWithinDays(tarefa.dataPrazo, 3)) {
            proximos3Dias.push(tarefa)
          }
        }

        // Tarefas novas (criadas nas últimas 24h e não concluídas)
        if (tarefa.createdAt && !tarefa.concluida) {
          const criacao = new Date(tarefa.createdAt)
          if (criacao >= umDiaAtras) {
            novas.push(tarefa)
          }
        }
      })

      setNotificacoes({
        vencidas,
        hoje: hojeList,
        proximos3Dias,
        novas
      })

      setTotalNotificacoes(vencidas.length + hojeList.length + proximos3Dias.length + novas.length)
    } catch (error) {
      console.error('Erro ao buscar notificações:', error)
    }
  }, [userEmail])

  useEffect(() => {
    const updateDateTime = () => {
      const now = new Date()
      const time = now.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      })
      const date = now.toLocaleDateString("pt-BR", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
      const capitalizedDate = date.charAt(0).toUpperCase() + date.slice(1)
      setCurrentTime(time)
      setCurrentDate(capitalizedDate)
    }

    updateDateTime()
    const interval = setInterval(updateDateTime, 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    fetchNotificacoes()
    const interval = setInterval(fetchNotificacoes, 30000)
    return () => clearInterval(interval)
  }, [fetchNotificacoes])

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }

  const handleSearch = (query: string) => {
    setSearchQuery(query)

    if (query.trim() === "") {
      setShowSearchResults(false)
      setSearchResults({ processos: [] })
      return
    }

    const queryLower = query.toLowerCase()

    const processosFiltrados = processos.filter(p => 
      p.nome.toLowerCase().includes(queryLower) ||
      p.descricao?.toLowerCase().includes(queryLower) ||
      p.contratantes?.some(c => c.nome?.toLowerCase().includes(queryLower))
    )

    setSearchResults({
      processos: processosFiltrados.slice(0, 5)
    })

    setShowSearchResults(true)
  }

  const handleProcessoClick = (processo: ProcessoWithStatus) => {
    const url = `/kanban?pais=${processo.pais}&processoId=${processo.id}`
    router.push(url)
    setShowSearchResults(false)
    setSearchQuery("")
  }

  const handleTarefaClick = (tarefa: TarefaNotificacao) => {
    if (tarefa.processoId) {
      const pais = tarefa.pais || 'PORTUGAL'
      router.push(`/kanban?pais=${pais}&processoId=${tarefa.processoId}&tab=tarefas`)
    } else {
      router.push('/activities')
    }
    setShowNotifications(false)
  }

  const totalResults = searchResults.processos.length

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-black/40 backdrop-blur-md shadow-lg">
      <div className="px-6 py-4 flex items-center justify-between">
        {/* Lado esquerdo - Título e Subtítulo */}
        <div>
          <h1 className="text-lg font-semibold leading-tight text-white">
            Grupo Discovery · {title}
          </h1>
          <p className="text-xs text-white/70">
            {subtitle}
          </p>
        </div>

        {/* Lado direito - Ações */}
        <div className="flex items-center gap-4">
          {/* Horário e Data */}
          <div className="hidden lg:flex flex-col items-end">
            <span className="text-sm font-medium text-white">{currentTime}</span>
            <span className="text-[11px] text-white/60">{currentDate}</span>
          </div>

          {/* Divisor */}
          <div className="hidden lg:block h-8 w-px bg-white/20" />

          {/* Campo de busca */}
          <div className="relative hidden md:block">
            <div className="flex items-center gap-2 px-3 py-2 rounded-full border border-white/30">
              <Search className="h-4 w-4 text-white/70" />
              <input
                className="bg-transparent text-xs outline-none placeholder:text-white/60 w-40 text-white"
                placeholder="Pesquisar processos..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                onFocus={() => searchQuery && setShowSearchResults(true)}
                onBlur={() => setTimeout(() => setShowSearchResults(false), 200)}
              />
            </div>

            {/* Dropdown de resultados */}
            {showSearchResults && (
              <div className="absolute top-full mt-2 left-0 right-0 w-80 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden z-50">
                {totalResults === 0 ? (
                  <div className="px-4 py-6 text-center text-gray-400">
                    <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm text-gray-600">Nenhum processo encontrado</p>
                    <p className="text-xs mt-1 text-gray-400">Tente buscar por outro termo</p>
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto">
                    <div className="px-3 py-2 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500 font-medium">
                      Processos
                    </div>
                    {searchResults.processos.map(processo => (
                      <button
                        key={`processo-${processo.id}`}
                        className="w-full px-3 py-2 flex items-center gap-3 hover:bg-gray-100 transition text-left"
                        onClick={() => handleProcessoClick(processo)}
                      >
                        <span className="text-lg flex-shrink-0">
                          {BANDEIRAS_PAIS[processo.pais] || "🏳️"}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 truncate font-medium">{processo.nome}</p>
                          <p className="text-[10px] text-gray-400 truncate">
                            {processo.contratantes?.[0]?.nome || "Sem contratante"}
                          </p>
                        </div>
                        <span className="text-[10px] text-blue-500 flex-shrink-0">
                          Clique para abrir →
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Notificações */}
          <div className="relative hidden md:block">
            <button 
              className="relative inline-flex items-center justify-center rounded-full p-2 border border-white/30 hover:bg-white/10 transition"
              onClick={() => setShowNotifications(!showNotifications)}
            >
              <Bell className="h-4 w-4 text-white" />
              {totalNotificacoes > 0 && (
                <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 border-2 border-white text-[10px] font-bold flex items-center justify-center">
                  {totalNotificacoes > 9 ? '9+' : totalNotificacoes}
                </span>
              )}
            </button>

            {/* Dropdown de notificações */}
            {showNotifications && (
              <div className="absolute top-full mt-2 right-0 w-80 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden z-50">
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <h3 className="font-semibold text-gray-800 text-sm">Notificações</h3>
                  <p className="text-xs text-gray-500">{totalNotificacoes} pendentes</p>
                </div>

                {totalNotificacoes === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <Bell className="h-10 w-10 mx-auto mb-2 text-gray-300" />
                    <p className="text-sm text-gray-500">Nenhuma notificação</p>
                    <p className="text-xs text-gray-400 mt-1">Você está em dia!</p>
                  </div>
                ) : (
                  <div className="max-h-[400px] overflow-y-auto">
                    {notificacoes.vencidas.length > 0 && (
                      <div>
                        <div className="px-3 py-2 bg-red-50 text-[10px] uppercase tracking-wide text-red-600 font-medium flex items-center gap-1 sticky top-0">
                          <span className="h-2 w-2 rounded-full bg-red-500"></span>
                          Tarefas Vencidas ({notificacoes.vencidas.length})
                        </div>
                        {notificacoes.vencidas.map(tarefa => (
                          <button
                            key={`vencida-${tarefa.id}`}
                            className="w-full text-left px-3 py-2 border-l-4 border-red-500 hover:bg-red-50 transition-colors cursor-pointer"
                            onClick={() => handleTarefaClick(tarefa)}
                          >
                            <p className="text-sm text-gray-800 truncate font-medium">{tarefa.titulo}</p>
                            <p className="text-[10px] text-gray-500">{tarefa.processoNome}</p>
                            <p className="text-[10px] text-red-500 font-medium">
                              Venceu em {formatDateBR(tarefa.dataPrazo)}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}

                    {notificacoes.hoje.length > 0 && (
                      <div>
                        <div className="px-3 py-2 bg-amber-50 text-[10px] uppercase tracking-wide text-amber-600 font-medium flex items-center gap-1 sticky top-0">
                          <span className="h-2 w-2 rounded-full bg-amber-500"></span>
                          Vencem hoje ({notificacoes.hoje.length})
                        </div>
                        {notificacoes.hoje.map(tarefa => (
                          <button
                            key={`hoje-${tarefa.id}`}
                            className="w-full text-left px-3 py-2 border-l-4 border-amber-500 hover:bg-amber-50 transition-colors cursor-pointer"
                            onClick={() => handleTarefaClick(tarefa)}
                          >
                            <p className="text-sm text-gray-800 truncate font-medium">{tarefa.titulo}</p>
                            <p className="text-[10px] text-gray-500">{tarefa.processoNome}</p>
                            <p className="text-[10px] text-amber-600 font-medium">Vence hoje!</p>
                          </button>
                        ))}
                      </div>
                    )}

                    {notificacoes.proximos3Dias.length > 0 && (
                      <div>
                        <div className="px-3 py-2 bg-orange-50 text-[10px] uppercase tracking-wide text-orange-600 font-medium flex items-center gap-1 sticky top-0">
                          <span className="h-2 w-2 rounded-full bg-orange-500"></span>
                          Próximos 3 dias ({notificacoes.proximos3Dias.length})
                        </div>
                        {notificacoes.proximos3Dias.map(tarefa => (
                          <button
                            key={`proximos-${tarefa.id}`}
                            className="w-full text-left px-3 py-2 border-l-4 border-orange-500 hover:bg-orange-50 transition-colors cursor-pointer"
                            onClick={() => handleTarefaClick(tarefa)}
                          >
                            <p className="text-sm text-gray-800 truncate font-medium">{tarefa.titulo}</p>
                            <p className="text-[10px] text-gray-500">{tarefa.processoNome}</p>
                            <p className="text-[10px] text-orange-600 font-medium">
                              Vence em {formatDateBR(tarefa.dataPrazo)}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}

                    {notificacoes.novas.length > 0 && (
                      <div>
                        <div className="px-3 py-2 bg-blue-50 text-[10px] uppercase tracking-wide text-blue-600 font-medium flex items-center gap-1 sticky top-0">
                          <span className="h-2 w-2 rounded-full bg-blue-500"></span>
                          Novas tarefas ({notificacoes.novas.length})
                        </div>
                        {notificacoes.novas.map(tarefa => (
                          <button
                            key={`nova-${tarefa.id}`}
                            className="w-full text-left px-3 py-2 border-l-4 border-blue-500 hover:bg-blue-50 transition-colors cursor-pointer"
                            onClick={() => handleTarefaClick(tarefa)}
                          >
                            <p className="text-sm text-gray-800 truncate font-medium">{tarefa.titulo}</p>
                            <p className="text-[10px] text-gray-500">{tarefa.processoNome}</p>
                            <p className="text-[10px] text-blue-600 font-medium">Nova tarefa</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Usuário */}
          <div className="flex items-center gap-2">
            <Avatar className="h-9 w-9 border border-white/30">
              <AvatarFallback className="bg-transparent text-xs font-medium text-white">
                {getInitials(userName)}
              </AvatarFallback>
            </Avatar>
            <div className="hidden md:block">
              <p className="text-xs font-medium leading-tight text-white">
                {userName}
              </p>
              <p className="text-[11px] text-white/70 leading-tight">
                {userRole}
              </p>
            </div>
          </div>

          {/* Botão Sair */}
          <Button
            variant="outline"
            size="sm"
            onClick={onLogout}
            className="border-white/30 text-xs bg-transparent hover:bg-red-500/20 hover:border-red-400/50 text-white hover:text-red-400 flex items-center justify-center gap-1.5"
          >
            <LogOut className="h-3 w-3" />
            Sair
          </Button>
        </div>
      </div>
    </header>
  )
}
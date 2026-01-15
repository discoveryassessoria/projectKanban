// app/events/page.tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { HeaderBar } from "@/src/components/header-bar"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Plus,
  Calendar,
  CalendarDays,
  CalendarClock,
  List,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Clock,
  Building2,
  Users,
  FileText,
  AlertCircle,
  Filter,
} from "lucide-react"
import { BandeiraPais } from "@/src/components/ui/bandeira-pais"

interface Usuario {
  id: number
  nome: string
  email: string
  tipo: string
}

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
  processo: {
    id: number
    nome: string
    pais: string
  }
}

const TIPOS_EVENTO = [
  { value: "CONSULADO", label: "Consulado", icon: Building2, cor: "#3b82f6" },
  { value: "CARTORIO", label: "Cartório", icon: FileText, cor: "#8b5cf6" },
  { value: "REUNIAO", label: "Reunião", icon: Users, cor: "#10b981" },
  { value: "PRAZO", label: "Prazo", icon: AlertCircle, cor: "#ef4444" },
  { value: "AUDIENCIA", label: "Audiência", icon: Building2, cor: "#f59e0b" },
  { value: "ENTREGA_DOCUMENTO", label: "Entrega", icon: FileText, cor: "#06b6d4" },
  { value: "OUTRO", label: "Outro", icon: Calendar, cor: "#ec4899" },
]

const DIAS_SEMANA = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"]
const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
]

export default function EventosPage() {
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [eventos, setEventos] = useState<Evento[]>([])
  const [viewMode, setViewMode] = useState<"lista" | "calendario">("lista")
  const [mesAtual, setMesAtual] = useState(new Date())
  const [filtroTipo, setFiltroTipo] = useState<string | null>(null)
  
  const router = useRouter()

  useEffect(() => {
    const token = localStorage.getItem("authToken")
    const userData = localStorage.getItem("user")

    if (!token || !userData) {
      router.push("/login")
      return
    }

    try {
      const user = JSON.parse(userData)
      setUsuario(user)
      fetchEventos()
    } catch (error) {
      console.error("Erro ao carregar dados do usuário:", error)
      router.push("/login")
    }
  }, [router])

  const fetchEventos = async () => {
    try {
      const res = await fetch("/api/eventos")
      const data = await res.json()
      setEventos(data.eventos || [])
    } catch (error) {
      console.error("Erro ao buscar eventos:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem("authToken")
    localStorage.removeItem("user")
    router.push("/login")
  }

  // Métricas
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)

  const eventosHoje = eventos.filter((e) => {
    const dataEvento = new Date(e.dataInicio)
    dataEvento.setHours(0, 0, 0, 0)
    return dataEvento.getTime() === hoje.getTime()
  })

  const inicioSemana = new Date(hoje)
  inicioSemana.setDate(hoje.getDate() - hoje.getDay())
  const fimSemana = new Date(inicioSemana)
  fimSemana.setDate(inicioSemana.getDate() + 6)

  const eventosSemana = eventos.filter((e) => {
    const dataEvento = new Date(e.dataInicio)
    dataEvento.setHours(0, 0, 0, 0)
    return dataEvento >= inicioSemana && dataEvento <= fimSemana
  })

  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
  const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)

  const eventosMes = eventos.filter((e) => {
    const dataEvento = new Date(e.dataInicio)
    return dataEvento >= inicioMes && dataEvento <= fimMes
  })

  // Filtrar eventos
  const eventosFiltrados = filtroTipo
    ? eventos.filter((e) => e.tipo === filtroTipo)
    : eventos

  // Funções do calendário
  const getDiasDoMes = () => {
    const ano = mesAtual.getFullYear()
    const mes = mesAtual.getMonth()
    const primeiroDia = new Date(ano, mes, 1)
    const ultimoDia = new Date(ano, mes + 1, 0)
    const diasNoMes = ultimoDia.getDate()
    const diaSemanaInicio = primeiroDia.getDay()

    const dias: (number | null)[] = []

    // Dias vazios no início
    for (let i = 0; i < diaSemanaInicio; i++) {
      dias.push(null)
    }

    // Dias do mês
    for (let i = 1; i <= diasNoMes; i++) {
      dias.push(i)
    }

    return dias
  }

  const getEventosDoDia = (dia: number) => {
    const data = new Date(mesAtual.getFullYear(), mesAtual.getMonth(), dia)
    data.setHours(0, 0, 0, 0)

    return eventosFiltrados.filter((e) => {
      const dataEvento = new Date(e.dataInicio)
      dataEvento.setHours(0, 0, 0, 0)
      return dataEvento.getTime() === data.getTime()
    })
  }

  const navegarMes = (direcao: number) => {
    setMesAtual(new Date(mesAtual.getFullYear(), mesAtual.getMonth() + direcao, 1))
  }

  const getTipoConfig = (tipoValue: string) => {
    return TIPOS_EVENTO.find((t) => t.value === tipoValue) || TIPOS_EVENTO[6]
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

  const isHoje = (dia: number) => {
    const data = new Date(mesAtual.getFullYear(), mesAtual.getMonth(), dia)
    data.setHours(0, 0, 0, 0)
    return data.getTime() === hoje.getTime()
  }

  if (isLoading) {
    return (
      <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
        <div className="min-h-screen bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin h-12 w-12 border-4 border-white border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-white/70">Carregando eventos...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!usuario) return null

  return (
    <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />

      <HeaderBar
        title="Eventos"
        subtitle="Gerencie seus eventos e compromissos"
        userName={usuario.nome}
        userRole={usuario.tipo === "admin" ? "Administrador" : usuario.tipo}
        userEmail={usuario.email}
        projetos={[]}
        processos={[]}
        arvores={[]}
        onLogout={handleLogout}
      />

      <div className="min-h-screen relative">
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />
        <main className="relative px-6 py-6 space-y-6">
          {/* Header com ações */}
          <section className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h2 className="text-2xl md:text-3xl font-semibold">Eventos</h2>
              <p className="text-sm text-white/70 mt-1">
                Visualize e gerencie todos os seus eventos e compromissos.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Toggle Lista/Calendário */}
              <div className="flex items-center bg-white/10 rounded-lg p-1">
                <button
                  onClick={() => setViewMode("lista")}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                    viewMode === "lista"
                      ? "bg-white text-gray-900"
                      : "text-white/70 hover:text-white"
                  }`}
                >
                  <List className="h-4 w-4" />
                  Lista
                </button>
                <button
                  onClick={() => setViewMode("calendario")}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                    viewMode === "calendario"
                      ? "bg-white text-gray-900"
                      : "text-white/70 hover:text-white"
                  }`}
                >
                  <Calendar className="h-4 w-4" />
                  Calendário
                </button>
              </div>
            </div>
          </section>

          {/* Cards de resumo */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="bg-white/10 backdrop-blur-sm border border-white/20 text-white">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-white/60 font-medium">Eventos Hoje</p>
                    <p className="text-3xl font-bold mt-2">{eventosHoje.length}</p>
                    <p className="text-xs text-white/50 mt-1">
                      {eventosHoje.length === 0 ? "nenhum evento" : "agendados"}
                    </p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-emerald-500">
                    <Calendar className="h-6 w-6 text-white" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/10 backdrop-blur-sm border border-white/20 text-white">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-white/60 font-medium">Esta Semana</p>
                    <p className="text-3xl font-bold mt-2">{eventosSemana.length}</p>
                    <p className="text-xs text-white/50 mt-1">eventos agendados</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-sky-500">
                    <CalendarDays className="h-6 w-6 text-white" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/10 backdrop-blur-sm border border-white/20 text-white">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-white/60 font-medium">Este Mês</p>
                    <p className="text-3xl font-bold mt-2">{eventosMes.length}</p>
                    <p className="text-xs text-white/50 mt-1">eventos no total</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-amber-500">
                    <CalendarClock className="h-6 w-6 text-white" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* Filtros */}
          <section className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 text-sm text-white/60">
              <Filter className="h-4 w-4" />
              Filtrar:
            </div>
            <button
              onClick={() => setFiltroTipo(null)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filtroTipo === null
                  ? "bg-white text-gray-900"
                  : "bg-white/10 text-white/70 hover:bg-white/20"
              }`}
            >
              Todos
            </button>
            {TIPOS_EVENTO.map((tipo) => (
              <button
                key={tipo.value}
                onClick={() => setFiltroTipo(tipo.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  filtroTipo === tipo.value
                    ? "bg-white text-gray-900"
                    : "bg-white/10 text-white/70 hover:bg-white/20"
                }`}
              >
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: tipo.cor }}
                />
                {tipo.label}
              </button>
            ))}
          </section>

          {/* Conteúdo principal */}
          {viewMode === "lista" ? (
            /* ========== VISUALIZAÇÃO EM LISTA ========== */
            <section>
              <Card className="bg-white/5 backdrop-blur-sm border border-white/10">
                <CardContent className="p-6">
                  {eventosFiltrados.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="p-4 rounded-full bg-white/10 w-fit mx-auto mb-4">
                        <Calendar className="h-12 w-12 text-white/40" />
                      </div>
                      <h3 className="text-lg font-medium text-white mb-2">
                        Nenhum evento encontrado
                      </h3>
                      <p className="text-sm text-white/50 mb-6 max-w-md mx-auto">
                        {filtroTipo
                          ? "Não há eventos com este filtro. Tente outro filtro ou crie um novo evento."
                          : "Comece criando eventos nos processos para organizar seus compromissos."}
                      </p>
                      <Button
                        onClick={() => router.push('/kanban')}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        Ir para Processos
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {eventosFiltrados
                        .sort(
                          (a, b) =>
                            new Date(a.dataInicio).getTime() -
                            new Date(b.dataInicio).getTime()
                        )
                        .map((evento) => {
                          const tipoConfig = getTipoConfig(evento.tipo)
                          const Icon = tipoConfig.icon
                          const dataEvento = new Date(evento.dataInicio)
                          dataEvento.setHours(0, 0, 0, 0)
                          const isPassado = dataEvento < hoje
                          const isEventoHoje = dataEvento.getTime() === hoje.getTime()

                          return (
                            <div
                              key={evento.id}
                              className={`p-4 rounded-xl border transition-colors cursor-pointer ${
                                isPassado
                                  ? "bg-white/5 border-white/10 opacity-60"
                                  : isEventoHoje
                                  ? "bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20"
                                  : "bg-white/5 border-white/10 hover:bg-white/10"
                              }`}
                              onClick={() => router.push(`/kanban?processoId=${evento.processo.id}&tab=eventos&pais=${evento.processo.pais}`)}
                            >
                              <div className="flex items-start gap-4">
                                <div
                                  className="p-2.5 rounded-lg flex-shrink-0"
                                  style={{ backgroundColor: `${tipoConfig.cor}20` }}
                                >
                                  <Icon
                                    className="h-5 w-5"
                                    style={{ color: tipoConfig.cor }}
                                  />
                                </div>

                                <div className="flex-1 min-w-0">
                                  <div className="flex items-start justify-between gap-4">
                                    <div>
                                      <h4 className="font-medium text-white">
                                        {evento.titulo}
                                      </h4>
                                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                                        <span className="flex items-center gap-1 text-sm text-white/60">
                                          <Clock className="h-3.5 w-3.5" />
                                          {formatarData(evento.dataInicio, evento.diaInteiro)}
                                        </span>
                                        {evento.local && (
                                          <span className="flex items-center gap-1 text-sm text-white/60">
                                            <MapPin className="h-3.5 w-3.5" />
                                            {evento.local}
                                          </span>
                                        )}
                                      </div>
                                      {evento.descricao && (
                                        <p className="text-sm text-white/50 mt-2 line-clamp-2">
                                          {evento.descricao}
                                        </p>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-2 flex-shrink-0">
                                      <BandeiraPais pais={evento.processo.pais as any} size="sm" />
                                      <span className="text-sm text-white/60">
                                        {evento.processo.nome}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {isEventoHoje && (
                                <div className="mt-3 pt-3 border-t border-emerald-500/20">
                                  <span className="text-xs font-medium text-emerald-400">
                                    📅 Evento de hoje
                                  </span>
                                </div>
                              )}
                            </div>
                          )
                        })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          ) : (
            /* ========== VISUALIZAÇÃO EM CALENDÁRIO ========== */
            <section>
              <Card className="bg-white/5 backdrop-blur-sm border border-white/10">
                <CardContent className="p-6">
                  {/* Header do calendário */}
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-semibold text-white">
                      {MESES[mesAtual.getMonth()]} de {mesAtual.getFullYear()}
                    </h3>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => navegarMes(-1)}
                        className="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => setMesAtual(new Date())}
                        className="px-3 py-1.5 text-sm font-medium rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition-colors"
                      >
                        Hoje
                      </button>
                      <button
                        onClick={() => navegarMes(1)}
                        className="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    </div>
                  </div>

                  {/* Dias da semana */}
                  <div className="grid grid-cols-7 gap-1 mb-2">
                    {DIAS_SEMANA.map((dia) => (
                      <div
                        key={dia}
                        className="text-center text-xs font-medium text-white/50 py-2"
                      >
                        {dia}
                      </div>
                    ))}
                  </div>

                  {/* Dias do mês */}
                  <div className="grid grid-cols-7 gap-1">
                    {getDiasDoMes().map((dia, index) => {
                      if (dia === null) {
                        return <div key={`empty-${index}`} className="h-24" />
                      }

                      const eventosNoDia = getEventosDoDia(dia)
                      const ehHoje = isHoje(dia)

                      return (
                        <div
                          key={dia}
                          className={`h-24 p-1 rounded-lg border transition-colors ${
                            ehHoje
                              ? "bg-emerald-500/10 border-emerald-500/30"
                              : "border-white/10 hover:bg-white/5"
                          }`}
                        >
                          <div
                            className={`text-sm font-medium mb-1 ${
                              ehHoje ? "text-emerald-400" : "text-white/70"
                            }`}
                          >
                            {dia}
                          </div>
                          <div className="space-y-0.5 overflow-hidden">
                            {eventosNoDia.slice(0, 2).map((evento) => {
                              const tipoConfig = getTipoConfig(evento.tipo)
                              return (
                                <div
                                  key={evento.id}
                                  className="text-xs px-1.5 py-0.5 rounded truncate cursor-pointer hover:opacity-80"
                                  style={{
                                    backgroundColor: `${tipoConfig.cor}30`,
                                    color: tipoConfig.cor,
                                  }}
                                  title={evento.titulo}
                                  onClick={() => router.push(`/kanban?processoId=${evento.processo.id}&tab=eventos&pais=${evento.processo.pais}`)}
                                >
                                  {evento.titulo}
                                </div>
                              )
                            })}
                            {eventosNoDia.length > 2 && (
                              <div className="text-xs text-white/50 px-1">
                                +{eventosNoDia.length - 2} mais
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}
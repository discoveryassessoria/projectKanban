"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Settings,
  BarChart3,
  Clock,
  AlertTriangle,
  Calendar,
  Users,
  FolderOpen,
  ArrowRight,
  History,
  Plus,
  Edit,
  Trash2,
  ArrowRightLeft,
  TreeDeciduous,
  GitBranch,
} from "lucide-react"
import { HeaderBar } from "@/src/components/header-bar"

interface Usuario {
  id: number
  nome: string
  email: string
  tipo: string
}

interface Projeto {
  id: number
  nome: string
  descricao?: string
  atividades: Atividade[]
  status: Status[]
}

interface Atividade {
  id: number
  nome: string
  descricao?: string
  data_criacao: string
  data_termino?: string
  projeto?: { nome: string }
  status?: { nome: string }
  usuarios?: {
    usuario: {
      nome: string
      email: string
    }
  }[]
}

interface Arvore {
  id: number
  nome: string
  descricao?: string
  pessoas: any[]
}

interface Status {
  id: number
  nome: string
  ordem: number
}

interface LogAuditoria {
  id: number
  acao: string
  entidade: string
  entidadeId?: number
  descricao: string
  detalhes?: any
  criadoEm: string
  usuario?: {
    id: number
    nome: string
  }
  projeto?: {
    id: number
    nome: string
  }
}

export default function DashboardPage() {
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [projetos, setProjetos] = useState<Projeto[]>([])
  const [atividades, setAtividades] = useState<Atividade[]>([])
  const [arvores, setArvores] = useState<Arvore[]>([])
  const [logs, setLogs] = useState<LogAuditoria[]>([])
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
      fetchDashboardData()
    } catch (error) {
      console.error("Erro ao carregar dados do usuário:", error)
      router.push("/login")
    }
  }, [router])

  const fetchDashboardData = async () => {
    try {
      const projetosRes = await fetch("/api/projetos")
      const projetosData = await projetosRes.json()
      setProjetos(projetosData.projetos || [])

      const atividadesRes = await fetch("/api/activities")
      const atividadesData = await atividadesRes.json()
      setAtividades(Array.isArray(atividadesData) ? atividadesData : [])

      // Buscar logs de auditoria
      try {
        const logsRes = await fetch("/api/logs?limite=10")
        const logsData = await logsRes.json()
        setLogs(Array.isArray(logsData) ? logsData : [])
      } catch (e) {
        // API de logs ainda não existe, usar array vazio
        setLogs([])
      }

      const arvoresRes = await fetch("/api/arvore")
      const arvoresData = await arvoresRes.json()
      setArvores(Array.isArray(arvoresData) ? arvoresData : [])
    } catch (error) {
      console.error("Erro ao buscar dados do dashboard:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem("authToken")
    localStorage.removeItem("user")
    router.push("/login")
  }

  // ===== CÁLCULOS DE MÉTRICAS =====
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)

  // Tarefas vencidas (data_termino < hoje)
  const tarefasVencidas = atividades.filter(a => {
    if (!a.data_termino) return false
    const prazo = new Date(a.data_termino)
    prazo.setHours(0, 0, 0, 0)
    return prazo < hoje
  })

  // Tarefas para hoje
  const tarefasHoje = atividades.filter(a => {
    if (!a.data_termino) return false
    const prazo = new Date(a.data_termino)
    prazo.setHours(0, 0, 0, 0)
    return prazo.getTime() === hoje.getTime()
  })

  // Tarefas próximos 7 dias
  const proximaSemana = new Date(hoje)
  proximaSemana.setDate(proximaSemana.getDate() + 7)
  
  const tarefasProximaSemana = atividades.filter(a => {
    if (!a.data_termino) return false
    const prazo = new Date(a.data_termino)
    prazo.setHours(0, 0, 0, 0)
    return prazo > hoje && prazo <= proximaSemana
  })

  // Agrupar por status
  const atividadesPorStatus = atividades.reduce((acc, atividade) => {
    const statusNome = atividade.status?.nome || "Sem Status"
    if (!acc[statusNome]) acc[statusNome] = []
    acc[statusNome].push(atividade)
    return acc
  }, {} as Record<string, Atividade[]>)

  // Próximos prazos (ordenados por data)
  const proximosPrazos = atividades
    .filter(a => a.data_termino && new Date(a.data_termino) >= hoje)
    .sort((a, b) => new Date(a.data_termino!).getTime() - new Date(b.data_termino!).getTime())
    .slice(0, 5)

  // Formatar data
  const formatarData = (data: string) => {
    return new Date(data).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
  }

  const formatarDataRelativa = (data: string) => {
    const agora = new Date()
    const dataAtividade = new Date(data)
    const diffMs = agora.getTime() - dataAtividade.getTime()
    const diffHoras = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffHoras < 1) return "Agora mesmo"
    if (diffHoras < 24) return `Há ${diffHoras}h`
    if (diffDias === 1) return "Ontem"
    if (diffDias < 7) return `Há ${diffDias} dias`
    return dataAtividade.toLocaleDateString('pt-BR')
  }

  // ===== LOADING =====
  if (isLoading) {
    return (
      <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
        <div className="min-h-screen bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin h-12 w-12 border-4 border-white border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-white/70">Carregando painel principal...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!usuario) return null

  // ===== DASHBOARD =====
  return (
    <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />

      <HeaderBar
        title="Painel Principal"
        subtitle="Visão geral dos processos e atividades"
        userName={usuario.nome}
        userRole={usuario.tipo === 'admin' ? 'Administrador' : usuario.tipo}
        userEmail={usuario.email}
        projetos={projetos}
        atividades={atividades}
        arvores={arvores}
        onLogout={handleLogout}
      />

      <div className="min-h-screen relative">
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />
        
        <main className="relative px-6 py-6 space-y-6">
          {/* ===== BOAS-VINDAS + AÇÕES ===== */}
          <section className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h2 className="text-2xl md:text-3xl font-semibold">
                Bem-vindo, {usuario.nome}!
              </h2>
              <p className="text-sm text-white/70 mt-1">
                Aqui está o resumo dos seus processos e tarefas.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button 
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-9 px-4"
                onClick={() => router.push('/kanban')}
              >
                + Novo Processo
              </Button>
              <Button 
                className="bg-sky-600 hover:bg-sky-700 text-white text-xs h-9 px-4"
                onClick={() => router.push('/activities')}
              >
                + Nova Tarefa
              </Button>
              <Button
                variant="outline"
                className="border-white/30 bg-transparent text-xs text-white/80 hover:bg-white/10 hover:text-white h-9 px-4"
                onClick={() => router.push('/settings')}
              >
                <Settings className="h-3.5 w-3.5 mr-1.5" />
                Configurações
              </Button>
            </div>
          </section>

          {/* ===== CARDS DE MÉTRICAS PRINCIPAIS ===== */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Total de Processos */}
            <Card className="bg-white/10 backdrop-blur-sm border border-white/20 text-white">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-white/60 font-medium">Total de Processos</p>
                    <p className="text-3xl font-bold mt-2">{projetos.length}</p>
                    <p className="text-xs text-white/50 mt-1">famílias ativas</p>
                  </div>
                  <BarChart3 className="h-5 w-5 text-teal-400" />
                </div>
              </CardContent>
            </Card>

            {/* Tarefas Vencidas */}
            <Card className={`backdrop-blur-sm border text-white ${tarefasVencidas.length > 0 ? 'bg-yellow-500/15 border-yellow-500/30' : 'bg-white/10 border-white/20'}`}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-white/60 font-medium">Tarefas Vencidas</p>
                    <p className="text-3xl font-bold mt-2">{tarefasVencidas.length}</p>
                    <p className="text-xs text-white/50 mt-1">
                      {tarefasVencidas.length > 0 ? 'requer atenção!' : 'tudo em dia'}
                    </p>
                  </div>
                  <AlertTriangle className="h-5 w-5 text-yellow-400" />
                </div>
              </CardContent>
            </Card>

            {/* Tarefas para Hoje */}
            <Card className={`backdrop-blur-sm border text-white ${tarefasHoje.length > 0 ? 'bg-amber-700/15 border-amber-700/30' : 'bg-white/10 border-white/20'}`}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-white/60 font-medium">Tarefas para Hoje</p>
                    <p className="text-3xl font-bold mt-2">{tarefasHoje.length}</p>
                    <p className="text-xs text-white/50 mt-1">
                      {tarefasHoje.length > 0 ? 'a fazer hoje' : 'nada agendado'}
                    </p>
                  </div>
                  <Calendar className="h-5 w-5 text-amber-600" />
                </div>
              </CardContent>
            </Card>

            {/* Próxima Semana */}
            <Card className="bg-white/10 backdrop-blur-sm border border-white/20 text-white">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-white/60 font-medium">Próximos 7 dias</p>
                    <p className="text-3xl font-bold mt-2">{tarefasProximaSemana.length}</p>
                    <p className="text-xs text-white/50 mt-1">tarefas agendadas</p>
                  </div>
                  <Clock className="h-5 w-5 text-fuchsia-400" />
                </div>
              </CardContent>
            </Card>
          </section>

          {/* ===== PROCESSOS POR PAÍS ===== */}
          <section>
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-white">Processos por País</h3>
              <p className="text-xs text-white/50">Distribuição dos processos ativos</p>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {projetos.length === 0 ? (
                <Card className="col-span-full bg-white/5 backdrop-blur-sm border border-white/10">
                  <CardContent className="py-8 text-center">
                    <FolderOpen className="h-10 w-10 mx-auto mb-3 text-white/30" />
                    <p className="text-white/50 text-sm">Nenhum processo cadastrado</p>
                    <Button 
                      className="mt-4 bg-emerald-500 hover:bg-emerald-600 text-sm"
                      onClick={() => router.push('/kanban')}
                    >
                      Criar primeiro processo
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                projetos.map((projeto) => {
                  const qtdAtividades = projeto.atividades?.length || 0
                  
                  // Cores por país (tons únicos)
                  const coresIcone: Record<string, string> = {
                    "Itália": "text-emerald-500",
                    "Portugal": "text-sky-500",
                    "Espanha": "text-rose-500",
                    "Alemanha": "text-amber-500",
                  }
                  const corIcone = coresIcone[projeto.nome] || "text-violet-500"
                  
                  return (
                    <Card 
                      key={projeto.id}
                      className="bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all cursor-pointer"
                      onClick={() => router.push(`/kanban?projeto=${projeto.id}`)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                          <Users className={`h-5 w-5 ${corIcone}`} />
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium text-white text-sm">{projeto.nome}</h4>
                            <p className="text-xs text-white/50 mt-0.5">
                              {qtdAtividades} {qtdAtividades === 1 ? 'processo' : 'processos'}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })
              )}
            </div>
          </section>

          {/* ===== VISÃO PROCESSOS + ATIVIDADES RECENTES ===== */}
          <section className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* Visão Processos - 3 colunas */}
            <Card className="lg:col-span-3 bg-white/5 backdrop-blur-sm border border-white/10">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base text-white">Visão Rápida dos Processos</CardTitle>
                    <CardDescription className="text-xs text-white/50">
                      Processos por etapa
                    </CardDescription>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    className="text-white/60 hover:text-white hover:bg-white/10 text-xs"
                    onClick={() => router.push('/kanban')}
                  >
                    Ver Processos <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {Object.keys(atividadesPorStatus).length === 0 ? (
                  <div className="text-center py-8">
                    <FolderOpen className="h-10 w-10 mx-auto mb-3 text-white/30" />
                    <p className="text-sm text-white/50">Nenhum processo cadastrado</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {Object.entries(atividadesPorStatus).slice(0, 3).map(([statusNome, atividadesStatus], index) => {
                      const cores = [
                        { dot: "bg-sky-400", border: "border-sky-500/30", bg: "bg-sky-500/5" },
                        { dot: "bg-emerald-400", border: "border-emerald-500/30", bg: "bg-emerald-500/5" },
                        { dot: "bg-amber-400", border: "border-amber-500/30", bg: "bg-amber-500/5" }
                      ]
                      const cor = cores[index % 3]
                      
                      return (
                        <div key={statusNome} className={`rounded-xl border backdrop-blur-sm p-4 ${cor.bg} ${cor.border}`}>
                          {/* Header da coluna */}
                          <div className="flex items-center gap-2 mb-3">
                            <div className={`w-2 h-2 rounded-full ${cor.dot}`} />
                            <span className="text-xs font-medium text-white/80 uppercase tracking-wide flex-1">
                              {statusNome}
                            </span>
                            <span className="text-xs text-white/50">
                              {atividadesStatus.length}
                            </span>
                          </div>
                          
                          {/* Cards da coluna */}
                          <div className="space-y-2">
                            {atividadesStatus.slice(0, 3).map(atividade => (
                              <div 
                                key={atividade.id} 
                                className="rounded-lg bg-white/5 hover:bg-white/10 transition-colors p-3 cursor-pointer border border-white/5"
                                onClick={() => router.push('/kanban')}
                              >
                                <p className="text-sm font-medium text-white truncate">{atividade.nome}</p>
                                <p className="text-xs text-white/40 mt-1 truncate">
                                  {atividade.projeto?.nome || "Sem projeto"}
                                </p>
                              </div>
                            ))}
                            {atividadesStatus.length > 3 && (
                              <p className="text-xs text-white/40 text-center pt-1">
                                +{atividadesStatus.length - 3} mais
                              </p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Histórico de Atividades - 2 colunas */}
            <Card className="lg:col-span-2 bg-white/5 backdrop-blur-sm border border-white/10">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base text-white flex items-center gap-2">
                      <History className="h-4 w-4 text-white/60" />
                      Histórico
                    </CardTitle>
                    <CardDescription className="text-xs text-white/50">
                      Últimas alterações no sistema
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {logs.length === 0 ? (
                  <div className="text-center py-8">
                    <History className="h-10 w-10 mx-auto mb-3 text-white/30" />
                    <p className="text-sm text-white/50">Nenhuma atividade registrada</p>
                    <p className="text-xs text-white/30 mt-1">As alterações aparecerão aqui</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {logs.map((log) => {
                      // Ícone e cor baseado na ação
                      let IconeAcao = GitBranch
                      let corIcone = "text-white/50"
                      
                      if (log.acao === 'criou') {
                        IconeAcao = Plus
                        corIcone = "text-emerald-400"
                      } else if (log.acao === 'editou') {
                        IconeAcao = Edit
                        corIcone = "text-sky-400"
                      } else if (log.acao === 'excluiu') {
                        IconeAcao = Trash2
                        corIcone = "text-rose-400"
                      } else if (log.acao === 'moveu') {
                        IconeAcao = ArrowRightLeft
                        corIcone = "text-amber-400"
                      }

                      // Ícone da entidade
                      let IconeEntidade = FolderOpen
                      if (log.entidade === 'arvore') {
                        IconeEntidade = TreeDeciduous
                      } else if (log.entidade === 'processo' || log.entidade === 'card') {
                        IconeEntidade = FolderOpen
                      } else if (log.entidade === 'usuario') {
                        IconeEntidade = Users
                      }
                      
                      return (
                        <div 
                          key={log.id} 
                          className="p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors border border-white/5"
                        >
                          <div className="flex items-start gap-3">
                            <div className={`mt-0.5 p-1.5 rounded-lg bg-white/5 ${corIcone}`}>
                              <IconeAcao className="h-3.5 w-3.5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-white/90">{log.descricao}</p>
                              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                {log.usuario && (
                                  <span className="text-xs text-white/50">
                                    por {log.usuario.nome}
                                  </span>
                                )}
                                {log.projeto && (
                                  <>
                                    <span className="text-xs text-white/30">•</span>
                                    <span className="text-xs text-white/50">
                                      {log.projeto.nome}
                                    </span>
                                  </>
                                )}
                                <span className="text-xs text-white/30">•</span>
                                <span className="text-xs text-white/40">
                                  {formatarDataRelativa(log.criadoEm)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          {/* ===== PRÓXIMOS PRAZOS ===== */}
          {proximosPrazos.length > 0 && (
            <section>
              <Card className="bg-white/5 backdrop-blur-sm border border-white/10">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Clock className="h-5 w-5 text-fuchsia-400" />
                      <div>
                        <CardTitle className="text-base text-white">Próximos Prazos</CardTitle>
                        <CardDescription className="text-xs text-white/50">
                          Tarefas com prazo chegando
                        </CardDescription>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
                    {proximosPrazos.map((atividade) => {
                      const prazo = new Date(atividade.data_termino!)
                      const diffDias = Math.ceil((prazo.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24))
                      
                      let corBorda = "border-white/20"
                      let corTexto = "text-white/70"
                      if (diffDias <= 1) {
                        corBorda = "border-yellow-400/50"
                        corTexto = "text-yellow-400"
                      } else if (diffDias <= 3) {
                        corBorda = "border-amber-600/50"
                        corTexto = "text-amber-600"
                      }
                      
                      return (
                        <div 
                          key={atividade.id}
                          className={`p-4 rounded-xl bg-white/5 border ${corBorda} hover:bg-white/10 transition-colors cursor-pointer`}
                          onClick={() => router.push('/activities')}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className={`text-xs font-medium ${corTexto}`}>
                              {formatarData(atividade.data_termino!)}
                            </span>
                            {diffDias <= 1 && (
                              <AlertTriangle className="h-4 w-4 text-yellow-400" />
                            )}
                          </div>
                          <p className="text-sm font-medium text-white truncate">{atividade.nome}</p>
                          <p className="text-xs text-white/50 truncate mt-1">
                            {atividade.projeto?.nome || "Sem projeto"}
                          </p>
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
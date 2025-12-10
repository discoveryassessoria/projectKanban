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
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  LogOut,
  User,
  Settings,
  BarChart3,
  Search,
  Bell,
  FolderOpen,
  TreeDeciduous,
} from "lucide-react"

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

export default function DashboardPage() {
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [projetos, setProjetos] = useState<Projeto[]>([])
  const [atividades, setAtividades] = useState<Atividade[]>([])
  const [arvores, setArvores] = useState<Arvore[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<{
    projetos: Projeto[]
    atividades: Atividade[]
    arvores: Arvore[]
  }>({ projetos: [], atividades: [], arvores: [] })
  const [showSearchResults, setShowSearchResults] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
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
      
      // Buscar dados reais das APIs
      fetchDashboardData()
    } catch (error) {
      console.error("Erro ao carregar dados do usuário:", error)
      router.push("/login")
    }
  }, [router])

  const fetchDashboardData = async () => {
    try {
      // Buscar projetos
      const projetosRes = await fetch("/api/projetos")
      const projetosData = await projetosRes.json()
      setProjetos(projetosData.projetos || [])

      // Buscar atividades
      const atividadesRes = await fetch("/api/activities")
      const atividadesData = await atividadesRes.json()
      setAtividades(Array.isArray(atividadesData) ? atividadesData : [])

      // Buscar árvores
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

  const getInitials = (nome: string) => {
    return nome
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }

  // Calcular atividades pendentes (sem data_termino ou com prazo próximo)
  const atividadesPendentes = atividades.filter(a => {
    if (!a.data_termino) return true
    const prazo = new Date(a.data_termino)
    const hoje = new Date()
    return prazo >= hoje
  })

  // Agrupar atividades por status para o Kanban
  const atividadesPorStatus = atividades.reduce((acc, atividade) => {
    const statusNome = atividade.status?.nome || "Sem Status"
    if (!acc[statusNome]) {
      acc[statusNome] = []
    }
    acc[statusNome].push(atividade)
    return acc
  }, {} as Record<string, Atividade[]>)

  // Atividades recentes (últimas 5)
  const atividadesRecentes = [...atividades]
    .sort((a, b) => new Date(b.data_criacao).getTime() - new Date(a.data_criacao).getTime())
    .slice(0, 5)

  // Formatar data relativa
  const formatarDataRelativa = (data: string) => {
    const agora = new Date()
    const dataAtividade = new Date(data)
    const diffMs = agora.getTime() - dataAtividade.getTime()
    const diffHoras = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffHoras < 1) return "Agora mesmo"
    if (diffHoras < 24) return `Há ${diffHoras} hora${diffHoras > 1 ? 's' : ''}`
    if (diffDias === 1) return "Ontem"
    if (diffDias < 7) return `Há ${diffDias} dias`
    return dataAtividade.toLocaleDateString('pt-BR')
  }

  // Função de pesquisa global
  const handleSearch = (query: string) => {
    setSearchQuery(query)
    
    if (query.trim() === "") {
      setShowSearchResults(false)
      setSearchResults({ projetos: [], atividades: [], arvores: [] })
      return
    }

    const queryLower = query.toLowerCase()

    // Filtrar projetos
    const projetosFiltrados = projetos.filter(p => 
      p.nome.toLowerCase().includes(queryLower) ||
      p.descricao?.toLowerCase().includes(queryLower)
    )

    // Filtrar atividades
    const atividadesFiltradas = atividades.filter(a => 
      a.nome.toLowerCase().includes(queryLower) ||
      a.descricao?.toLowerCase().includes(queryLower) ||
      a.projeto?.nome.toLowerCase().includes(queryLower)
    )

    // Filtrar árvores
    const arvoresFiltradas = arvores.filter(a => 
      a.nome.toLowerCase().includes(queryLower) ||
      a.descricao?.toLowerCase().includes(queryLower)
    )

    setSearchResults({
      projetos: projetosFiltrados.slice(0, 3),
      atividades: atividadesFiltradas.slice(0, 3),
      arvores: arvoresFiltradas.slice(0, 3)
    })
    setShowSearchResults(true)
  }

  // Contar total de resultados
  const totalResults = searchResults.projetos.length + searchResults.atividades.length + searchResults.arvores.length

  // ====== NOTIFICAÇÕES ======
  // Filtrar atividades do usuário logado
  const minhasAtividades = atividades.filter(a => 
    a.usuarios?.some(u => u.usuario.email === usuario?.email)
  )

  // Calcular notificações
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)

  const notificacoes = {
    vencidas: minhasAtividades.filter(a => {
      if (!a.data_termino) return false
      const prazo = new Date(a.data_termino)
      prazo.setHours(0, 0, 0, 0)
      return prazo < hoje
    }),
    hoje: minhasAtividades.filter(a => {
      if (!a.data_termino) return false
      const prazo = new Date(a.data_termino)
      prazo.setHours(0, 0, 0, 0)
      return prazo.getTime() === hoje.getTime()
    }),
    proximos3Dias: minhasAtividades.filter(a => {
      if (!a.data_termino) return false
      const prazo = new Date(a.data_termino)
      prazo.setHours(0, 0, 0, 0)
      const em3Dias = new Date(hoje)
      em3Dias.setDate(hoje.getDate() + 3)
      return prazo > hoje && prazo <= em3Dias
    }),
    novas: minhasAtividades.filter(a => {
      const criacao = new Date(a.data_criacao)
      const umDiaAtras = new Date()
      umDiaAtras.setDate(umDiaAtras.getDate() - 1)
      return criacao >= umDiaAtras
    })
  }

  const totalNotificacoes = notificacoes.vencidas.length + notificacoes.hoje.length + notificacoes.proximos3Dias.length + notificacoes.novas.length

  // ====== ESTADO CARREGANDO ======
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

  if (!usuario) {
    return null
  }

  // ====== DASHBOARD COM DADOS REAIS ======
  return (
    <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
      {/* BACKGROUND FIXO SEM OVERLAY */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />

      {/* HEADER */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/40 backdrop-blur-md shadow-lg">
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold leading-tight text-white">
              Grupo Discovery · Painel Principal
            </h1>
            <p className="text-xs text-white/70">
              Visão geral dos projetos e atividades
            </p>
          </div>

          <div className="flex items-center gap-4">
            {/* Barra de pesquisa funcional */}
            <div className="relative hidden md:block">
              <div className="flex items-center gap-2 px-3 py-2 rounded-full border border-white/30">
                <Search className="h-4 w-4 text-white/70" />
                <input
                  className="bg-transparent text-xs outline-none placeholder:text-white/60 w-40 text-white"
                  placeholder="Pesquisar no sistema..."
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  onFocus={() => setShowSearchResults(true)}
                  onBlur={() => setTimeout(() => setShowSearchResults(false), 200)}
                />
              </div>

              {/* Dropdown de resultados */}
              {showSearchResults && (
                <div className="absolute top-full mt-2 left-0 right-0 w-80 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden z-50">
                  {totalResults === 0 ? (
                    <div className="px-4 py-6 text-center text-gray-400">
                      <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm text-gray-600">Nenhum resultado encontrado</p>
                      <p className="text-xs mt-1 text-gray-400">Tente buscar por outro termo</p>
                    </div>
                  ) : (
                    <div className="max-h-80 overflow-y-auto">
                      {/* Projetos */}
                      {searchResults.projetos.length > 0 && (
                        <div>
                          <div className="px-3 py-2 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500 font-medium">
                            Projetos
                          </div>
                          {searchResults.projetos.map(projeto => (
                            <button
                              key={`projeto-${projeto.id}`}
                              className="w-full px-3 py-2 flex items-center gap-3 hover:bg-gray-100 transition text-left"
                              onClick={() => {
                                router.push('/kanban')
                                setShowSearchResults(false)
                                setSearchQuery("")
                              }}
                            >
                              <BarChart3 className="h-4 w-4 text-sky-500 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-800 truncate">{projeto.nome}</p>
                                <p className="text-[10px] text-gray-400 truncate">{projeto.descricao || "Sem descrição"}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Atividades */}
                      {searchResults.atividades.length > 0 && (
                        <div>
                          <div className="px-3 py-2 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500 font-medium">
                            Atividades
                          </div>
                          {searchResults.atividades.map(atividade => (
                            <button
                              key={`atividade-${atividade.id}`}
                              className="w-full px-3 py-2 flex items-center gap-3 hover:bg-gray-100 transition text-left"
                              onClick={() => {
                                router.push('/activities')
                                setShowSearchResults(false)
                                setSearchQuery("")
                              }}
                            >
                              <FolderOpen className="h-4 w-4 text-amber-500 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-800 truncate">{atividade.nome}</p>
                                <p className="text-[10px] text-gray-400 truncate">{atividade.projeto?.nome || "Sem projeto"}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Árvores */}
                      {searchResults.arvores.length > 0 && (
                        <div>
                          <div className="px-3 py-2 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500 font-medium">
                            Árvores Genealógicas
                          </div>
                          {searchResults.arvores.map(arvore => (
                            <button
                              key={`arvore-${arvore.id}`}
                              className="w-full px-3 py-2 flex items-center gap-3 hover:bg-gray-100 transition text-left"
                              onClick={() => {
                                router.push('/genealogy')
                                setShowSearchResults(false)
                                setSearchQuery("")
                              }}
                            >
                              <TreeDeciduous className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-800 truncate">{arvore.nome}</p>
                                <p className="text-[10px] text-gray-400 truncate">{arvore.pessoas?.length || 0} pessoas</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Botão de notificações funcional */}
            <div className="relative hidden md:block">
              <button 
                className="relative inline-flex items-center justify-center rounded-full p-2 border border-white/30 hover:bg-white/10 transition"
                onClick={() => setShowNotifications(!showNotifications)}
                onBlur={() => setTimeout(() => setShowNotifications(false), 200)}
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
                    <div className="max-h-80 overflow-y-auto">
                      {/* Vencidas */}
                      {notificacoes.vencidas.length > 0 && (
                        <div>
                          <div className="px-3 py-2 bg-red-50 text-[10px] uppercase tracking-wide text-red-600 font-medium flex items-center gap-1">
                            <span className="h-2 w-2 rounded-full bg-red-500"></span>
                            Vencidas ({notificacoes.vencidas.length})
                          </div>
                          {notificacoes.vencidas.map(atividade => (
                            <button
                              key={`vencida-${atividade.id}`}
                              className="w-full px-3 py-2 flex items-start gap-3 hover:bg-gray-50 transition text-left border-l-4 border-red-500"
                              onClick={() => {
                                router.push('/activities')
                                setShowNotifications(false)
                              }}
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-800 truncate font-medium">{atividade.nome}</p>
                                <p className="text-[10px] text-gray-500">{atividade.projeto?.nome}</p>
                                <p className="text-[10px] text-red-500 font-medium">
                                  Venceu em {new Date(atividade.data_termino!).toLocaleDateString('pt-BR')}
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Vencem hoje */}
                      {notificacoes.hoje.length > 0 && (
                        <div>
                          <div className="px-3 py-2 bg-amber-50 text-[10px] uppercase tracking-wide text-amber-600 font-medium flex items-center gap-1">
                            <span className="h-2 w-2 rounded-full bg-amber-500"></span>
                            Vencem hoje ({notificacoes.hoje.length})
                          </div>
                          {notificacoes.hoje.map(atividade => (
                            <button
                              key={`hoje-${atividade.id}`}
                              className="w-full px-3 py-2 flex items-start gap-3 hover:bg-gray-50 transition text-left border-l-4 border-amber-500"
                              onClick={() => {
                                router.push('/activities')
                                setShowNotifications(false)
                              }}
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-800 truncate font-medium">{atividade.nome}</p>
                                <p className="text-[10px] text-gray-500">{atividade.projeto?.nome}</p>
                                <p className="text-[10px] text-amber-600 font-medium">Vence hoje!</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Próximos 3 dias */}
                      {notificacoes.proximos3Dias.length > 0 && (
                        <div>
                          <div className="px-3 py-2 bg-orange-50 text-[10px] uppercase tracking-wide text-orange-600 font-medium flex items-center gap-1">
                            <span className="h-2 w-2 rounded-full bg-orange-500"></span>
                            Próximos 3 dias ({notificacoes.proximos3Dias.length})
                          </div>
                          {notificacoes.proximos3Dias.map(atividade => (
                            <button
                              key={`proximos-${atividade.id}`}
                              className="w-full px-3 py-2 flex items-start gap-3 hover:bg-gray-50 transition text-left border-l-4 border-orange-500"
                              onClick={() => {
                                router.push('/activities')
                                setShowNotifications(false)
                              }}
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-800 truncate font-medium">{atividade.nome}</p>
                                <p className="text-[10px] text-gray-500">{atividade.projeto?.nome}</p>
                                <p className="text-[10px] text-orange-600 font-medium">
                                  Vence em {new Date(atividade.data_termino!).toLocaleDateString('pt-BR')}
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Novas atribuições */}
                      {notificacoes.novas.length > 0 && (
                        <div>
                          <div className="px-3 py-2 bg-blue-50 text-[10px] uppercase tracking-wide text-blue-600 font-medium flex items-center gap-1">
                            <span className="h-2 w-2 rounded-full bg-blue-500"></span>
                            Novas atribuições ({notificacoes.novas.length})
                          </div>
                          {notificacoes.novas.map(atividade => (
                            <button
                              key={`nova-${atividade.id}`}
                              className="w-full px-3 py-2 flex items-start gap-3 hover:bg-gray-50 transition text-left border-l-4 border-blue-500"
                              onClick={() => {
                                router.push('/activities')
                                setShowNotifications(false)
                              }}
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-800 truncate font-medium">{atividade.nome}</p>
                                <p className="text-[10px] text-gray-500">{atividade.projeto?.nome}</p>
                                <p className="text-[10px] text-blue-600 font-medium">Nova tarefa atribuída a você</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {totalNotificacoes > 0 && (
                    <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
                      <button 
                        className="w-full text-center text-xs text-blue-600 hover:text-blue-800 font-medium"
                        onClick={() => {
                          router.push('/activities')
                          setShowNotifications(false)
                        }}
                      >
                        Ver todas as atividades
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Avatar className="h-9 w-9 border border-white/30">
                <AvatarFallback className="bg-transparent text-xs font-medium text-white">
                  {getInitials(usuario.nome)}
                </AvatarFallback>
              </Avatar>
              <div className="hidden md:block">
                <p className="text-xs font-medium leading-tight text-white">
                  {usuario.nome}
                </p>
                <p className="text-[11px] text-white/70 leading-tight">
                  {usuario.tipo === 'admin' ? 'Administrador' : usuario.tipo}
                </p>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              className="border-white/30 text-xs bg-transparent hover:bg-red-500/20 hover:border-red-400/50 text-white hover:text-red-400 flex items-center justify-center gap-1.5"
            >
              <LogOut className="h-3 w-3" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      {/* CONTEÚDO COM OVERLAY ESCURO IGUAL SIDEBAR/HEADER */}
      <div className="min-h-screen relative">
        {/* Overlay apenas na área do conteúdo */}
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />
        <main className="relative px-6 py-6 space-y-6">
          {/* Boas-vindas + Botões rápidos */}
          <section className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h2 className="text-2xl md:text-3xl font-semibold">
                Bem-vindo, {usuario.nome}!
              </h2>
              <p className="text-sm text-white/70 mt-1">
                Aqui está um resumo das suas atividades, projetos e árvores genealógicas.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button 
                className="bg-emerald-500 hover:bg-emerald-600 text-xs md:text-sm inline-flex items-center justify-center gap-1.5 h-9"
                onClick={() => router.push('/kanban')}
              >
                <span className="-mt-[2px]">+</span>
                <span>Novo projeto</span>
              </Button>
              <Button 
                className="bg-sky-500 hover:bg-sky-600 text-xs md:text-sm inline-flex items-center justify-center gap-1.5 h-9"
                onClick={() => router.push('/activities')}
              >
                <span className="-mt-[2px]">+</span>
                <span>Nova atividade</span>
              </Button>
              <Button
                variant="outline"
                className="border-white/40 bg-transparent text-xs md:text-sm text-white hover:bg-white/10 hover:text-white inline-flex items-center justify-center gap-1.5 h-9"
                onClick={() => router.push('/settings')}
              >
                <Settings className="h-3.5 w-3.5" />
                <span>Configurações</span>
              </Button>
            </div>
          </section>

          {/* CARDS DE STATUS COM DADOS REAIS */}
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card className="bg-transparent border border-white/30 text-white rounded-2xl">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-medium">
                  Projetos Ativos
                </CardTitle>
                <BarChart3 className="h-4 w-4 text-sky-300" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold">{projetos.length}</div>
                <p className="text-[11px] text-white/70 mt-1">
                  {projetos.length === 0 
                    ? "Nenhum projeto cadastrado" 
                    : `${projetos.length} projeto${projetos.length > 1 ? 's' : ''} no sistema`}
                </p>
              </CardContent>
            </Card>

            <Card className="bg-transparent border border-white/30 text-white rounded-2xl">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-medium">
                  Atividades Pendentes
                </CardTitle>
                <User className="h-4 w-4 text-amber-300" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold">{atividadesPendentes.length}</div>
                <p className="text-[11px] text-white/70 mt-1">
                  {atividadesPendentes.length === 0 
                    ? "Nenhuma atividade pendente" 
                    : `${atividades.length} atividade${atividades.length > 1 ? 's' : ''} no total`}
                </p>
              </CardContent>
            </Card>

            <Card className="bg-transparent border border-white/30 text-white rounded-2xl">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-medium">
                  Árvores Genealógicas
                </CardTitle>
                <TreeDeciduous className="h-4 w-4 text-violet-300" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold">{arvores.length}</div>
                <p className="text-[11px] text-white/70 mt-1">
                  {arvores.length === 0 
                    ? "Nenhuma árvore cadastrada" 
                    : `${arvores.reduce((acc, a) => acc + (a.pessoas?.length || 0), 0)} pessoa${arvores.reduce((acc, a) => acc + (a.pessoas?.length || 0), 0) !== 1 ? 's' : ''} registrada${arvores.reduce((acc, a) => acc + (a.pessoas?.length || 0), 0) !== 1 ? 's' : ''}`}
                </p>
              </CardContent>
            </Card>
          </section>

          {/* VISÃO KANBAN + ATIVIDADES RECENTES */}
          <section className="grid grid-cols-1 lg:grid-cols-[2fr,1.3fr] gap-4">
            {/* Mini visão Kanban com dados reais */}
            <Card className="bg-transparent border border-white/30 text-white rounded-2xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">
                  Visão rápida de Negócios / Kanban
                </CardTitle>
                <CardDescription className="text-xs text-white/70">
                  Resumo visual das principais etapas dos seus projetos
                </CardDescription>
              </CardHeader>
              <CardContent>
                {Object.keys(atividadesPorStatus).length === 0 ? (
                  <div className="text-center py-8">
                    <FolderOpen className="h-12 w-12 mx-auto mb-3 text-white/60" />
                    <p className="text-sm text-white/80">Nenhuma atividade cadastrada</p>
                    <p className="text-xs mt-1 text-white/60">Crie atividades para visualizar o Kanban</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    {Object.entries(atividadesPorStatus).slice(0, 3).map(([statusNome, atividadesStatus], index) => {
                      const cores = [
                        "from-sky-500/80 to-sky-700/90",
                        "from-emerald-500/80 to-emerald-700/90",
                        "from-amber-500/80 to-amber-700/90"
                      ]
                      return (
                        <div key={statusNome} className={`rounded-xl bg-gradient-to-b ${cores[index % 3]} p-3 space-y-2 shadow-md backdrop-blur-sm`}>
                          <p className="font-semibold text-[11px] uppercase tracking-wide">
                            {statusNome}
                          </p>
                          <div className="space-y-1.5">
                            {atividadesStatus.slice(0, 2).map(atividade => (
                              <div key={atividade.id} className="rounded-lg bg-white/10 px-2 py-1 backdrop-blur-sm">
                                <p className="text-[11px] truncate">{atividade.nome}</p>
                                <p className="text-[10px] opacity-80">
                                  {atividade.projeto?.nome || "Sem projeto"}
                                </p>
                              </div>
                            ))}
                            {atividadesStatus.length > 2 && (
                              <p className="text-[10px] opacity-70 text-center">
                                +{atividadesStatus.length - 2} mais
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

            {/* Atividades recentes com dados reais */}
            <Card className="bg-transparent border border-white/30 text-white rounded-2xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Atividades recentes</CardTitle>
                <CardDescription className="text-xs text-white/70">
                  Últimas ações registradas no sistema
                </CardDescription>
              </CardHeader>
              <CardContent>
                {atividadesRecentes.length === 0 ? (
                  <div className="text-center py-8">
                    <Bell className="h-12 w-12 mx-auto mb-3 text-white/60" />
                    <p className="text-sm text-white/80">Nenhuma atividade recente</p>
                    <p className="text-xs mt-1 text-white/60">As atividades aparecerão aqui</p>
                  </div>
                ) : (
                  <div className="space-y-4 text-xs">
                    {atividadesRecentes.map((atividade, index) => {
                      const cores = ["bg-emerald-400", "bg-sky-400", "bg-violet-400", "bg-amber-400", "bg-rose-400"]
                      return (
                        <div key={atividade.id} className="flex items-start gap-3">
                          <div className={`mt-1 h-2 w-2 rounded-full ${cores[index % 5]}`} />
                          <div className="flex-1">
                            <p className="font-medium text-[13px]">{atividade.nome}</p>
                            <p className="text-white/70 text-[11px]">
                              {atividade.projeto?.nome || "Sem projeto"} · {formatarDataRelativa(atividade.data_criacao)}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        </main>
      </div>
    </div>
  )
}
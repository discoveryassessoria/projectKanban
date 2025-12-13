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
  User,
  Settings,
  BarChart3,
  Bell,
  FolderOpen,
  TreeDeciduous,
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

export default function DashboardPage() {
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [projetos, setProjetos] = useState<Projeto[]>([])
  const [atividades, setAtividades] = useState<Atividade[]>([])
  const [arvores, setArvores] = useState<Arvore[]>([])
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

      {/* HEADER - Novo componente reutilizável */}
      <HeaderBar
        title="Painel Principal"
        subtitle="Visão geral dos projetos e atividades"
        userName={usuario.nome}
        userRole={usuario.tipo === 'admin' ? 'Administrador' : usuario.tipo}
        userEmail={usuario.email}
        projetos={projetos}
        atividades={atividades}
        arvores={arvores}
        onLogout={handleLogout}
      />

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
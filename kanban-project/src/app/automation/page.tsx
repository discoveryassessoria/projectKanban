"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Zap, Workflow, GitBranch, Clock, Mail, Bell, FileText, Settings2 } from "lucide-react"
import { HeaderBar } from "@/src/components/header-bar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface User {
  nome: string
  tipo?: string
  email?: string
}

export default function AutomationPage() {
  const router = useRouter()
  const [user, setUser] = useState<User>({ nome: "Usuário" })
  const [loading, setLoading] = useState(true)

  // Estados para dados do HeaderBar
  const [projetos, setProjetos] = useState<any[]>([])
  const [processos, setProcessos] = useState<any[]>([])
  const [arvores, setArvores] = useState<any[]>([])

  const handleLogout = () => {
    localStorage.removeItem("authToken")
    localStorage.removeItem("user")
    router.push("/login")
  }

  useEffect(() => {
    // Verificar autenticação
    const token = localStorage.getItem("authToken")
    const userData = localStorage.getItem("user")

    if (!token || !userData) {
      router.push("/login")
      return
    }

    try {
      setUser(JSON.parse(userData))
    } catch {
      setUser({ nome: "Usuário" })
    }

    fetchHeaderData()
  }, [router])

  const fetchHeaderData = async () => {
    try {
      const [projetosRes, processosRes, arvoresRes] = await Promise.all([
        fetch("/api/projetos"),
        fetch("/api/processos"),
        fetch("/api/arvore")
      ])

      const projetosData = await projetosRes.json()
      setProjetos(projetosData.projetos || [])

      const processosData = await processosRes.json()
      setProcessos(processosData.processos || [])

      const arvoresData = await arvoresRes.json()
      setArvores(Array.isArray(arvoresData) ? arvoresData : [])
    } catch (error) {
      console.error("Erro ao buscar dados:", error)
    } finally {
      setLoading(false)
    }
  }

  // Exemplos de automações futuras
  const automacoesFuturas = [
    {
      icon: Clock,
      titulo: "Lembretes Automáticos",
      descricao: "Notificações automáticas para prazos de tarefas",
      cor: "from-amber-500 to-orange-600"
    },
    {
      icon: Mail,
      titulo: "E-mails Programados",
      descricao: "Envio automático de relatórios e atualizações",
      cor: "from-blue-500 to-cyan-600"
    },
    {
      icon: GitBranch,
      titulo: "Fluxos de Trabalho",
      descricao: "Automatize a transição de status em processos",
      cor: "from-purple-500 to-pink-600"
    },
    {
      icon: Bell,
      titulo: "Alertas Inteligentes",
      descricao: "Notificações baseadas em condições específicas",
      cor: "from-emerald-500 to-teal-600"
    },
    {
      icon: FileText,
      titulo: "Geração de Relatórios",
      descricao: "Relatórios automáticos semanais ou mensais",
      cor: "from-rose-500 to-red-600"
    },
    {
      icon: Settings2,
      titulo: "Integrações",
      descricao: "Conecte com outras ferramentas e serviços",
      cor: "from-indigo-500 to-violet-600"
    }
  ]

  // Loading state
  if (loading) {
    return (
      <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
        <div className="min-h-screen bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin h-12 w-12 border-4 border-white border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-white/70">Carregando automações...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
      {/* BACKGROUND FIXO */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />

      {/* HEADER */}
      <HeaderBar
        title="Automação"
        subtitle="Automatize processos e fluxos de trabalho"
        userName={user.nome}
        userRole={user.tipo === 'admin' ? 'Administrador' : user.tipo || 'Usuário'}
        userEmail={user.email || ''}
        projetos={projetos}
        processos={processos}
        arvores={arvores}
        onLogout={handleLogout}
      />

      {/* CONTEÚDO COM OVERLAY */}
      <div className="min-h-screen relative">
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />
        <main className="relative px-6 py-6">
          
          {/* Banner "Em Breve" */}
          <div className="mb-8">
            <Card className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-white/20 backdrop-blur-xl">
              <CardContent className="py-8">
                <div className="flex flex-col md:flex-row items-center gap-6">
                  <div className="p-4 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl shadow-lg">
                    <Zap className="h-12 w-12 text-white" />
                  </div>
                  <div className="text-center md:text-left">
                    <h2 className="text-2xl font-bold text-white mb-2">
                      Automações em Desenvolvimento
                    </h2>
                    <p className="text-white/70 max-w-xl">
                      Estamos trabalhando em recursos poderosos de automação para otimizar 
                      seus processos. Em breve você poderá criar fluxos de trabalho automatizados, 
                      lembretes inteligentes e muito mais.
                    </p>
                  </div>
                  <div className="md:ml-auto">
                    <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/20 border border-amber-400/30 text-amber-300 text-sm font-medium">
                      <Workflow className="h-4 w-4" />
                      Em Breve
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Grid de Funcionalidades Futuras */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-white mb-4">
              Funcionalidades Planejadas
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {automacoesFuturas.map((item, index) => (
                <Card 
                  key={index} 
                  className="bg-white/5 border border-white/10 backdrop-blur-sm hover:bg-white/10 transition-all duration-300 cursor-default group"
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start gap-4">
                      <div className={`p-3 rounded-xl bg-gradient-to-br ${item.cor} shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                        <item.icon className="h-6 w-6 text-white" />
                      </div>
                      <div>
                        <CardTitle className="text-white text-base">{item.titulo}</CardTitle>
                        <CardDescription className="text-white/60 text-sm mt-1">
                          {item.descricao}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </div>

          {/* Sugestão */}
          <Card className="bg-white/5 border border-white/10 backdrop-blur-sm">
            <CardContent className="py-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-400/30">
                  <Bell className="h-6 w-6 text-emerald-400" />
                </div>
                <div>
                  <h4 className="text-white font-medium">Tem alguma sugestão?</h4>
                  <p className="text-white/60 text-sm">
                    Entre em contato conosco para sugerir novas automações que você gostaria de ver no sistema.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

        </main>
      </div>
    </div>
  )
}
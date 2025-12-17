"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { getStoredUser, isAuthenticated } from "@/lib/auth"
import { KanbanBoard } from "@/src/components/kanban-board-novo"
import { ProcessosLista } from "@/src/components/processos-lista"
import { ContratantesTabela } from "@/src/components/contratantes-tabela"
import { PaisTabs } from "@/src/components/ui/pais-selector"
import { HeaderBar } from "@/src/components/header-bar"
import { 
  Pais, 
  type AtividadeWithStatus, 
  type Status,
  type Contratante, 
  type Requerente 
} from "@/src/types/kanban"

interface User {
  id: number
  nome: string
  email: string
  tipo: string
}

type TabPrincipal = "processos" | "contratantes"
type SubTab = "kanban" | "lista"

export default function ProcessosPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  
  // Tabs
  const [tabPrincipal, setTabPrincipal] = useState<TabPrincipal>("processos")
  const [subTab, setSubTab] = useState<SubTab>("kanban")
  
  // Ler país da URL ou usar Portugal como padrão
  const paisDaUrl = searchParams.get("pais") as Pais | null
  const paisInicial = paisDaUrl && Object.values(Pais).includes(paisDaUrl) ? paisDaUrl : Pais.PORTUGAL
  
  const [paisSelecionado, setPaisSelecionado] = useState<Pais>(paisInicial)
  
  const [atividades, setAtividades] = useState<AtividadeWithStatus[]>([])
  const [statusList, setStatusList] = useState<Status[]>([])
  const [contratantes, setContratantes] = useState<Contratante[]>([])
  const [requerentes, setRequerentes] = useState<Requerente[]>([])
  const [arvores, setArvores] = useState<any[]>([])

  // Atualizar país quando URL mudar
  useEffect(() => {
    if (paisDaUrl && Object.values(Pais).includes(paisDaUrl)) {
      setPaisSelecionado(paisDaUrl)
    }
  }, [paisDaUrl])

  const handleLogout = () => {
    localStorage.removeItem("authToken")
    localStorage.removeItem("user")
    router.push("/login")
  }

  // Buscar status por país
  const buscarStatus = useCallback(async (pais: Pais) => {
    try {
      const response = await fetch(`/api/status?pais=${pais}`)
      if (response.ok) {
        const data = await response.json()
        setStatusList(data.status || [])
      }
    } catch (error) {
      console.error("Erro ao buscar status:", error)
    }
  }, [])

  // Buscar atividades por país
  const buscarAtividades = useCallback(async (pais: Pais) => {
    try {
      const response = await fetch(`/api/atividades?pais=${pais}`)
      if (response.ok) {
        const data = await response.json()
        setAtividades(data.atividades || [])
      }
    } catch (error) {
      console.error("Erro ao buscar atividades:", error)
    }
  }, [])

  const buscarContratantes = async () => {
    try {
      const response = await fetch("/api/contratantes")
      if (response.ok) {
        const { contratantes } = await response.json()
        setContratantes(contratantes || [])
      }
    } catch (error) {
      console.error("Erro ao buscar contratantes:", error)
    }
  }

  const buscarRequerentes = async () => {
    try {
      const response = await fetch("/api/requerentes")
      if (response.ok) {
        const { requerentes } = await response.json()
        setRequerentes(requerentes || [])
      }
    } catch (error) {
      console.error("Erro ao buscar requerentes:", error)
    }
  }

  const buscarArvores = async () => {
    try {
      const response = await fetch("/api/arvore")
      if (response.ok) {
        const data = await response.json()
        setArvores(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error("Erro ao buscar árvores:", error)
    }
  }

  // Efeito inicial - autenticação e dados globais
  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login")
      return
    }
    const userData = getStoredUser()
    if (!userData) {
      router.push("/login")
      return
    }
    setUser(userData)
    
    // Buscar dados globais (não dependem do país)
    Promise.all([
      buscarContratantes(),
      buscarRequerentes(),
      buscarArvores()
    ]).finally(() => {
      setLoading(false)
    })
  }, [router])

  // Efeito quando país muda - buscar status e atividades do país
  useEffect(() => {
    buscarStatus(paisSelecionado)
    buscarAtividades(paisSelecionado)
  }, [paisSelecionado, buscarStatus, buscarAtividades])

  // Refresh apenas do país atual
  const handleRefresh = useCallback(() => {
    buscarStatus(paisSelecionado)
    buscarAtividades(paisSelecionado)
    buscarContratantes()
  }, [paisSelecionado, buscarStatus, buscarAtividades])

  if (loading) {
    return (
      <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
        <div className="min-h-screen bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin h-12 w-12 border-4 border-white border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-white/70">Carregando...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />

      <HeaderBar
        title={tabPrincipal === "processos" ? "Processos" : "Clientes"}
        subtitle={tabPrincipal === "processos" ? "Gerencie seus processos de cidadania" : "Gerencie seus clientes"}
        userName={user?.nome || "Usuário"}
        userRole={user?.tipo === 'admin' ? 'Administrador' : user?.tipo || "Usuário"}
        userEmail={user?.email || ""}
        projetos={[]}
        atividades={atividades}
        arvores={arvores}
        onLogout={handleLogout}
      />

      <div className="min-h-screen relative">
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />
        <main className="relative px-6 py-6 max-w-full">
          
          {/* TABS PRINCIPAIS */}
          <div className="bg-white/5 border border-white/15 rounded-2xl p-4 backdrop-blur-xl shadow-lg mb-4">
            <div className="flex items-center justify-between flex-wrap gap-4">
              
              {/* Tabs Processos / Clientes */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTabPrincipal("processos")}
                  className={`
                    px-4 py-2 rounded-lg font-medium transition-all duration-200
                    ${tabPrincipal === "processos"
                      ? "bg-indigo-600 text-white shadow-lg"
                      : "bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
                    }
                  `}
                >
                  Processos
                </button>
                <button
                  onClick={() => setTabPrincipal("contratantes")}
                  className={`
                    px-4 py-2 rounded-lg font-medium transition-all duration-200
                    ${tabPrincipal === "contratantes"
                      ? "bg-indigo-600 text-white shadow-lg"
                      : "bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
                    }
                  `}
                >
                  Clientes
                </button>
              </div>

              {/* Sub-tabs Kanban / Lista (só aparece em Processos) */}
              {tabPrincipal === "processos" && (
                <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
                  <button
                    onClick={() => setSubTab("kanban")}
                    className={`
                      px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200
                      ${subTab === "kanban"
                        ? "bg-white/20 text-white"
                        : "text-white/60 hover:text-white hover:bg-white/10"
                      }
                    `}
                  >
                    Kanban
                  </button>
                  <button
                    onClick={() => setSubTab("lista")}
                    className={`
                      px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200
                      ${subTab === "lista"
                        ? "bg-white/20 text-white"
                        : "text-white/60 hover:text-white hover:bg-white/10"
                      }
                    `}
                  >
                    Lista
                  </button>
                </div>
              )}

              {/* Contador + Países (só em Processos) */}
              {tabPrincipal === "processos" && (
                <div className="flex items-center gap-4">
                  <div className="flex flex-col items-center px-4 py-2 bg-white/10 rounded-lg">
                    <span className="text-2xl font-bold text-white">
                      {atividades.length}
                    </span>
                    <span className="text-xs text-white/60">processo(s)</span>
                  </div>

                  <PaisTabs
                    selectedPais={paisSelecionado}
                    onSelect={setPaisSelecionado}
                  />
                </div>
              )}

              {/* Contador Clientes */}
              {tabPrincipal === "contratantes" && (
                <div className="flex flex-col items-center px-4 py-2 bg-white/10 rounded-lg">
                  <span className="text-2xl font-bold text-white">
                    {contratantes.length}
                  </span>
                  <span className="text-xs text-white/60">cliente(s)</span>
                </div>
              )}
            </div>
          </div>

          {/* CONTEÚDO */}
          <div className="bg-white/5 border border-white/15 rounded-2xl p-4 backdrop-blur-xl shadow-lg w-full overflow-hidden">
            
            {/* Processos - Kanban */}
            {tabPrincipal === "processos" && subTab === "kanban" && (
              <KanbanBoard 
                pais={paisSelecionado}
                atividades={atividades}
                statusList={statusList}
                contratantes={contratantes}
                requerentes={requerentes}
                onRefresh={handleRefresh}
              />
            )}

            {/* Processos - Lista */}
            {tabPrincipal === "processos" && subTab === "lista" && (
              <ProcessosLista
                atividades={atividades}
                statusList={statusList}
                contratantes={contratantes}
                onRefresh={handleRefresh}
              />
            )}

            {/* Clientes - Tabela */}
            {tabPrincipal === "contratantes" && (
              <ContratantesTabela
                contratantes={contratantes}
                onRefresh={handleRefresh}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
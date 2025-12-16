"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { getStoredUser, isAuthenticated } from "@/lib/auth"
import { KanbanBoard } from "@/src/components/kanban-board-novo"
import { PaisTabs } from "@/src/components/ui/pais-selector"
import { HeaderBar } from "@/src/components/header-bar"
import { 
  Pais, 
  PAISES_CONFIG,
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

export default function ProcessosPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  
  const [paisSelecionado, setPaisSelecionado] = useState<Pais>(Pais.PORTUGAL)
  
  const [atividades, setAtividades] = useState<AtividadeWithStatus[]>([])
  const [statusList, setStatusList] = useState<Status[]>([])
  const [contratantes, setContratantes] = useState<Contratante[]>([])
  const [requerentes, setRequerentes] = useState<Requerente[]>([])
  const [arvores, setArvores] = useState<any[]>([])

  const handleLogout = () => {
    localStorage.removeItem("authToken")
    localStorage.removeItem("user")
    router.push("/login")
  }

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
    
    Promise.all([
      buscarStatus(),
      buscarAtividades(),
      buscarContratantes(),
      buscarRequerentes(),
      buscarArvores()
    ]).finally(() => {
      setLoading(false)
    })
  }, [router])

  const buscarStatus = async () => {
    try {
      const response = await fetch("/api/status")
      if (response.ok) {
        const data = await response.json()
        setStatusList(data.status || [])
      }
    } catch (error) {
      console.error("Erro ao buscar status:", error)
    }
  }

  const buscarAtividades = async () => {
    try {
      const response = await fetch("/api/atividades")
      if (response.ok) {
        const data = await response.json()
        setAtividades(data.atividades || [])
      }
    } catch (error) {
      console.error("Erro ao buscar atividades:", error)
    }
  }

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

  const handleRefresh = () => {
    Promise.all([buscarStatus(), buscarAtividades()])
  }

  const atividadesFiltradas = atividades.filter(a => a.pais === paisSelecionado)

  if (loading) {
    return (
      <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
        <div className="min-h-screen bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin h-12 w-12 border-4 border-white border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-white/70">Carregando processos...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />

      <HeaderBar
        title="Processos"
        subtitle="Gerencie seus processos de cidadania"
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
        <main className="relative px-6 py-6 max-w-full overflow-x-auto">
          
          {/* SELETOR DE PAÍS */}
          <div className="bg-white/5 border border-white/15 rounded-2xl p-4 backdrop-blur-xl shadow-lg mb-4">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex flex-col items-center px-4 py-2 bg-white/10 rounded-lg">
                <span className="text-2xl font-bold text-white">
                  {atividadesFiltradas.length}
                </span>
                <span className="text-xs text-white/60">processo(s)</span>
              </div>

              <PaisTabs
                selectedPais={paisSelecionado}
                onSelect={setPaisSelecionado}
              />
            </div>
          </div>

          {/* KANBAN BOARD */}
          <div className="bg-white/5 border border-white/15 rounded-2xl p-4 backdrop-blur-xl shadow-lg w-full overflow-hidden">
            <KanbanBoard 
              pais={paisSelecionado}
              atividades={atividadesFiltradas}
              statusList={statusList}
              contratantes={contratantes}
              requerentes={requerentes}
              onRefresh={handleRefresh}
            />
          </div>
        </main>
      </div>
    </div>
  )
}
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { getStoredUser, isAuthenticated } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { ProjectSelector } from "@/components/ui/project-selector"
import { 
  KanbanIcon, 
  Trash2, 
  Sparkles, 
  Info, 
} from "lucide-react"
import ModalNovoProjeto from "@/src/components/kanban/modal-novo-projeto"
import { KanbanBoard } from "@/src/components/kanban"
import { ContratanteModal } from "@/src/components/kanban/contratante-modal"
import { RequerenteModal } from "@/src/components/kanban/requerente-modal"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { HeaderBar } from "@/src/components/header-bar"
import type { Projeto, Contratante, Requerente } from "@/src/types/kanban"

interface User {
  id: number
  nome: string
  email: string
  tipo: string
}

export default function KanbanPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [projetos, setProjetos] = useState<Projeto[]>([])
  const [projetoSelecionado, setProjetoSelecionado] = useState<Projeto | null>(null)
  const [loading, setLoading] = useState(true)
  const [isModalNovoProjetoOpen, setIsModalNovoProjetoOpen] = useState(false)
  
  // Estados para atividades e árvores (para o HeaderBar)
  const [atividades, setAtividades] = useState<any[]>([])
  const [arvores, setArvores] = useState<any[]>([])
  
  const [contratantes, setContratantes] = useState<Contratante[]>([])
  const [requerentes, setRequerentes] = useState<Requerente[]>([])
  
  const [contratanteModal, setContratanteModal] = useState({
    isOpen: false,
    mode: 'view' as 'view' | 'create' | 'edit',
    contratante: null as Contratante | null
  })
  
  const [requerenteModal, setRequerenteModal] = useState({
    isOpen: false,
    mode: 'view' as 'view' | 'create' | 'edit',
    requerente: null as Requerente | null
  })

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
      buscarProjetos(userData.id),
      buscarContratantes(),
      buscarRequerentes(),
      buscarAtividades(),
      buscarArvores()
    ]).finally(() => {
      setLoading(false)
    })
  }, [router])

  const buscarProjetos = async (userId: number) => {
    try {
      const response = await fetch("/api/projetos")
      if (response.ok) {
        const data = await response.json()
        const projetosCarregados: Projeto[] = data.projetos || []
        setProjetos(projetosCarregados)

        if (projetoSelecionado) {
          const projetoAtualizado = projetosCarregados.find((p) => p.id === projetoSelecionado.id)
          setProjetoSelecionado(projetoAtualizado || null)
        } else if (projetosCarregados.length > 0) {
          setProjetoSelecionado(projetosCarregados[0])
        }
      } else {
        console.error("Erro ao buscar projetos")
        setProjetos([])
      }
    } catch (error) {
      console.error("Erro na requisição:", error)
      setProjetos([])
    }
  }

  const buscarAtividades = async () => {
    try {
      const response = await fetch("/api/activities")
      if (response.ok) {
        const data = await response.json()
        setAtividades(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error("Erro ao buscar atividades:", error)
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

  const handleStatusAdd = () => {
    if (user) {
      buscarProjetos(user.id)
    }
  }

  const handleNovoProjeto = () => {
    setIsModalNovoProjetoOpen(true)
  }

  const handleProjetoSelect = (projeto: Projeto) => {
    setProjetoSelecionado(projeto)
  }

  const handleCriarProjeto = async (dados: { nome: string; descricao: string }) => {
    try {
      if (!user) throw new Error("Usuário não encontrado")

      const response = await fetch("/api/projetos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...dados, usuarioId: user.id }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Erro desconhecido" }))
        throw new Error(errorData.error)
      }

      const { projeto } = await response.json()
      setProjetos((prev) => [...prev, projeto])
      setProjetoSelecionado(projeto)
    } catch (error) {
      console.error("Erro ao criar projeto:", error)
      alert("Erro ao criar projeto: " + (error instanceof Error ? error.message : "Erro"))
      throw error
    }
  }

  const handleDeletarProjeto = async (projetoId: number) => {
    try {
      const response = await fetch(`/api/projetos/${projetoId}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Erro desconhecido" }))
        throw new Error(errorData.error)
      }

      const projetosRestantes = projetos.filter((p) => p.id !== projetoId)
      setProjetos(projetosRestantes)

      if (projetoSelecionado?.id === projetoId) {
        setProjetoSelecionado(projetosRestantes.length > 0 ? projetosRestantes[0] : null)
      }
    } catch (error) {
      console.error("Erro ao deletar projeto:", error)
      alert("Erro ao deletar projeto: " + (error instanceof Error ? error.message : "Erro"))
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

  const handleContratanteAdd = () => {
    setContratanteModal({
      isOpen: true,
      mode: 'create',
      contratante: null
    })
  }

  const handleContratanteEdit = (contratante: Contratante) => {
    setContratanteModal({
      isOpen: true,
      mode: 'edit',
      contratante
    })
  }

  const handleContratanteSelect = async (contratante: Contratante | null) => {
    if (!projetoSelecionado) return

    try {
      const response = await fetch(`/api/projetos/${projetoSelecionado.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          contratanteId: contratante?.id || null 
        }),
      })

      if (response.ok) {
        setProjetoSelecionado(prev => prev ? {
          ...prev,
          contratante: contratante
        } : null)

        setProjetos(prev => prev.map(p => 
          p.id === projetoSelecionado.id 
            ? { ...p, contratante: contratante }
            : p
        ))
      } else {
        throw new Error("Falha ao atualizar contratante do projeto")
      }
    } catch (error) {
      console.error("Erro ao associar contratante:", error)
      alert("Erro ao associar contratante ao projeto.")
    }
  }

  const handleContratanteSave = async (contratanteData: Omit<Contratante, 'id'>) => {
    try {
      if (contratanteModal.mode === 'edit' && contratanteModal.contratante) {
        const response = await fetch(`/api/contratantes/${contratanteModal.contratante.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(contratanteData),
        })

        if (response.ok) {
          const { contratante } = await response.json()
          setContratantes(prev => prev.map(c => c.id === contratante.id ? contratante : c))
          
          if (projetoSelecionado?.contratante?.id === contratante.id) {
            setProjetoSelecionado(prev => prev ? { ...prev, contratante } : null)
          }
          
          setContratanteModal(prev => ({ ...prev, isOpen: false }))
          await buscarContratantes()
        }
      } else {
        const response = await fetch("/api/contratantes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(contratanteData),
        })

        if (response.ok) {
          const { contratante } = await response.json()
          setContratantes(prev => [...prev, contratante])
          setContratanteModal(prev => ({ ...prev, isOpen: false }))
        }
      }
    } catch (error) {
      console.error("Erro ao salvar contratante:", error)
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

  const handleRequerenteAdd = () => {
    setRequerenteModal({
      isOpen: true,
      mode: 'create',
      requerente: null
    })
  }

  const handleRequerenteEdit = (requerente: Requerente) => {
    setRequerenteModal({
      isOpen: true,
      mode: 'edit',
      requerente
    })
  }

  const handleRequerenteSelect = async (requerentes: Requerente[]) => {
    if (!projetoSelecionado) return

    try {
      const requerenteIds = requerentes.map(r => r.id)
      
      const response = await fetch(`/api/projetos/${projetoSelecionado.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          requerenteIds: requerenteIds
        }),
      })

      if (response.ok) {
        const projetoAtualizado = await response.json()
        
        setProjetoSelecionado(prev => prev ? {
          ...prev,
          requerentes: projetoAtualizado.requerentes
        } : null)

        setProjetos(prev => prev.map(p => 
          p.id === projetoSelecionado.id 
            ? { ...p, requerentes: projetoAtualizado.requerentes }
            : p
        ))
      } else {
        throw new Error("Falha ao atualizar requerentes do projeto")
      }
    } catch (error) {
      console.error("Erro ao associar requerentes:", error)
      alert("Erro ao associar requerentes ao projeto.")
    }
  }

  const handleRequerenteSave = async (requerenteData: Omit<Requerente, 'id'>) => {
    try {
      if (requerenteModal.mode === 'edit' && requerenteModal.requerente) {
        const response = await fetch(`/api/requerentes/${requerenteModal.requerente.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requerenteData),
        })

        if (response.ok) {
          const { requerente } = await response.json()
          setRequerentes(prev => prev.map(r => r.id === requerente.id ? requerente : r))
          
          if (projetoSelecionado?.requerentes?.some(r => r.requerente.id === requerente.id)) {
            setProjetoSelecionado(prev => prev ? {
              ...prev,
              requerentes: prev.requerentes?.map(r => r.requerente.id === requerente.id ? { requerente } : r)
            } : null)
          }
          
          setRequerenteModal(prev => ({ ...prev, isOpen: false }))
          await buscarRequerentes()
        }
      } else {
        const response = await fetch("/api/requerentes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requerenteData),
        })

        if (response.ok) {
          const { requerente } = await response.json()
          setRequerentes(prev => [...prev, requerente])
          setRequerenteModal(prev => ({ ...prev, isOpen: false }))
        }
      }
    } catch (error) {
      console.error("Erro ao salvar requerente:", error)
    }
  }

  // ====== TELA DE CARREGAMENTO ======
  if (loading) {
    return (
      <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
        <div className="min-h-screen bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin h-12 w-12 border-4 border-white border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-white/70">Carregando kanban...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
      {/* BACKGROUND FIXO */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />

      {/* HEADER - Componente reutilizável */}
      <HeaderBar
        title="Processos"
        subtitle="Gerencie seus projetos em formato Kanban"
        userName={user?.nome || "Usuário"}
        userRole={user?.tipo === 'admin' ? 'Administrador' : user?.tipo || "Usuário"}
        userEmail={user?.email || ""}
        projetos={projetos}
        atividades={atividades}
        arvores={arvores}
        onLogout={handleLogout}
      />

      {/* CONTEÚDO */}
      <div className="min-h-screen relative">
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />
        <main className="relative px-6 py-6 max-w-full overflow-x-auto">
          
          {/* Se tem projetos, mostra botões e seletor */}
          {projetos.length > 0 && (
            <>
              {/* Botões de ação */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    onClick={handleNovoProjeto}
                    className="bg-emerald-500 hover:bg-emerald-600 text-xs md:text-sm inline-flex items-center justify-center gap-1.5 h-9"
                  >
                    <span className="-mt-[2px]">+</span>
                    <span>Novo Projeto</span>
                  </Button>
                  
                  {projetoSelecionado && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-red-400/40 text-red-300 bg-red-500/10 hover:bg-red-500/20 h-9"
                      onClick={() => {
                        if (confirm(`Tem certeza que deseja deletar o projeto "${projetoSelecionado.nome}"?`)) {
                          handleDeletarProjeto(projetoSelecionado.id)
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Seletor de projeto */}
              <div className="bg-white/5 border border-white/15 rounded-2xl p-4 backdrop-blur-xl shadow-lg mb-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg">
                      <KanbanIcon className="h-5 w-5 text-white" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-white/80">Projeto Atual</span>
                      <ProjectSelector
                        projetos={projetos}
                        selectedProject={projetoSelecionado}
                        onSelect={handleProjetoSelect}
                        placeholder="Selecione um projeto"
                        className="min-w-[250px]"
                      />
                    </div>
                  </div>
                  
                  {projetoSelecionado?.descricao && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-white/10">
                            <Info className="h-4 w-4 text-sky-300" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs">{projetoSelecionado.descricao}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Kanban ou estado vazio */}
          {projetoSelecionado ? (
            <div className="bg-white/5 border border-white/15 rounded-2xl p-4 backdrop-blur-xl shadow-lg w-full overflow-hidden">
              <KanbanBoard 
                projeto={projetoSelecionado} 
                onStatusAdd={handleStatusAdd}
                contratantes={contratantes}
                requerentes={requerentes}
                selectedContratantes={projetoSelecionado.contratante ? [projetoSelecionado.contratante] : []}
                selectedRequerentes={projetoSelecionado.requerentes?.map(r => r.requerente) || []}
                onContratantesChange={async (contratantes) => {
                  const contratante = contratantes.length > 0 ? contratantes[0] : null
                  await handleContratanteSelect(contratante)
                  if (user) {
                    buscarProjetos(user.id)
                  }
                }}
                onRequerentesChange={async (requerentes) => {
                  await handleRequerenteSelect(requerentes)
                  if (user) {
                    buscarProjetos(user.id)
                  }
                }}
                onContratanteAdd={handleContratanteAdd}
                onRequerenteAdd={handleRequerenteAdd}
                onContratanteView={handleContratanteEdit}
                onRequerenteView={handleRequerenteEdit}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-[calc(100vh-200px)]">
              <div className="text-center">
                <div className="inline-flex p-4 bg-white/10 rounded-2xl mb-4">
                  <Sparkles className="h-16 w-16 text-white/60" />
                </div>
                <h2 className="text-2xl font-semibold mb-2 text-white/80">
                  Nenhum projeto encontrado
                </h2>
                <p className="text-white/60 mb-6">
                  Crie seu primeiro projeto para começar
                </p>
                <Button
                  onClick={handleNovoProjeto}
                  className="bg-emerald-500 hover:bg-emerald-600 inline-flex items-center justify-center gap-1.5 h-10 px-6"
                >
                  <span className="-mt-[2px]">+</span>
                  <span>Criar Primeiro Projeto</span>
                </Button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Modais */}
      <ModalNovoProjeto
        isOpen={isModalNovoProjetoOpen}
        onClose={() => setIsModalNovoProjetoOpen(false)}
        onSubmit={handleCriarProjeto}
      />

      <ContratanteModal
        contratante={contratanteModal.contratante}
        isOpen={contratanteModal.isOpen}
        onClose={() => setContratanteModal(prev => ({ ...prev, isOpen: false }))}
        onSave={handleContratanteSave}
        mode={contratanteModal.mode}
      />

      <RequerenteModal
        requerente={requerenteModal.requerente}
        isOpen={requerenteModal.isOpen}
        onClose={() => setRequerenteModal(prev => ({ ...prev, isOpen: false }))}
        onSave={handleRequerenteSave}
        mode={requerenteModal.mode}
      />
    </div>
  )
}
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
  Plus, 
  Info, 
  Search, 
  Bell, 
  LogOut,
  Settings,
  BarChart3,
  FolderOpen,
  TreeDeciduous
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import ModalNovoProjeto from "@/src/components/kanban/modal-novo-projeto"
import { KanbanBoard } from "@/src/components/kanban"
import { ContratanteModal } from "@/src/components/kanban/contratante-modal"
import { RequerenteModal } from "@/src/components/kanban/requerente-modal"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
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
  
  // Estados para pesquisa
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<{
    projetos: Projeto[]
  }>({ projetos: [] })
  const [showSearchResults, setShowSearchResults] = useState(false)

  // Estados para notificações
  const [showNotifications, setShowNotifications] = useState(false)
  
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

  const getInitials = (nome: string) => {
    return nome
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }

  const handleLogout = () => {
    localStorage.removeItem("authToken")
    localStorage.removeItem("user")
    router.push("/login")
  }

  // Função de pesquisa
  const handleSearch = (query: string) => {
    setSearchQuery(query)
    
    if (query.trim() === "") {
      setSearchResults({ projetos: [] })
      return
    }

    const queryLower = query.toLowerCase()

    const projetosFiltrados = projetos.filter(p => 
      p.nome.toLowerCase().includes(queryLower) ||
      p.descricao?.toLowerCase().includes(queryLower)
    )

    setSearchResults({
      projetos: projetosFiltrados.slice(0, 5)
    })
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
      buscarRequerentes()
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

      {/* HEADER PADRONIZADO */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/40 backdrop-blur-md shadow-lg">
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold leading-tight text-white">
              Grupo Discovery · Kanban
            </h1>
            <p className="text-xs text-white/70">
              Gerencie seus projetos em formato Kanban
            </p>
          </div>

          <div className="flex items-center gap-4">
            {/* Barra de pesquisa funcional */}
            <div className="relative hidden md:block">
              <div className="flex items-center gap-2 px-3 py-2 rounded-full border border-white/30">
                <Search className="h-4 w-4 text-white/70" />
                <input
                  className="bg-transparent text-xs outline-none placeholder:text-white/60 w-40 text-white"
                  placeholder="Pesquisar projetos..."
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  onFocus={() => setShowSearchResults(true)}
                  onBlur={() => setTimeout(() => setShowSearchResults(false), 200)}
                />
              </div>

              {/* Dropdown de resultados */}
              {showSearchResults && (
                <div className="absolute top-full mt-2 left-0 right-0 w-80 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden z-50">
                  {searchResults.projetos.length === 0 ? (
                    <div className="px-4 py-6 text-center text-gray-400">
                      <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm text-gray-600">Nenhum resultado encontrado</p>
                      <p className="text-xs mt-1 text-gray-400">Tente buscar por outro termo</p>
                    </div>
                  ) : (
                    <div className="max-h-80 overflow-y-auto">
                      <div className="px-3 py-2 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500 font-medium">
                        Projetos
                      </div>
                      {searchResults.projetos.map(projeto => (
                        <button
                          key={`projeto-${projeto.id}`}
                          className="w-full px-3 py-2 flex items-center gap-3 hover:bg-gray-100 transition text-left"
                          onClick={() => {
                            setProjetoSelecionado(projeto)
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
              </button>

              {/* Dropdown de notificações */}
              {showNotifications && (
                <div className="absolute top-full mt-2 right-0 w-80 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden z-50">
                  <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                    <h3 className="font-semibold text-gray-800 text-sm">Notificações</h3>
                    <p className="text-xs text-gray-500">0 pendentes</p>
                  </div>

                  <div className="px-4 py-8 text-center">
                    <Bell className="h-10 w-10 mx-auto mb-2 text-gray-300" />
                    <p className="text-sm text-gray-500">Nenhuma notificação</p>
                    <p className="text-xs text-gray-400 mt-1">Você está em dia!</p>
                  </div>
                </div>
              )}
            </div>

            {user && (
              <>
                <div className="flex items-center gap-2">
                  <Avatar className="h-9 w-9 border border-white/30">
                    <AvatarFallback className="bg-transparent text-xs font-medium text-white">
                      {getInitials(user.nome)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden md:block">
                    <p className="text-xs font-medium leading-tight text-white">
                      {user.nome}
                    </p>
                    <p className="text-[11px] text-white/70 leading-tight">
                      {user.tipo === 'admin' ? 'Administrador' : user.tipo}
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
              </>
            )}
          </div>
        </div>
      </header>

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
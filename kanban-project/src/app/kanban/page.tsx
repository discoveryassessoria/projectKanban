"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { getStoredUser, isAuthenticated } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { ProjectSelector } from "@/components/ui/project-selector"
import { ContratanteSelector } from "@/components/ui/contratante-selector"
import { RequerenteSelector } from "@/components/ui/requerente-selector"
import { KanbanIcon, Trash2, Sparkles, Plus, Info } from "lucide-react"
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
  
  // Estados para contratantes e requerentes
  const [contratantes, setContratantes] = useState<Contratante[]>([])
  const [requerentes, setRequerentes] = useState<Requerente[]>([])
  
  // Estados para modais
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

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/auth")
      return
    }
    const userData = getStoredUser()
    if (!userData) {
      router.push("/auth")
      return
    }
    setUser(userData)
    buscarProjetos(userData.id)
    buscarContratantes()
    buscarRequerentes()
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
    } finally {
      setLoading(false)
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

  // Funções para contratantes
  const buscarContratantes = async () => {
    try {
      const response = await fetch("/api/contratantes")
      if (response.ok) {
        const { contratantes } = await response.json()
        console.log("Contratantes carregados:", contratantes)
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

  const handleContratanteView = (contratante: Contratante) => {
    setContratanteModal({
      isOpen: true,
      mode: 'view',
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
        // Atualizar o projeto local
        setProjetoSelecionado(prev => prev ? {
          ...prev,
          contratante: contratante
        } : null)

        // Atualizar a lista de projetos
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
      const response = await fetch("/api/contratantes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contratanteData),
      })

      if (response.ok) {
        const { contratante } = await response.json()
        setContratantes(prev => [...prev, contratante])
        
        // Fechar o modal após salvar
        setContratanteModal(prev => ({ ...prev, isOpen: false }))
      }
    } catch (error) {
      console.error("Erro ao salvar contratante:", error)
    }
  }

  // Funções para requerentes
  const buscarRequerentes = async () => {
    try {
      const response = await fetch("/api/requerentes")
      if (response.ok) {
        const { requerentes } = await response.json()
        console.log("Requerentes carregados:", requerentes)
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

  const handleRequerenteView = (requerente: Requerente) => {
    setRequerenteModal({
      isOpen: true,
      mode: 'view',
      requerente
    })
  }

  const handleRequerenteSelect = async (requerente: Requerente | null) => {
    if (!projetoSelecionado) return

    try {
      const response = await fetch(`/api/projetos/${projetoSelecionado.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          requerenteId: requerente?.id || null 
        }),
      })

      if (response.ok) {
        // Atualizar o projeto local
        setProjetoSelecionado(prev => prev ? {
          ...prev,
          requerente: requerente
        } : null)

        // Atualizar a lista de projetos
        setProjetos(prev => prev.map(p => 
          p.id === projetoSelecionado.id 
            ? { ...p, requerente: requerente }
            : p
        ))
      } else {
        throw new Error("Falha ao atualizar requerente do projeto")
      }
    } catch (error) {
      console.error("Erro ao associar requerente:", error)
      alert("Erro ao associar requerente ao projeto.")
    }
  }

  const handleRequerenteSave = async (requerenteData: Omit<Requerente, 'id'>) => {
    try {
      const response = await fetch("/api/requerentes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requerenteData),
      })

      if (response.ok) {
        const { requerente } = await response.json()
        setRequerentes(prev => [...prev, requerente])
        
        // Fechar o modal após salvar
        setRequerenteModal(prev => ({ ...prev, isOpen: false }))
      }
    } catch (error) {
      console.error("Erro ao salvar requerente:", error)
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white dark:bg-gray-900">
        <div className="text-center">
          <KanbanIcon className="h-12 w-12 animate-pulse text-indigo-500 dark:text-indigo-400 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Carregando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      {/* Header */}
      <div className="flex items-center justify-between space-y-2">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Kanban</h2>
          <p className="text-gray-600 dark:text-gray-400">
            Gerencie seus projetos em formato Kanban
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            onClick={handleNovoProjeto}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4 mr-2" />
            Novo Projeto
          </Button>
          
          {projetoSelecionado && (
            <Button
              variant="outline"
              size="sm"
              className="hover:bg-red-50 hover:text-red-600 hover:border-red-200"
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

      {/* Project Selection and Controls */}
      {projetos.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg p-4 shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg">
                  <KanbanIcon className="h-5 w-5 text-white" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Projeto Atual</span>
                  <ProjectSelector
                    projetos={projetos}
                    selectedProject={projetoSelecionado}
                    onSelect={handleProjetoSelect}
                    placeholder="Selecione um projeto"
                    className="min-w-[250px]"
                  />
                </div>
              </div>
              
              {/* Ícone de informação para descrição do projeto */}
              {projetoSelecionado?.descricao && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <Info className="h-4 w-4 text-blue-600" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">{projetoSelecionado.descricao}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>

            {/* Seletores de Contratante e Requerente */}
            {projetoSelecionado && (
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Contratante</span>
                  <ContratanteSelector
                    contratantes={contratantes}
                    selectedContratante={projetoSelecionado.contratante || null}
                    onSelect={handleContratanteSelect}
                    onAdd={handleContratanteAdd}
                    onView={handleContratanteView}
                    className="w-[180px]"
                  />
                </div>
                
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Requerente</span>
                  <RequerenteSelector
                    requerentes={requerentes}
                    selectedRequerente={projetoSelecionado.requerente || null}
                    onSelect={handleRequerenteSelect}
                    onAdd={handleRequerenteAdd}
                    onView={handleRequerenteView}
                    className="w-[180px]"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Content */}
      {projetoSelecionado ? (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg shadow-sm">
            <div className="p-6">
              <KanbanBoard projeto={projetoSelecionado} onStatusAdd={handleStatusAdd} />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center h-[calc(100vh-300px)]">
          <div className="text-center">
            <div className="inline-flex p-4 bg-gray-100 dark:bg-gray-800 rounded-2xl mb-4">
              <Sparkles className="h-16 w-16 text-indigo-500 dark:text-indigo-400" />
            </div>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
              {projetos.length === 0 ? "Nenhum projeto encontrado" : "Selecione um projeto"}
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              {projetos.length === 0 
                ? "Crie seu primeiro projeto para começar" 
                : "Selecione um projeto na seção acima para visualizar o Kanban"
              }
            </p>
            {projetos.length === 0 && (
              <Button
                onClick={handleNovoProjeto}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                <Plus className="h-4 w-4 mr-2" />
                Criar Primeiro Projeto
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      <ModalNovoProjeto
        isOpen={isModalNovoProjetoOpen}
        onClose={() => setIsModalNovoProjetoOpen(false)}
        onSubmit={handleCriarProjeto}
      />

      {/* Modais para Contratante e Requerente */}
      <ContratanteModal
        contratante={contratanteModal.contratante}
        isOpen={contratanteModal.isOpen}
        onClose={() => setContratanteModal(prev => ({ ...prev, isOpen: false }))}
        onSave={contratanteModal.mode === 'create' ? handleContratanteSave : undefined}
        mode={contratanteModal.mode}
      />

      <RequerenteModal
        requerente={requerenteModal.requerente}
        isOpen={requerenteModal.isOpen}
        onClose={() => setRequerenteModal(prev => ({ ...prev, isOpen: false }))}
        onSave={requerenteModal.mode === 'create' ? handleRequerenteSave : undefined}
        mode={requerenteModal.mode}
      />
    </div>
  )
}

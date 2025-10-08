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
        setContratantes(contratantes)
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

  const handleContratanteSelect = (contratante: Contratante | null) => {
    // Aqui você pode implementar a lógica para associar o contratante ao projeto
    console.log("Contratante selecionado:", contratante)
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
        setRequerentes(requerentes)
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

  const handleRequerenteSelect = (requerente: Requerente | null) => {
    // Aqui você pode implementar a lógica para associar o requerente ao projeto
    console.log("Requerente selecionado:", requerente)
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
      }
    } catch (error) {
      console.error("Erro ao salvar requerente:", error)
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <div className="text-center">
          <KanbanIcon className="h-12 w-12 animate-pulse text-indigo-500 mx-auto mb-4" />
          <p className="text-gray-600">Carregando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white">
      <main className="flex flex-col min-h-screen">
        <header className="p-6 bg-gray-50 border-b border-gray-200 z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg">
                  <KanbanIcon className="h-5 w-5 text-white" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900">Kanban</h1>
              </div>
              
              {projetos.length > 0 && (
                <ProjectSelector
                  projetos={projetos}
                  selectedProject={projetoSelecionado}
                  onSelect={handleProjetoSelect}
                  placeholder="Selecione um projeto"
                  className="min-w-[250px]"
                />
              )}
              
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

            <div className="flex items-center gap-2">
              {/* Seletores de Contratante e Requerente */}
              {projetoSelecionado && (
                <>
                  <ContratanteSelector
                    contratantes={contratantes}
                    selectedContratante={projetoSelecionado.contratante || null}
                    onSelect={handleContratanteSelect}
                    onAdd={handleContratanteAdd}
                    onView={handleContratanteView}
                    className="w-[200px]"
                  />
                  
                  <RequerenteSelector
                    requerentes={requerentes}
                    selectedRequerente={projetoSelecionado.requerente || null}
                    onSelect={handleRequerenteSelect}
                    onAdd={handleRequerenteAdd}
                    onView={handleRequerenteView}
                    className="w-[200px]"
                  />
                </>
              )}
              
              <Button
                onClick={handleNovoProjeto}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                <Plus className="h-4 w-4 mr-2" />
                Novo Projeto
              </Button>
              
              {projetoSelecionado && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="hover:bg-red-100 hover:text-red-600 text-gray-600"
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
        </header>

        {projetoSelecionado ? (
          <div className="flex-1 p-6 overflow-auto">
            <div className="h-full">
              <KanbanBoard projeto={projetoSelecionado} onStatusAdd={handleStatusAdd} />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="inline-flex p-4 bg-gray-100 rounded-2xl mb-4">
                <Sparkles className="h-16 w-16 text-indigo-500" />
              </div>
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                {projetos.length === 0 ? "Nenhum projeto encontrado" : "Selecione um projeto"}
              </h2>
              <p className="text-gray-600 mb-6">
                {projetos.length === 0 
                  ? "Crie seu primeiro projeto para começar" 
                  : "Selecione um projeto no cabeçalho ou crie um novo"
                }
              </p>
            </div>
          </div>
        )}
      </main>

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

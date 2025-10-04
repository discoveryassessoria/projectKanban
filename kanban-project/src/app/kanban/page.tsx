"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { getStoredUser, isAuthenticated } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { KanbanIcon, Trash2, Sparkles } from "lucide-react"
import { SidebarTrigger } from "@/components/ui/sidebar"
import MenuLateral from "@/src/components/kanban/menu-lateral"
import ModalNovoProjeto from "@/src/components/kanban/modal-novo-projeto"
import { KanbanBoard } from "@/src/components/kanban"
import type { Projeto } from "@/src/types/kanban"

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
  const [isMenuMinimized, setIsMenuMinimized] = useState(false)
  const [isModalNovoProjetoOpen, setIsModalNovoProjetoOpen] = useState(false)

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

  const handleToggleMinimize = () => {
    setIsMenuMinimized(!isMenuMinimized)
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
    <div className="flex min-h-screen bg-white">
      <MenuLateral
        user={user}
        projetos={projetos}
        projetoSelecionado={projetoSelecionado}
        onProjetoSelect={handleProjetoSelect}
        onNovoProjeto={handleNovoProjeto}
        onDeletarProjeto={handleDeletarProjeto}
        isMinimized={isMenuMinimized}
        onToggleMinimize={handleToggleMinimize}
      />

      <main className="flex-1 flex flex-col min-w-0">
        {projetoSelecionado ? (
          <>
            <header className="p-6 bg-gray-50 border-b border-gray-200 z-10">
              <div className="flex items-start justify-between">
                <div className="flex-1 flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg">
                        <KanbanIcon className="h-5 w-5 text-white" />
                      </div>
                      <h1 className="text-3xl font-bold text-gray-900">{projetoSelecionado.nome}</h1>
                    </div>
                    {projetoSelecionado.descricao && (
                      <p className="text-gray-600 mt-2 ml-14">{projetoSelecionado.descricao}</p>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-4 hover:bg-red-100 hover:text-red-600 text-gray-600"
                  onClick={() => {
                    if (confirm(`Tem certeza que deseja deletar o projeto "${projetoSelecionado.nome}"?`)) {
                      handleDeletarProjeto(projetoSelecionado.id)
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </header>

            <div className="flex-1 p-6 overflow-auto">
              <div className="h-full">
                <KanbanBoard projeto={projetoSelecionado} onStatusAdd={handleStatusAdd} />
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="inline-flex p-4 bg-gray-100 rounded-2xl mb-4">
                <Sparkles className="h-16 w-16 text-indigo-500" />
              </div>
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">Selecione um projeto</h2>
              <p className="text-gray-600 mb-6">Ou crie um novo para começar a organizar suas tarefas</p>
              <Button onClick={handleNovoProjeto} className="bg-indigo-600 hover:bg-indigo-700">
                <KanbanIcon className="mr-2 h-4 w-4" />
                Criar Novo Projeto
              </Button>
            </div>
          </div>
        )}
      </main>

      <ModalNovoProjeto
        isOpen={isModalNovoProjetoOpen}
        onClose={() => setIsModalNovoProjetoOpen(false)}
        onSubmit={handleCriarProjeto}
      />
    </div>
  )
}

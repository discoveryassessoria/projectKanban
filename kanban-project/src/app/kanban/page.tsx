'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getStoredUser, isAuthenticated } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { 
  Kanban as KanbanIcon, 
  Trash2
} from 'lucide-react'
import MenuLateral from '@/src/components/kanban/menu-lateral'
import ModalNovoProjeto from '@/src/components/kanban/modal-novo-projeto'
import { KanbanBoard } from '@/src/components/kanban'

// Interfaces atualizadas para refletir o schema completo
interface Status {
  id: number;
  nome: string;
}

interface Atividade {
  id: number;
  nome: string;
  descricao: string | null;
  statusId: number;
  status: {
    id: number;
    nome: string;
  };
}

interface ProjetoKanban {
  id: number;
  nome: string;
  descricao: string | null;
  status: Status[];
  atividades: Atividade[];
}

interface User {
  id: number
  nome: string
  email: string
  tipo: string
}

export default function KanbanPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [projetos, setProjetos] = useState<ProjetoKanban[]>([])
  const [projetoSelecionado, setProjetoSelecionado] = useState<ProjetoKanban | null>(null)
  const [loading, setLoading] = useState(true)
  const [isMenuMinimized, setIsMenuMinimized] = useState(false)
  const [isModalNovoProjetoOpen, setIsModalNovoProjetoOpen] = useState(false)

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/auth')
      return
    }
    const userData = getStoredUser()
    if (!userData) {
      router.push('/auth')
      return
    }
    setUser(userData)
    buscarProjetos(userData.id)
  }, [router])

  const buscarProjetos = async (userId: number) => {
    try {
      // setLoading(true) // Comentado para um refresh mais suave
      const response = await fetch('/api/projetos')
      if (response.ok) {
        const data = await response.json()
        const projetosCarregados: ProjetoKanban[] = data.projetos || []
        setProjetos(projetosCarregados)

        if (projetoSelecionado) {
          const projetoAtualizado = projetosCarregados.find(p => p.id === projetoSelecionado.id)
          setProjetoSelecionado(projetoAtualizado || null)
        } else if (projetosCarregados.length > 0) {
          setProjetoSelecionado(projetosCarregados[0])
        }
      } else {
        console.error('Erro ao buscar projetos')
        setProjetos([])
      }
    } catch (error) {
      console.error('Erro na requisição:', error)
      setProjetos([])
    } finally {
      setLoading(false)
    }
  }

  const handleStatusAdd = () => {
    if (user) {
      buscarProjetos(user.id);
    }
  }

  const handleNovoProjeto = () => {
    setIsModalNovoProjetoOpen(true)
  }

  const handleProjetoSelect = (projeto: ProjetoKanban) => {
    setProjetoSelecionado(projeto)
  }

  const handleToggleMinimize = () => {
    setIsMenuMinimized(!isMenuMinimized)
  }

  const handleCriarProjeto = async (dados: { nome: string; descricao: string }) => {
    try {
      if (!user) throw new Error('Usuário não encontrado')
      
      const response = await fetch('/api/projetos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...dados, usuarioId: user.id }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido' }))
        throw new Error(errorData.error)
      }

      const { projeto } = await response.json()
      setProjetos(prev => [...prev, projeto])
      setProjetoSelecionado(projeto)
    } catch (error) {
      console.error('Erro ao criar projeto:', error)
      alert('Erro ao criar projeto: ' + (error instanceof Error ? error.message : 'Erro'))
      throw error
    }
  }

  const handleDeletarProjeto = async (projetoId: number) => {
    try {
      const response = await fetch(`/api/projetos/${projetoId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido' }))
        throw new Error(errorData.error)
      }

      const projetosRestantes = projetos.filter(p => p.id !== projetoId)
      setProjetos(projetosRestantes)
      
      if (projetoSelecionado?.id === projetoId) {
        setProjetoSelecionado(projetosRestantes.length > 0 ? projetosRestantes[0] : null)
      }
    } catch (error) {
      console.error('Erro ao deletar projeto:', error)
      alert('Erro ao deletar projeto: ' + (error instanceof Error ? error.message : 'Erro'))
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <KanbanIcon className="h-12 w-12 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-100">
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

      <main className="flex-1 flex flex-col overflow-hidden">
        {projetoSelecionado ? (
          <>
            <header className="p-6 bg-white border-b z-10">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h1 className="text-3xl font-bold">{projetoSelecionado.nome}</h1>
                  {projetoSelecionado.descricao && (
                    <p className="text-gray-600 mt-2">{projetoSelecionado.descricao}</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-4 hover:bg-red-100 hover:text-red-600"
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
            
            <div className="flex-1 overflow-x-auto p-6">
              <KanbanBoard projeto={projetoSelecionado} onStatusAdd={handleStatusAdd} />
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <KanbanIcon className="h-16 w-16 text-gray-300 mx-auto mb-4" />
              <h2 className="text-2xl font-semibold text-gray-600 mb-2">Selecione um projeto</h2>
              <p className="text-gray-500">Ou crie um novo para começar</p>
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

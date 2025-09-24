'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getStoredUser, isAuthenticated } from '@/lib/auth'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { 
  Kanban as KanbanIcon, 
  Plus,
  Trash2
} from 'lucide-react'
import MenuLateral from '../../components/kanban/menu-lateral'
import ModalNovoProjeto from '../../components/kanban/modal-novo-projeto'

interface ProjetoKanban {
  id: number
  nome: string
  descricao: string | null
  atividades: Array<{
    id: number
    nome: string
    status: {
      nome: string
    }
  }>
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
    // Verificar se o usuário está autenticado
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
      setLoading(true)
      
      // Tentar buscar da API - por enquanto buscar todos os projetos
      // No futuro implementar filtro por usuário
      const response = await fetch('/api/projetos')
      if (response.ok) {
        const data = await response.json()
        setProjetos(data.projetos || [])
        if (data.projetos && data.projetos.length > 0) {
          setProjetoSelecionado(data.projetos[0])
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

  const contarAtividades = (projeto: ProjetoKanban) => {
    return {
      total: projeto.atividades.length,
      concluidas: projeto.atividades.filter(a => a.status.nome === 'Concluído').length,
      emAndamento: projeto.atividades.filter(a => a.status.nome === 'Em Andamento').length
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
      if (!user) {
        throw new Error('Usuário não encontrado')
      }

      console.log('🚀 Criando projeto no banco:', dados)
      
      const response = await fetch('/api/projetos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nome: dados.nome,
          descricao: dados.descricao || null,
          usuarioId: user.id
        }),
      })

      console.log('📡 Response status:', response.status)
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error('❌ Response error:', errorText)
        
        // Tentar fazer parse do JSON se possível
        let errorMessage = 'Erro desconhecido'
        try {
          const errorData = JSON.parse(errorText)
          errorMessage = errorData.error || errorText
        } catch {
          errorMessage = errorText
        }
        
        throw new Error(`Erro HTTP ${response.status}: ${errorMessage}`)
      }

      const { projeto } = await response.json()
      console.log('✅ Projeto salvo no banco:', projeto)
      
      // Adiciona o novo projeto à lista
      setProjetos(prev => [...prev, projeto])
      setProjetoSelecionado(projeto)
      
      console.log('🎉 Projeto criado com sucesso e salvo no BD!')
      
    } catch (error) {
      console.error('💥 Erro completo ao criar projeto:', error)
      alert('Erro ao criar projeto: ' + (error instanceof Error ? error.message : 'Erro desconhecido'))
      throw error
    }
  }

  const handleDeletarProjeto = async (projetoId: number) => {
    try {
      console.log('🗑️ Deletando projeto:', projetoId)
      
      const response = await fetch(`/api/projetos/${projetoId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      console.log('📡 Delete response status:', response.status)
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error('❌ Delete response error:', errorText)
        
        let errorMessage = 'Erro desconhecido'
        try {
          const errorData = JSON.parse(errorText)
          errorMessage = errorData.error || errorText
        } catch {
          errorMessage = errorText
        }
        
        throw new Error(`Erro HTTP ${response.status}: ${errorMessage}`)
      }

      console.log('✅ Projeto deletado do banco')
      
      // Remove o projeto da lista
      setProjetos(prev => prev.filter(p => p.id !== projetoId))
      
      // Se o projeto deletado era o selecionado, selecionar outro ou nenhum
      if (projetoSelecionado?.id === projetoId) {
        const projetosRestantes = projetos.filter(p => p.id !== projetoId)
        setProjetoSelecionado(projetosRestantes.length > 0 ? projetosRestantes[0] : null)
      }
      
      console.log('🎉 Projeto deletado com sucesso!')
      
    } catch (error) {
      console.error('💥 Erro completo ao deletar projeto:', error)
      alert('Erro ao deletar projeto: ' + (error instanceof Error ? error.message : 'Erro desconhecido'))
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen">
        <div className={`${isMenuMinimized ? 'w-16' : 'w-80'} border-r bg-gray-50 p-4 transition-all duration-300`}>
          <div className="animate-pulse">
            <div className="h-6 bg-gray-200 rounded mb-4"></div>
            {!isMenuMinimized && (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-20 bg-gray-200 rounded"></div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <KanbanIcon className="h-12 w-12 animate-spin text-gray-400" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen">
      {/* Menu Lateral */}
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

      {/* Área Principal */}
      <div className="flex-1 overflow-hidden">
        {projetoSelecionado ? (
          <div className="p-6">
            <div className="mb-6">
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
                    const confirmDelete = confirm(`Tem certeza que deseja deletar o projeto "${projetoSelecionado.nome}"? Esta ação não pode ser desfeita.`)
                    if (confirmDelete) {
                      handleDeletarProjeto(projetoSelecionado.id)
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            
            {/* Área do conteúdo do projeto - por enquanto vazia */}
            <div className="flex items-center justify-center h-64 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
              <div className="text-center text-gray-500">
                <KanbanIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Conteúdo do projeto em desenvolvimento</p>
                <p className="text-sm">As funcionalidades do Kanban serão implementadas aqui</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <KanbanIcon className="h-16 w-16 text-gray-300 mx-auto mb-4" />
              <h2 className="text-2xl font-semibold text-gray-600 mb-2">
                Selecione um projeto
              </h2>
              <p className="text-gray-500">
                Escolha um projeto no menu lateral para começar
              </p>
            </div>
          </div>
        )}
      </div>
      
      {/* Modal Novo Projeto */}
      <ModalNovoProjeto
        isOpen={isModalNovoProjetoOpen}
        onClose={() => setIsModalNovoProjetoOpen(false)}
        onSubmit={handleCriarProjeto}
      />
    </div>
  )
}

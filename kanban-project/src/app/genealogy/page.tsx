"use client"

import React, { useState, useEffect, useRef, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { genealogicalTree as GenealogicalTree } from "@/src/components/genealogical-tree"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Plus, TreePine, Edit3, LogOut, Bell, Search, Trash2, BarChart3, FolderOpen, TreeDeciduous } from "lucide-react"
import { TreeOnboardingWizard } from "@/src/components/tree-onboarding-wizard"
import type { Arvore as PrismaArvore, Pessoa as PrismaPessoa } from "@prisma/client"
import { io, type Socket } from "socket.io-client"
import type { GenealogicalTreeHandle } from "@/src/components/genealogical-tree"
import Swal from "sweetalert2"
import withReactContent from "sweetalert2-react-content"
import { useRouter } from "next/navigation"

type Arvore = PrismaArvore & {
  pessoas?: (PrismaPessoa & { [key: string]: any })[]
  commentPosX?: number | null
  commentPosY?: number | null
}

interface User {
  nome: string
  tipo?: string
  email?: string
}

interface Projeto {
  id: number
  nome: string
  descricao?: string
}

interface Atividade {
  id: number
  nome: string
  descricao?: string
  data_criacao: string
  data_termino?: string
  projeto?: { nome: string }
  status?: { nome: string }
  usuarios?: {
    usuario: {
      nome: string
      email: string
    }
  }[]
}

function GenealogyContent() {
  const router = useRouter()
  const [arvores, setArvores] = useState<Arvore[]>([])
  const [arvoreAtual, setArvoreAtual] = useState<Arvore | null>(null)
  const [loading, setLoading] = useState(true)
  const [showOnboarding, setShowOnboarding] = useState(false)

  const socketRef = useRef<Socket | null>(null)
  const treeRef = useRef<GenealogicalTreeHandle>(null)

  const MySwal = withReactContent(Swal)
  const searchParams = useSearchParams()
  const initialTreeId = searchParams.get("treeId")

  // ====== ESTADOS PARA PESQUISA E NOTIFICAÇÕES ======
  const [projetos, setProjetos] = useState<Projeto[]>([])
  const [atividades, setAtividades] = useState<Atividade[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<{
    projetos: Projeto[]
    atividades: Atividade[]
    arvores: Arvore[]
  }>({ projetos: [], atividades: [], arvores: [] })
  const [showSearchResults, setShowSearchResults] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)

  const handleLogout = () => {
    localStorage.removeItem("authToken")
    localStorage.removeItem("user")
    router.push("/login")
  }

  const getInitials = (nome: string) => {
    return nome
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }

  const user: User = typeof window !== 'undefined' 
    ? JSON.parse(localStorage.getItem('user') || '{"nome":"Usuário"}') 
    : { nome: "Usuário" }

  useEffect(() => {
    fetchAllArvores(true, initialTreeId ? Number(initialTreeId) : undefined)
    fetchSearchData()

    const initializeSocket = async () => {
      socketRef.current = io({
        path: "/api/socket_io",
        addTrailingSlash: false,
      })

      socketRef.current.on("connect", () => {
        console.log("Socket conectado!", socketRef.current?.id)
      })

      socketRef.current.on("update-tree", (arvoreId: number) => {
        console.log(`Recebida atualização para a árvore ${arvoreId}`)
        if (arvoreAtual && arvoreAtual.id === arvoreId) {
          handleTreeUpdate()
        }
      })
    }

    initializeSocket()

    return () => {
      socketRef.current?.disconnect()
    }
  }, [initialTreeId])

  // ====== FETCH DADOS PARA PESQUISA E NOTIFICAÇÕES ======
  const fetchSearchData = async () => {
    try {
      const projetosRes = await fetch("/api/projetos")
      const projetosData = await projetosRes.json()
      setProjetos(projetosData.projetos || [])

      const atividadesRes = await fetch("/api/activities")
      const atividadesData = await atividadesRes.json()
      setAtividades(Array.isArray(atividadesData) ? atividadesData : [])
    } catch (error) {
      console.error("Erro ao buscar dados para pesquisa:", error)
    }
  }

  // ====== FUNÇÃO DE PESQUISA GLOBAL ======
  const handleSearch = (query: string) => {
    setSearchQuery(query)
    
    if (query.trim() === "") {
      setShowSearchResults(false)
      setSearchResults({ projetos: [], atividades: [], arvores: [] })
      return
    }

    const queryLower = query.toLowerCase()

    const projetosFiltrados = projetos.filter(p => 
      p.nome.toLowerCase().includes(queryLower) ||
      p.descricao?.toLowerCase().includes(queryLower)
    )

    const atividadesFiltradas = atividades.filter(a => 
      a.nome.toLowerCase().includes(queryLower) ||
      a.descricao?.toLowerCase().includes(queryLower) ||
      a.projeto?.nome.toLowerCase().includes(queryLower)
    )

    const arvoresFiltradas = arvores.filter(a => 
      a.nome.toLowerCase().includes(queryLower)
    )

    setSearchResults({
      projetos: projetosFiltrados.slice(0, 3),
      atividades: atividadesFiltradas.slice(0, 3),
      arvores: arvoresFiltradas.slice(0, 3)
    })
    setShowSearchResults(true)
  }

  const totalResults = searchResults.projetos.length + searchResults.atividades.length + searchResults.arvores.length

  // ====== NOTIFICAÇÕES ======
  const minhasAtividades = atividades.filter(a => 
    a.usuarios?.some(u => u.usuario.email === user?.email)
  )

  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)

  const notificacoes = {
    vencidas: minhasAtividades.filter(a => {
      if (!a.data_termino) return false
      const prazo = new Date(a.data_termino)
      prazo.setHours(0, 0, 0, 0)
      return prazo < hoje
    }),
    hoje: minhasAtividades.filter(a => {
      if (!a.data_termino) return false
      const prazo = new Date(a.data_termino)
      prazo.setHours(0, 0, 0, 0)
      return prazo.getTime() === hoje.getTime()
    }),
    proximos3Dias: minhasAtividades.filter(a => {
      if (!a.data_termino) return false
      const prazo = new Date(a.data_termino)
      prazo.setHours(0, 0, 0, 0)
      const em3Dias = new Date(hoje)
      em3Dias.setDate(hoje.getDate() + 3)
      return prazo > hoje && prazo <= em3Dias
    }),
    novas: minhasAtividades.filter(a => {
      const criacao = new Date(a.data_criacao)
      const umDiaAtras = new Date()
      umDiaAtras.setDate(umDiaAtras.getDate() - 1)
      return criacao >= umDiaAtras
    })
  }

  const totalNotificacoes = notificacoes.vencidas.length + notificacoes.hoje.length + notificacoes.proximos3Dias.length + notificacoes.novas.length

  const fetchAllArvores = async (setInitial = false, initialId?: number) => {
    try {
      const response = await fetch("/api/arvore")
      if (response.ok) {
        const data = await response.json()
        setArvores(data)
        if (setInitial && data.length > 0) {
          const idToLoad = initialId && data.some((a: Arvore) => a.id === initialId) ? initialId : data[0].id
          fetchFullTree(idToLoad)
        } else if (data.length === 0) {
          setLoading(false)
        } else {
          setLoading(false)
        }
      } else {
        setLoading(false)
      }
    } catch (error) {
      console.error("Erro ao carregar árvores:", error)
      setLoading(false)
    }
  }

  const fetchFullTree = async (arvoreId: number) => {
    setLoading(true)
    try {
      const response = await fetch(`/api/arvore/${arvoreId}`)
      if (response.ok) {
        const fullTreeData = await response.json()
        setArvoreAtual(fullTreeData)

        if (socketRef.current) {
          socketRef.current.emit("join-tree-room", arvoreId)
        }
      }
    } catch (error) {
      console.error(`Erro ao carregar dados da árvore ${arvoreId}:`, error)
    } finally {
      setLoading(false)
    }
  }

  const handleTreeUpdate = async () => {
    if (arvoreAtual) {
      await fetchFullTree(arvoreAtual.id)
    }
  }

  const criarNovaArvore = async () => {
    const { value: nome } = await MySwal.fire({
      title: "Criar Nova Árvore",
      text: "Qual será o nome da sua nova árvore genealógica?",
      input: "text",
      inputPlaceholder: "Ex: Família Silva",
      confirmButtonText: "Criar Árvore",
      customClass: { popup: "font-sans" },
      confirmButtonColor: "#123C73",
      showCancelButton: true,
      cancelButtonText: "Cancelar",
      inputValidator: (value) => {
        if (!value) {
          return "Você precisa digitar um nome!"
        }
      },
    })

    if (nome) {
      try {
        MySwal.fire({
          title: "Criando árvore...",
          allowOutsideClick: false,
          customClass: { popup: "font-sans" },
          didOpen: () => {
            MySwal.showLoading()
          },
        })

        const response = await fetch("/api/arvore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nome }),
        })

        if (response.ok) {
          const novaArvore = await response.json()
          await fetchAllArvores()
          setArvoreAtual(novaArvore)
          setShowOnboarding(true)
          MySwal.close()
        } else {
          throw new Error("Falha ao criar a árvore.")
        } 
      } catch (error) {
        MySwal.fire("Erro", error instanceof Error ? error.message : "Não foi possível criar a árvore.", "error")
      }
    }
  }

  const handleRenameTree = async () => {
    if (!arvoreAtual) return

    const { value: newName } = await MySwal.fire({
      title: "Renomear Árvore",
      input: "text",
      inputValue: arvoreAtual.nome,
      inputPlaceholder: "Digite o novo nome da árvore",
      customClass: { popup: "font-sans" },
      confirmButtonText: "Salvar",
      showCancelButton: true,
      inputValidator: (value) => {
        if (!value) {
          return "O nome não pode ser vazio!"
        }
      },
    })

    if (newName && newName !== arvoreAtual.nome) {
      try {
        const response = await fetch(`/api/arvore/${arvoreAtual.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nome: newName }),
        })

        if (response.ok) {
          MySwal.fire({ title: "Sucesso!", text: "O nome da árvore foi atualizado.", icon: "success", customClass: { popup: "font-sans" } })
          handleTreeUpdate()
        } else {
          MySwal.fire({ title: "Erro", text: "Não foi possível renomear a árvore.", icon: "error", customClass: { popup: "font-sans" } })
        }
      } catch (error) {
        MySwal.fire({ title: "Erro", text: "Ocorreu um erro de conexão.", icon: "error", customClass: { popup: "font-sans" } })
      }
    }
  }

  const handleDeleteTree = async () => {
    if (!arvoreAtual) return

    const { isConfirmed } = await MySwal.fire({
      title: "Você tem certeza?",
      html: `Você está prestes a excluir a árvore "<strong>${arvoreAtual.nome}</strong>".<br/>Esta ação não pode ser desfeita.`,
      icon: "warning",
      customClass: { popup: "font-sans" },
      showCancelButton: true,
      confirmButtonColor: "#d33",
      cancelButtonColor: "#3085d6",
      confirmButtonText: "Sim, excluir!",
      cancelButtonText: "Cancelar",
    })

    if (isConfirmed) {
      try {
        const response = await fetch(`/api/arvore/${arvoreAtual.id}`, {
          method: "DELETE",
        })

        if (response.ok) {
          MySwal.fire({ title: "Excluída!", text: "Sua árvore foi excluída com sucesso.", icon: "success", customClass: { popup: "font-sans" } })
          setArvoreAtual(null)
          await fetchAllArvores(true)
        } else {
          const error = await response.json()
          MySwal.fire({ title: "Erro", text: error.error || "Não foi possível excluir a árvore.", icon: "error", customClass: { popup: "font-sans" } })
        }
      } catch (error) {
        MySwal.fire({ title: "Erro", text: "Ocorreu um erro de conexão.", icon: "error", customClass: { popup: "font-sans" } })
      }
    }
  }

  const handleOnboardingComplete = () => {
    setShowOnboarding(false)
    handleTreeUpdate()
  }

  const handleArvoreUpdate = (updatedArvore: Arvore) => {
    setArvoreAtual(updatedArvore)
    setArvores((prevArvores) =>
      prevArvores.map((arvore) => (arvore.id === updatedArvore.id ? updatedArvore : arvore)),
    )
  }

  // ====== COMPONENTE DO HEADER REUTILIZÁVEL ======
  const Header = () => (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-black/40 backdrop-blur-md shadow-lg">
      <div className="px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold leading-tight text-white">
            Grupo Discovery · Árvore Genealógica
          </h1>
          <p className="text-xs text-white/70">
            Mapeie sua história familiar
          </p>
        </div>

        <div className="flex items-center gap-4">
          {/* Barra de pesquisa funcional */}
          <div className="relative hidden md:block">
            <div className="flex items-center gap-2 px-3 py-2 rounded-full border border-white/30">
              <Search className="h-4 w-4 text-white/70" />
              <input
                className="bg-transparent text-xs outline-none placeholder:text-white/60 w-40 text-white"
                placeholder="Pesquisar no sistema..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                onFocus={() => searchQuery && setShowSearchResults(true)}
                onBlur={() => setTimeout(() => setShowSearchResults(false), 200)}
              />
            </div>

            {/* Dropdown de resultados */}
            {showSearchResults && (
              <div className="absolute top-full mt-2 left-0 right-0 w-80 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden z-50">
                {totalResults === 0 ? (
                  <div className="px-4 py-6 text-center text-gray-400">
                    <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm text-gray-600">Nenhum resultado encontrado</p>
                    <p className="text-xs mt-1 text-gray-400">Tente buscar por outro termo</p>
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto">
                    {/* Projetos */}
                    {searchResults.projetos.length > 0 && (
                      <div>
                        <div className="px-3 py-2 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500 font-medium">
                          Projetos
                        </div>
                        {searchResults.projetos.map(projeto => (
                          <button
                            key={`projeto-${projeto.id}`}
                            className="w-full px-3 py-2 flex items-center gap-3 hover:bg-gray-100 transition text-left"
                            onClick={() => {
                              router.push('/kanban')
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

                    {/* Atividades */}
                    {searchResults.atividades.length > 0 && (
                      <div>
                        <div className="px-3 py-2 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500 font-medium">
                          Atividades
                        </div>
                        {searchResults.atividades.map(atividade => (
                          <button
                            key={`atividade-${atividade.id}`}
                            className="w-full px-3 py-2 flex items-center gap-3 hover:bg-gray-100 transition text-left"
                            onClick={() => {
                              router.push('/activities')
                              setShowSearchResults(false)
                              setSearchQuery("")
                            }}
                          >
                            <FolderOpen className="h-4 w-4 text-amber-500 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-gray-800 truncate">{atividade.nome}</p>
                              <p className="text-[10px] text-gray-400 truncate">{atividade.projeto?.nome || "Sem projeto"}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Árvores */}
                    {searchResults.arvores.length > 0 && (
                      <div>
                        <div className="px-3 py-2 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500 font-medium">
                          Árvores Genealógicas
                        </div>
                        {searchResults.arvores.map(arvore => (
                          <button
                            key={`arvore-${arvore.id}`}
                            className="w-full px-3 py-2 flex items-center gap-3 hover:bg-gray-100 transition text-left"
                            onClick={() => {
                              fetchFullTree(arvore.id)
                              setShowSearchResults(false)
                              setSearchQuery("")
                            }}
                          >
                            <TreeDeciduous className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-gray-800 truncate">{arvore.nome}</p>
                              <p className="text-[10px] text-gray-400 truncate">{arvore.pessoas?.length || 0} pessoas</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
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
              {totalNotificacoes > 0 && (
                <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 border-2 border-white text-[10px] font-bold flex items-center justify-center">
                  {totalNotificacoes > 9 ? '9+' : totalNotificacoes}
                </span>
              )}
            </button>

            {/* Dropdown de notificações */}
            {showNotifications && (
              <div className="absolute top-full mt-2 right-0 w-80 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden z-50">
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <h3 className="font-semibold text-gray-800 text-sm">Notificações</h3>
                  <p className="text-xs text-gray-500">{totalNotificacoes} pendentes</p>
                </div>

                {totalNotificacoes === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <Bell className="h-10 w-10 mx-auto mb-2 text-gray-300" />
                    <p className="text-sm text-gray-500">Nenhuma notificação</p>
                    <p className="text-xs text-gray-400 mt-1">Você está em dia!</p>
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto">
                    {/* Vencidas */}
                    {notificacoes.vencidas.length > 0 && (
                      <div>
                        <div className="px-3 py-2 bg-red-50 text-[10px] uppercase tracking-wide text-red-600 font-medium flex items-center gap-1">
                          <span className="h-2 w-2 rounded-full bg-red-500"></span>
                          Vencidas ({notificacoes.vencidas.length})
                        </div>
                        {notificacoes.vencidas.map(atividade => (
                          <button
                            key={`vencida-${atividade.id}`}
                            className="w-full px-3 py-2 flex items-start gap-3 hover:bg-gray-50 transition text-left border-l-4 border-red-500"
                            onClick={() => {
                              router.push('/activities')
                              setShowNotifications(false)
                            }}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-gray-800 truncate font-medium">{atividade.nome}</p>
                              <p className="text-[10px] text-gray-500">{atividade.projeto?.nome}</p>
                              <p className="text-[10px] text-red-500 font-medium">
                                Venceu em {new Date(atividade.data_termino!).toLocaleDateString('pt-BR')}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Vencem hoje */}
                    {notificacoes.hoje.length > 0 && (
                      <div>
                        <div className="px-3 py-2 bg-amber-50 text-[10px] uppercase tracking-wide text-amber-600 font-medium flex items-center gap-1">
                          <span className="h-2 w-2 rounded-full bg-amber-500"></span>
                          Vencem hoje ({notificacoes.hoje.length})
                        </div>
                        {notificacoes.hoje.map(atividade => (
                          <button
                            key={`hoje-${atividade.id}`}
                            className="w-full px-3 py-2 flex items-start gap-3 hover:bg-gray-50 transition text-left border-l-4 border-amber-500"
                            onClick={() => {
                              router.push('/activities')
                              setShowNotifications(false)
                            }}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-gray-800 truncate font-medium">{atividade.nome}</p>
                              <p className="text-[10px] text-gray-500">{atividade.projeto?.nome}</p>
                              <p className="text-[10px] text-amber-600 font-medium">Vence hoje!</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Próximos 3 dias */}
                    {notificacoes.proximos3Dias.length > 0 && (
                      <div>
                        <div className="px-3 py-2 bg-orange-50 text-[10px] uppercase tracking-wide text-orange-600 font-medium flex items-center gap-1">
                          <span className="h-2 w-2 rounded-full bg-orange-500"></span>
                          Próximos 3 dias ({notificacoes.proximos3Dias.length})
                        </div>
                        {notificacoes.proximos3Dias.map(atividade => (
                          <button
                            key={`proximos-${atividade.id}`}
                            className="w-full px-3 py-2 flex items-start gap-3 hover:bg-gray-50 transition text-left border-l-4 border-orange-500"
                            onClick={() => {
                              router.push('/activities')
                              setShowNotifications(false)
                            }}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-gray-800 truncate font-medium">{atividade.nome}</p>
                              <p className="text-[10px] text-gray-500">{atividade.projeto?.nome}</p>
                              <p className="text-[10px] text-orange-600 font-medium">
                                Vence em {new Date(atividade.data_termino!).toLocaleDateString('pt-BR')}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Novas atribuições */}
                    {notificacoes.novas.length > 0 && (
                      <div>
                        <div className="px-3 py-2 bg-blue-50 text-[10px] uppercase tracking-wide text-blue-600 font-medium flex items-center gap-1">
                          <span className="h-2 w-2 rounded-full bg-blue-500"></span>
                          Novas atribuições ({notificacoes.novas.length})
                        </div>
                        {notificacoes.novas.map(atividade => (
                          <button
                            key={`nova-${atividade.id}`}
                            className="w-full px-3 py-2 flex items-start gap-3 hover:bg-gray-50 transition text-left border-l-4 border-blue-500"
                            onClick={() => {
                              router.push('/activities')
                              setShowNotifications(false)
                            }}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-gray-800 truncate font-medium">{atividade.nome}</p>
                              <p className="text-[10px] text-gray-500">{atividade.projeto?.nome}</p>
                              <p className="text-[10px] text-blue-600 font-medium">Nova tarefa atribuída a você</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {totalNotificacoes > 0 && (
                  <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
                    <button 
                      className="w-full text-center text-xs text-blue-600 hover:text-blue-800 font-medium"
                      onClick={() => {
                        router.push('/activities')
                        setShowNotifications(false)
                      }}
                    >
                      Ver todas as atividades
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Avatar e nome */}
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
                {user.tipo || 'Usuário'}
              </p>
            </div>
          </div>

          {/* Botão Sair */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            className="border-white/30 text-xs bg-transparent hover:bg-red-500/20 hover:border-red-400/50 text-white hover:text-red-400 flex items-center justify-center gap-1.5"
          >
            <LogOut className="h-3 w-3" />
            Sair
          </Button>
        </div>
      </div>
    </header>
  )

  // LOADING STATE
  if (loading) {
    return (
      <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
        <div className="min-h-screen bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin h-12 w-12 border-4 border-white border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-white/70">Carregando árvores genealógicas...</p>
          </div>
        </div>
      </div>
    )
  }

  // ONBOARDING
  if (showOnboarding && arvoreAtual) {
    return (
      <TreeOnboardingWizard
        arvore={arvoreAtual}
        onComplete={handleOnboardingComplete}
        onArvoreUpdate={handleArvoreUpdate}
      />
    )
  }

  // EMPTY STATE - Nenhuma árvore
  if (arvores.length === 0) {
    return (
      <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />

        <Header />

        {/* CONTEÚDO COM OVERLAY */}
        <div className="min-h-[calc(100vh-73px)] relative">
          <div className="absolute inset-0 bg-black/40 pointer-events-none" />
          <main className="relative flex items-center justify-center min-h-[calc(100vh-73px)] px-4 py-8">
            <div className="max-w-md w-full">
              <div className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl p-12 text-center border border-white/20">
                <div className="mb-6 flex justify-center">
                  <div className="h-24 w-24 rounded-full bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center shadow-lg">
                    <TreePine className="h-12 w-12 text-white" />
                  </div>
                </div>

                <h2 className="text-2xl font-bold text-gray-900 mb-3">
                  Nenhuma Árvore Encontrada
                </h2>
                <p className="text-gray-600 mb-8 leading-relaxed">
                  Crie sua primeira árvore genealógica para começar a mapear sua família.
                </p>

                <Button
                  onClick={criarNovaArvore}
                  className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-8 py-6 text-base font-medium shadow-lg hover:shadow-xl transition-all duration-200"
                  size="lg"
                >
                  <Plus className="mr-2 h-5 w-5" />
                  Criar Primeira Árvore
                </Button>

                <div className="mt-8 pt-6 border-t border-gray-200">
                  <p className="text-sm text-gray-500">
                    💡 <span className="font-medium">Dica:</span> Comece adicionando você mesmo e depois seus pais e avós
                  </p>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    )
  }

  // ESTADO COM ÁRVORES
  return (
    <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />

      <Header />

      {/* CONTEÚDO COM OVERLAY */}
      <div className="min-h-[calc(100vh-73px)] relative">
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />
        
        {/* BARRA DE CONTROLES DA ÁRVORE */}
        <div className="relative px-6 py-4 border-b border-white/10">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <TreePine className="h-6 w-6 text-white/90" />
              <div className="flex items-center gap-2">
                <select
                  value={arvoreAtual?.id || ""}
                  onChange={(e) => {
                    const arvoreId = Number.parseInt(e.target.value)
                    if (arvoreId) {
                      fetchFullTree(arvoreId)
                    }
                  }}
                  className="px-3 py-2 rounded-lg bg-transparent border border-white/30 text-white text-sm outline-none focus:ring-2 focus:ring-white/30"
                >
                  {arvores.map((arvore) => (
                    <option key={arvore.id} value={arvore.id} className="bg-gray-800">
                      {arvore.nome}
                    </option>
                  ))}
                </select>
                {arvoreAtual && (
                  <button 
                    onClick={handleRenameTree} 
                    title="Renomear árvore" 
                    className="p-2 rounded-lg bg-transparent border border-white/30 text-white/70 hover:text-white hover:bg-white/10 transition"
                  >
                    <Edit3 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button 
                onClick={criarNovaArvore} 
                size="sm"
                className="bg-emerald-500 hover:bg-emerald-600 text-white inline-flex items-center justify-center gap-1.5 h-9"
              >
                <span className="-mt-[2px]">+</span>
                <span>Nova Árvore</span>
              </Button>
              {arvoreAtual && (
                <>
                  <Button
                    onClick={() => treeRef.current?.addUnlinkedPerson()}
                    variant="outline"
                    size="sm"
                    className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white inline-flex items-center justify-center gap-1.5 h-9"
                  >
                    <Plus className="h-4 w-4" />
                    Cadastrar Pessoas
                  </Button>
                  <Button
                    onClick={handleDeleteTree}
                    variant="outline"
                    size="sm"
                    className="border-white/30 bg-transparent text-white hover:bg-red-500/20 hover:border-red-400/50 hover:text-red-400 inline-flex items-center justify-center gap-1.5 h-9"
                  >
                    <Trash2 className="h-4 w-4" />
                    Excluir
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ÁREA DA ÁRVORE GENEALÓGICA */}
        <main className="relative w-full">
          {arvoreAtual && !showOnboarding && (
            <GenealogicalTree ref={treeRef} arvore={arvoreAtual} onUpdate={handleTreeUpdate} />
          )}
        </main>
      </div>
    </div>
  )
}

export default function GenealogyPage() {
  return (
    <Suspense fallback={
      <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
        <div className="min-h-screen bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin h-12 w-12 border-4 border-white border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-white/70">Carregando...</p>
          </div>
        </div>
      </div>
    }>
      <GenealogyContent />
    </Suspense>
  )
}
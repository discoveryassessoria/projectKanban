"use client"

import React, { useState, useEffect, useRef, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { genealogicalTree as GenealogicalTree } from "@/src/components/genealogical-tree"
import { Button } from "@/components/ui/button"
import { Plus, TreePine, Edit3, Trash2 } from "lucide-react"
import { TreeOnboardingWizard } from "@/src/components/tree-onboarding-wizard"
import type { Arvore as PrismaArvore, Pessoa as PrismaPessoa } from "@prisma/client"
import { io, type Socket } from "socket.io-client"
import type { GenealogicalTreeHandle } from "@/src/components/genealogical-tree"
import Swal from "sweetalert2"
import withReactContent from "sweetalert2-react-content"
import { useRouter } from "next/navigation"
import { HeaderBar } from "@/src/components/header-bar"

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

function GenealogyContent() {
  const router = useRouter()
  const [arvores, setArvores] = useState<Arvore[]>([])
  const [arvoreAtual, setArvoreAtual] = useState<Arvore | null>(null)
  const [loading, setLoading] = useState(true)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [user, setUser] = useState<User>({ nome: "Usuário" })

  const socketRef = useRef<Socket | null>(null)
  const treeRef = useRef<GenealogicalTreeHandle>(null)

  const MySwal = withReactContent(Swal)
  const searchParams = useSearchParams()
  const initialTreeId = searchParams.get("treeId")

  // Estados para dados do HeaderBar
  const [projetos, setProjetos] = useState<any[]>([])
  const [processos, setProcessos] = useState<any[]>([])

  const handleLogout = () => {
    localStorage.removeItem("authToken")
    localStorage.removeItem("user")
    router.push("/login")
  }

  useEffect(() => {
    // Carregar usuário
    if (typeof window !== 'undefined') {
      const storedUser = localStorage.getItem('user')
      if (storedUser) {
        try {
          setUser(JSON.parse(storedUser))
        } catch {
          setUser({ nome: "Usuário" })
        }
      }
    }

    fetchAllArvores(true, initialTreeId ? Number(initialTreeId) : undefined)
    fetchHeaderData()

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

  // Fetch dados para o HeaderBar
  const fetchHeaderData = async () => {
    try {
      const projetosRes = await fetch("/api/projetos")
      const projetosData = await projetosRes.json()
      setProjetos(projetosData.projetos || [])

      const processosRes = await fetch("/api/processos")
      const processosData = await processosRes.json()
      setProcessos(processosData.processos || [])
    } catch (error) {
      console.error("Erro ao buscar dados para header:", error)
    }
  }

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
          fetchAllArvores()
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

  // Converter árvores para o formato do HeaderBar
  const arvoresParaHeader = arvores.map(a => ({
    id: a.id,
    nome: a.nome,
    descricao: null,
    pessoas: a.pessoas || []
  }))

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

        <HeaderBar
          title="Árvore Genealógica"
          subtitle="Mapeie sua história familiar"
          userName={user.nome}
          userRole={user.tipo || 'Usuário'}
          userEmail={user.email || ''}
          projetos={projetos}
          processos={processos}
          arvores={arvoresParaHeader}
          onLogout={handleLogout}
        />

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

      <HeaderBar
        title="Árvore Genealógica"
        subtitle="Mapeie sua história familiar"
        userName={user.nome}
        userRole={user.tipo || 'Usuário'}
        userEmail={user.email || ''}
        projetos={projetos}
        processos={processos}
        arvores={arvoresParaHeader}
        onLogout={handleLogout}
      />

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
"use client"

import { useState, useEffect, useRef, createRef } from "react"
import { genealogicalTree as GenealogicalTree } from "@/src/components/genealogical-tree" // Renomeado para evitar conflito
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Plus, TreePine } from "lucide-react"
import { TreeOnboardingWizard } from "@/src/components/tree-onboarding-wizard"
import type { Arvore as PrismaArvore, Pessoa as PrismaPessoa } from "@prisma/client"
import { io, type Socket } from "socket.io-client"
import type { GenealogicalTreeHandle } from "@/src/components/genealogical-tree"
import Swal from "sweetalert2"
import withReactContent from "sweetalert2-react-content"

type Arvore = PrismaArvore & {
  pessoas?: (PrismaPessoa & { [key: string]: any })[]
  commentPosX?: number | null
  commentPosY?: number | null
}
import { Edit3 } from "lucide-react"

export default function GenealogyPage() {
  const [arvores, setArvores] = useState<Arvore[]>([])
  const [arvoreAtual, setArvoreAtual] = useState<Arvore | null>(null)
  const [loading, setLoading] = useState(true)
  const [showOnboarding, setShowOnboarding] = useState(false)

  const socketRef = useRef<Socket | null>(null)
  const treeRef = useRef<GenealogicalTreeHandle>(null)

  const MySwal = withReactContent(Swal)

  useEffect(() => {
    fetchAllArvores(true)

    // Inicializa o WebSocket
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
  }, [])

  const fetchAllArvores = async (setFirstAsCurrent = false) => {
    try {
      const response = await fetch("/api/arvore")
      if (response.ok) {
        const data = await response.json()
        setArvores(data)
        if (setFirstAsCurrent && data.length > 0) {
          fetchFullTree(data[0].id)
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

        // Entra na "sala" da árvore no WebSocket
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
    if (!arvoreAtual) return;

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
          return "O nome não pode ser vazio!";
        }
      },
    });

    if (newName && newName !== arvoreAtual.nome) {
      try {
        const response = await fetch(`/api/arvore/${arvoreAtual.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nome: newName }),
        });

        if (response.ok) {
          MySwal.fire({ title: "Sucesso!", text: "O nome da árvore foi atualizado.", icon: "success", customClass: { popup: "font-sans" } });
          handleTreeUpdate(); // Recarrega os dados da árvore
        } else {
          MySwal.fire({ title: "Erro", text: "Não foi possível renomear a árvore.", icon: "error", customClass: { popup: "font-sans" } });
        }
      } catch (error) {
        MySwal.fire({ title: "Erro", text: "Ocorreu um erro de conexão.", icon: "error", customClass: { popup: "font-sans" } });
      }
    }
  };

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
          setArvoreAtual(null) // Limpa a árvore atual
          await fetchAllArvores(true) // Recarrega as árvores e define a primeira como atual
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <TreePine className="h-12 w-12 mx-auto mb-4 text-[#123C73]" />
          <p className="text-lg text-[#9AA0A6]">Carregando árvores genealógicas...</p>
        </div>
      </div>
    )
  }

  if (showOnboarding && arvoreAtual) {
    return (
      <TreeOnboardingWizard
        arvore={arvoreAtual}
        onComplete={handleOnboardingComplete}
        onArvoreUpdate={handleArvoreUpdate}
      />
    )
  }

  if (arvores.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <TreePine className="h-16 w-16 mx-auto mb-4 text-[#123C73]" />
            <CardTitle className="text-[#123C73]">Nenhuma Árvore Encontrada</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-[#9AA0A6] mb-6">
              Crie sua primeira árvore genealógica para começar a mapear sua família.
            </p>
            <Button onClick={criarNovaArvore} className="bg-[#123C73] hover:bg-[#0f2d5a] text-white">
              <Plus className="h-4 w-4 mr-2" />
              Criar Primeira Árvore
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <TreePine className="h-8 w-8 text-[#123C73]" />
            <div>
              <h1 className="text-2xl font-bold text-[#123C73]">Árvore Genealógica</h1>
              <div className="flex items-center gap-2">
                <p className="text-[#9AA0A6]">{arvoreAtual?.nome || "Selecione uma árvore"}</p>
                {arvoreAtual && (
                  <button onClick={handleRenameTree} title="Renomear árvore" className="text-gray-400 hover:text-gray-600"><Edit3 className="h-3 w-3" /></button>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={arvoreAtual?.id || ""}
              onChange={(e) => {
                const arvoreId = Number.parseInt(e.target.value)
                if (arvoreId) {
                  fetchFullTree(arvoreId)
                }
              }}
              className="px-3 py-2 border border-border rounded-md bg-background text-foreground"
            >
              {arvores.map((arvore) => (
                <option key={arvore.id} value={arvore.id}>
                  {arvore.nome}
                </option>
              ))}
            </select>
            <Button onClick={criarNovaArvore} className="bg-[#123C73] hover:bg-[#0f2d5a] text-white">
              <Plus className="h-4 w-4 mr-2" />
              Nova Árvore
            </Button>
            {arvoreAtual && (
              <Button
                onClick={() => treeRef.current?.addUnlinkedPerson()}
                variant="outline"
                className="border-[#123C73] text-[#123C73] hover:bg-[#123C73] hover:text-white"
              >
                Cadastrar Pessoas
              </Button>
            )}
            {arvoreAtual && (
              <Button
                onClick={handleDeleteTree}
                variant="destructive"
              >
                Excluir Árvore
              </Button>
            )}
          </div>
        </div>
      </div>

      {arvoreAtual && !showOnboarding && <GenealogicalTree ref={treeRef} arvore={arvoreAtual} onUpdate={handleTreeUpdate} />}
    </div>
  )
}
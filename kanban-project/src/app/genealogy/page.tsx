"use client"

import { useState, useEffect } from "react"
import { GenealogicalTree } from "@/src/components/genealogical-tree"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Plus, TreePine } from "lucide-react"
import { TreeOnboardingWizard } from "@/src/components/tree-onboarding-wizard"
import type { Arvore as PrismaArvore, Pessoa as PrismaPessoa } from "@prisma/client"

type Arvore = PrismaArvore & {
  pessoas?: (PrismaPessoa & { [key: string]: any })[]
}

export default function GenealogyPage() {
  const [arvores, setArvores] = useState<Arvore[]>([])
  const [arvoreAtual, setArvoreAtual] = useState<Arvore | null>(null)
  const [loading, setLoading] = useState(true)
  const [showOnboarding, setShowOnboarding] = useState(false)

  useEffect(() => {
    fetchArvores()
  }, [])

  const fetchArvores = async () => {
    try {
      const response = await fetch("/api/arvore")
      if (response.ok) {
        const data = await response.json()
        setArvores(data)
        if (data.length > 0) {
          setArvoreAtual(data[0])
        }
      }
    } catch (error) {
      console.error("Erro ao carregar árvores:", error)
    } finally {
      setLoading(false)
    }
  }

  const criarNovaArvore = async () => {
    const nome = prompt("Nome da nova árvore genealógica:")
    if (!nome) return

    try {
      const response = await fetch("/api/arvore", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ nome }),
      })

      if (response.ok) {
        const novaArvore = await response.json()
        setArvores([...arvores, novaArvore])
        setArvoreAtual(novaArvore)
        setShowOnboarding(true)
      }
    } catch (error) {
      console.error("Erro ao criar árvore:", error)
    }
  }

  const handleOnboardingComplete = () => {
    setShowOnboarding(false)
    fetchArvores() // Refresh to get updated tree data
  }

  const handleArvoreUpdate = (updatedArvore: Arvore) => {
    setArvoreAtual(updatedArvore);
    setArvores(prevArvores => 
      prevArvores.map(arvore => 
        arvore.id === updatedArvore.id ? updatedArvore : arvore
      )
    );
  };

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
    return <TreeOnboardingWizard 
      arvore={arvoreAtual} 
      onComplete={handleOnboardingComplete}
      onArvoreUpdate={handleArvoreUpdate}
    />
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
              <p className="text-[#9AA0A6]">{arvoreAtual?.nome || "Selecione uma árvore"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={arvoreAtual?.id || ""}
              onChange={(e) => {
                const arvore = arvores.find((a) => a.id === Number.parseInt(e.target.value))
                setArvoreAtual(arvore || null)
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
                onClick={() => setShowOnboarding(true)}
                variant="outline"
                className="border-[#123C73] text-[#123C73] hover:bg-[#123C73] hover:text-white"
              >
                Cadastrar Pessoas
              </Button>
            )}
          </div>
        </div>
      </div>

      {arvoreAtual && !showOnboarding && <GenealogicalTree arvore={arvoreAtual} onUpdate={fetchArvores} />}
    </div>
  )
}

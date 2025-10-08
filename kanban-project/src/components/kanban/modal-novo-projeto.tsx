"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { X, FolderPlus } from "lucide-react"

interface ModalNovoProjetoProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (dados: { nome: string; descricao: string }) => void
}

export default function ModalNovoProjeto({ isOpen, onClose, onSubmit }: ModalNovoProjetoProps) {
  const [nome, setNome] = useState("")
  const [descricao, setDescricao] = useState("")
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!nome.trim()) {
      setErro("Nome do projeto é obrigatório")
      return
    }

    setLoading(true)
    setErro(null)

    try {
      await onSubmit({ nome: nome.trim(), descricao: descricao.trim() })

      setNome("")
      setDescricao("")
      setErro(null)
      onClose()
    } catch (error) {
      console.error("Erro ao criar projeto:", error)
      setErro(error instanceof Error ? error.message : "Erro ao criar projeto")
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (!loading) {
      setNome("")
      setDescricao("")
      setErro(null)
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-all duration-300"
        onClick={handleClose}
      />

      <Card className="relative z-10 w-full max-w-md mx-4 shadow-2xl animate-in fade-in-0 zoom-in-95 duration-300 bg-zinc-900 border-zinc-800">
        <CardHeader className="pb-4 border-b border-zinc-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg">
                <FolderPlus className="h-5 w-5 text-white" />
              </div>
              <CardTitle className="text-xl text-zinc-100">Novo Projeto</CardTitle>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              disabled={loading}
              className="h-8 w-8 p-0 hover:bg-zinc-800 text-zinc-400"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-sm text-zinc-400 mt-2">Crie um novo projeto para organizar suas atividades</p>
        </CardHeader>

        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nome" className="text-sm font-medium text-zinc-300">
                Nome do Projeto *
              </Label>
              <Input
                id="nome"
                type="text"
                placeholder="Ex: Desenvolvimento do App"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                disabled={loading}
                maxLength={50}
                className="w-full bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-600"
              />
              <p className="text-xs text-zinc-500">Máximo 50 caracteres</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="descricao" className="text-sm font-medium text-zinc-300">
                Descrição (opcional)
              </Label>
              <textarea
                id="descricao"
                placeholder="Descreva brevemente o projeto..."
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                disabled={loading}
                maxLength={200}
                rows={3}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-md text-sm text-zinc-100 placeholder:text-zinc-600 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              <p className="text-xs text-zinc-500">Máximo 200 caracteres ({descricao.length}/200)</p>
            </div>

            {erro && (
              <div className="p-3 bg-red-950 border border-red-900 rounded-md">
                <p className="text-sm text-red-400">{erro}</p>
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={loading}
                className="flex-1 border-zinc-800 hover:bg-zinc-800 text-zinc-300 bg-transparent"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={loading || !nome.trim()}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700"
              >
                {loading ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Criando...
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <FolderPlus className="h-4 w-4" />
                    Criar Projeto
                  </div>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

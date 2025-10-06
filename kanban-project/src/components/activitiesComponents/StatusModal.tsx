"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2, AlertCircle } from "lucide-react"

interface Status {
  id?: number
  nome: string
  _count?: {
    atividades: number
  }
}

interface StatusModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  status?: Status | null
  onSuccess: () => void
}

export default function StatusModal({ open, onOpenChange, status, onSuccess }: StatusModalProps) {
  const [nome, setNome] = useState(status?.nome || "")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEditing = !!status?.id
  const title = isEditing ? "Editar Status" : "Novo Status"
  const description = isEditing 
    ? "Edite as informações do status." 
    : "Crie um novo status para organizar suas atividades."

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!nome.trim()) {
      setError("Nome é obrigatório")
      return
    }

    if (nome.length > 20) {
      setError("Nome deve ter no máximo 20 caracteres")
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      const url = isEditing ? `/api/status/${status.id}` : '/api/status'
      const method = isEditing ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ nome: nome.trim() }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao salvar status')
      }

      onSuccess()
      onOpenChange(false)
      handleReset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setIsLoading(false)
    }
  }

  const handleReset = () => {
    setNome(status?.nome || "")
    setError(null)
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      handleReset()
    }
    onOpenChange(newOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-2">
              <Label htmlFor="nome">Nome do Status</Label>
              <Input
                id="nome"
                placeholder="Ex: Em andamento, Concluído..."
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                maxLength={20}
                disabled={isLoading}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                {nome.length}/20 caracteres
              </p>
            </div>

            {isEditing && status?._count && (
              <div className="text-sm text-muted-foreground">
                <p>
                  Este status está sendo usado por {status._count.atividades} atividade(s).
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isLoading}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading || !nome.trim()}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
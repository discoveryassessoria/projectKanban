"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Calendar, User, FileText, Tag, Save } from "lucide-react"
import type { AtividadeWithStatus } from "@/src/types/kanban"
import { useState, useEffect } from "react"

interface AtividadeDetailsModalProps {
  atividade: AtividadeWithStatus | null
  isOpen: boolean
  onClose: () => void
  onSave?: () => void
}

export function AtividadeDetailsModal({ atividade, isOpen, onClose, onSave }: AtividadeDetailsModalProps) {
  const [nome, setNome] = useState("")
  const [descricao, setDescricao] = useState("")
  const [responsavel, setResponsavel] = useState("")
  const [data, setData] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (atividade) {
      setNome(atividade.nome)
      setDescricao(atividade.descricao || "")
      setResponsavel(atividade.responsavel || "")
      setData(atividade.data || "")
    }
  }, [atividade])

  if (!atividade) return null

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const response = await fetch(`/api/atividades/${atividade.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome,
          descricao: descricao || null,
          responsavel: responsavel || null,
          data: data || null,
        }),
      })

      if (!response.ok) throw new Error("Falha ao atualizar atividade")

      onSave?.()
      onClose()
    } catch (error) {
      console.error(error)
      alert("Não foi possível salvar as alterações.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-zinc-100">Editar Atividade</DialogTitle>
          <DialogDescription className="text-zinc-400">Atualize os detalhes da atividade</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-400">Status:</span>
            <Badge className="bg-indigo-600 hover:bg-indigo-700 text-white">{atividade.status.nome}</Badge>
          </div>

          <div className="space-y-2">
            <Label htmlFor="nome" className="text-sm font-medium text-zinc-300">
              Nome da Atividade
            </Label>
            <Input
              id="nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="bg-zinc-950 border-zinc-800 text-zinc-100"
              placeholder="Digite o nome da atividade..."
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-zinc-400">
              <FileText className="h-4 w-4" />
              <Label htmlFor="descricao" className="text-sm font-medium text-zinc-300">
                Descrição
              </Label>
            </div>
            <Textarea
              id="descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className="bg-zinc-950 border-zinc-800 text-zinc-100 min-h-[100px]"
              placeholder="Adicione uma descrição detalhada..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-zinc-400">
                <Calendar className="h-4 w-4" />
                <Label htmlFor="data" className="text-sm font-medium text-zinc-300">
                  Data de Término
                </Label>
              </div>
              <Input
                id="data"
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
                className="bg-zinc-950 border-zinc-800 text-zinc-100"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-zinc-400">
                <User className="h-4 w-4" />
                <Label htmlFor="responsavel" className="text-sm font-medium text-zinc-300">
                  Responsável
                </Label>
              </div>
              <Input
                id="responsavel"
                value={responsavel}
                onChange={(e) => setResponsavel(e.target.value)}
                className="bg-zinc-950 border-zinc-800 text-zinc-100"
                placeholder="Nome do responsável..."
              />
            </div>
          </div>

          {/* Tags - read only for now */}
          {atividade.tags && atividade.tags.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-zinc-400">
                <Tag className="h-4 w-4" />
                <span className="text-sm font-medium">Tags</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {atividade.tags.map((tag, index) => (
                  <span
                    key={index}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg"
                    style={{
                      backgroundColor: tag.cor + "20",
                      color: tag.cor,
                      border: `1px solid ${tag.cor}40`,
                    }}
                  >
                    {tag.texto}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-between items-center pt-4 border-t border-zinc-800">
            <span className="text-xs text-zinc-500">ID da Atividade: #{atividade.id}</span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose} className="hover:bg-zinc-800">
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={isSaving} className="bg-indigo-600 hover:bg-indigo-700">
                <Save className="h-4 w-4 mr-2" />
                {isSaving ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { UserSelector } from "@/components/ui/user-selector"
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
  const [usuarioId, setUsuarioId] = useState<number | null>(null)
  const [usuarioNome, setUsuarioNome] = useState("")
  const [dataTermino, setDataTermino] = useState<Date | undefined>(undefined)
  const [isSaving, setIsSaving] = useState(false)

  const handleUserSelect = async (selectedUserId: number | null) => {
    setUsuarioId(selectedUserId)
    
    if (selectedUserId) {
      try {
        const response = await fetch(`/api/usuarios?search=`)
        if (response.ok) {
          const data = await response.json()
          const user = data.usuarios.find((u: any) => u.id === selectedUserId)
          if (user) {
            setUsuarioNome(user.nome)
          }
        }
      } catch (error) {
        console.error("Erro ao buscar usuário:", error)
      }
    } else {
      setUsuarioNome("")
    }
  }

  useEffect(() => {
    if (atividade) {
      setNome(atividade.nome)
      setDescricao(atividade.descricao || "")
      
      // Carregar usuário responsável se existir
      const primeiroUsuario = atividade.usuarios?.[0]
      if (primeiroUsuario) {
        setUsuarioId(primeiroUsuario.usuario.id)
        setUsuarioNome(primeiroUsuario.usuario.nome)
      } else {
        setUsuarioId(null)
        setUsuarioNome("")
      }
      
      setDataTermino(atividade.data_termino ? new Date(atividade.data_termino) : undefined)
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
          usuarioId: usuarioId,
          data_termino: dataTermino ? dataTermino.toISOString().split('T')[0] : null,
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
      <DialogContent className="bg-white border-gray-200 text-gray-900 max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-gray-900">Editar Atividade</DialogTitle>
          <DialogDescription className="text-gray-600">Atualize os detalhes da atividade</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Status:</span>
            <Badge className="bg-indigo-600 hover:bg-indigo-700 text-white">{atividade.status.nome}</Badge>
          </div>

          <div className="space-y-2">
            <Label htmlFor="nome" className="text-sm font-medium text-gray-700">
              Nome da Atividade
            </Label>
            <Input
              id="nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="bg-white border-gray-300 text-gray-900"
              placeholder="Digite o nome da atividade..."
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-gray-600">
              <FileText className="h-4 w-4" />
              <Label htmlFor="descricao" className="text-sm font-medium text-gray-700">
                Descrição
              </Label>
            </div>
            <Textarea
              id="descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className="bg-white border-gray-300 text-gray-900 min-h-[100px]"
              placeholder="Adicione uma descrição detalhada..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-gray-600">
                <Calendar className="h-4 w-4" />
                <Label htmlFor="data" className="text-sm font-medium text-gray-700">
                  Data de Término
                </Label>
              </div>
              <DatePickerField
                value={dataTermino}
                onChange={setDataTermino}
                placeholder="Selecione uma data"
                className="bg-white border-gray-300 text-gray-900 w-full"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-gray-600">
                <User className="h-4 w-4" />
                <Label htmlFor="responsavel" className="text-sm font-medium text-gray-700">
                  Responsável
                </Label>
              </div>
              <UserSelector
                value={usuarioId?.toString()}
                onChange={handleUserSelect}
                placeholder="Selecione um usuário..."
                className="bg-white border-gray-300 text-gray-900 w-full"
              />
              {usuarioNome && (
                <p className="text-xs text-gray-500">Selecionado: {usuarioNome}</p>
              )}
            </div>
          </div>

          {/* Tags - read only for now */}
          {atividade.tags && atividade.tags.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-gray-600">
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

          <div className="flex justify-between items-center pt-4 border-t border-gray-200">
            <span className="text-xs text-gray-500">ID da Atividade: #{atividade.id}</span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose} className="hover:bg-gray-100">
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

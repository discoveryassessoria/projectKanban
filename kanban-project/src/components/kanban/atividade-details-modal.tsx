"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { UserSelector } from "@/components/ui/user-selector"
import { TreeSelector } from "../ui/tree-selector"
import { Calendar, User, FileText, Tag, Save, TreePine, ArrowUpRight } from "lucide-react"
import type { AtividadeWithStatus } from "@/src/types/kanban"
import Link from "next/link"
import { useState, useEffect, useCallback } from "react"

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
  const [arvore_id, setArvore_id] = useState<number | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (atividade) {
      setNome(atividade.nome)
      setDescricao(atividade.descricao || "")
      setArvore_id(atividade.arvore_id || null)

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
          arvore_id: arvore_id,
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <DialogTitle className="text-2xl font-bold">Editar Atividade</DialogTitle>
              <Badge className="bg-indigo-600 hover:bg-indigo-700 text-white">{atividade.status.nome}</Badge>
            </div>
          </div>
          <DialogDescription>Atualize os detalhes da atividade</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Status:</span>
            <Badge className="bg-indigo-600 hover:bg-indigo-700 text-white">{atividade.status.nome}</Badge>
          </div>

          <div className="space-y-2">
            <Label htmlFor="nome" className="text-sm font-medium">
              Nome da Atividade
            </Label>
            <Input
              id="nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Digite o nome da atividade..."
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              <Label htmlFor="descricao" className="text-sm font-medium">
                Descrição
              </Label>
            </div>
            <Textarea
              id="descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className="min-h-[100px]"
              placeholder="Adicione uma descrição detalhada..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <Label htmlFor="data" className="text-sm font-medium">
                  Data de Término
                </Label>
              </div>
              <DatePickerField
                value={dataTermino}
                onChange={setDataTermino}
                placeholder="Selecione uma data"
                className="w-full"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4" />
                <Label htmlFor="responsavel" className="text-sm font-medium">
                  Responsável
                </Label>
              </div>
              <UserSelector value={usuarioId?.toString()} onChange={setUsuarioId} placeholder="Selecione um usuário..." className="w-full" />
              {usuarioNome && (
                <p className="text-xs text-muted-foreground">Selecionado: {usuarioNome}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <TreePine className="h-4 w-4" />
              <Label htmlFor="arvore" className="text-sm font-medium">
                Árvore Genealógica Vinculada
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <TreeSelector value={arvore_id?.toString()} onChange={setArvore_id} placeholder="Vincular a uma árvore..." className="w-full" />
              {arvore_id && (
                <Link href={`/genealogy?treeId=${arvore_id}`} passHref legacyBehavior>
                  <a target="" rel="noopener noreferrer" title="Abrir árvore em nova aba" className="flex items-center justify-center p-2 rounded-md border hover:bg-accent transition-colors">
                    <ArrowUpRight className="h-5 w-5" />
                  </a>
                </Link>
              )}
            </div>
          </div>

          {/* Tags - read only for now */}
          {atividade.tags && atividade.tags.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
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

          <div className="flex justify-between items-center pt-4 border-t">
            <span className="text-xs text-muted-foreground">ID da Atividade: #{atividade.id}</span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>
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

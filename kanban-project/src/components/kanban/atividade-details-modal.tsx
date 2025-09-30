"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Calendar, User, FileText, Tag } from "lucide-react"
import type { AtividadeWithStatus } from "@/src/types/kanban"

interface AtividadeDetailsModalProps {
  atividade: AtividadeWithStatus | null
  isOpen: boolean
  onClose: () => void
}

export function AtividadeDetailsModal({ atividade, isOpen, onClose }: AtividadeDetailsModalProps) {
  if (!atividade) return null

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-zinc-100">{atividade.nome}</DialogTitle>
          <DialogDescription className="text-zinc-400">Detalhes completos da atividade</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Status Badge */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-400">Status:</span>
            <Badge className="bg-indigo-600 hover:bg-indigo-700 text-white">{atividade.status.nome}</Badge>
          </div>

          {/* Description */}
          {atividade.descricao && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-zinc-400">
                <FileText className="h-4 w-4" />
                <span className="text-sm font-medium">Descrição</span>
              </div>
              <p className="text-zinc-300 bg-zinc-950 p-4 rounded-lg border border-zinc-800">{atividade.descricao}</p>
            </div>
          )}

          {/* Metadata Grid */}
          <div className="grid grid-cols-2 gap-4">
            {atividade.data && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-zinc-400">
                  <Calendar className="h-4 w-4" />
                  <span className="text-sm font-medium">Data de Término</span>
                </div>
                <p className="text-zinc-300 bg-zinc-950 p-3 rounded-lg border border-zinc-800">{atividade.data}</p>
              </div>
            )}

            {atividade.responsavel && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-zinc-400">
                  <User className="h-4 w-4" />
                  <span className="text-sm font-medium">Responsável</span>
                </div>
                <p className="text-zinc-300 bg-zinc-950 p-3 rounded-lg border border-zinc-800">
                  {atividade.responsavel}
                </p>
              </div>
            )}
          </div>

          {/* Tags */}
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

          {/* Activity ID (for reference) */}
          <div className="pt-4 border-t border-zinc-800">
            <span className="text-xs text-zinc-500">ID da Atividade: #{atividade.id}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

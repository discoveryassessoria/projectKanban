"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Plus, Edit, Trash2, AlertTriangle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import StatusModal from "./StatusModal"

interface Status {
  id: number
  nome: string
  _count: {
    atividades: number
  }
}

interface CustomStatusManagerProps {
  onStatusCreated?: () => void
}

export default function CustomStatusManager({ onStatusCreated }: CustomStatusManagerProps) {
  const [statusList, setStatusList] = useState<Status[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Modal states
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedStatus, setSelectedStatus] = useState<Status | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [statusToDelete, setStatusToDelete] = useState<Status | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    fetchStatus()
  }, [])

  const fetchStatus = async () => {
    try {
      setIsLoading(true)
      setError(null)
      
      const response = await fetch('/api/status')
      if (!response.ok) {
        throw new Error('Erro ao carregar status')
      }

      const data = await response.json()
      setStatusList(data.status || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateStatus = () => {
    setSelectedStatus(null)
    setModalOpen(true)
  }

  const handleEditStatus = (status: Status) => {
    setSelectedStatus(status)
    setModalOpen(true)
  }

  const handleDeleteStatus = (status: Status) => {
    setStatusToDelete(status)
    setDeleteDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (!statusToDelete) return

    try {
      setIsDeleting(true)
      
      const response = await fetch(`/api/status/${statusToDelete.id}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao deletar status')
      }

      await fetchStatus()
      setDeleteDialogOpen(false)
      setStatusToDelete(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleModalSuccess = () => {
    fetchStatus()
    onStatusCreated?.()
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center">
            <p>Carregando status...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Status Personalizados</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Gerencie os status disponíveis para suas atividades
              </p>
            </div>
            <Button onClick={handleCreateStatus}>
              <Plus className="h-4 w-4 mr-2" />
              Novo Status
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {statusList.map((status) => (
              <Card key={status.id} className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-sm">{status.nome}</h4>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEditStatus(status)}
                      className="h-7 w-7 p-0"
                    >
                      <Edit className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteStatus(status)}
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      disabled={(status._count?.atividades || 0) > 0}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Badge variant="secondary" className="text-xs">
                    {status._count?.atividades || 0} atividade(s)
                  </Badge>
                  {(status._count?.atividades || 0) > 0 && (
                    <span className="text-xs text-muted-foreground">
                      Em uso
                    </span>
                  )}
                </div>
              </Card>
            ))}
          </div>

          {statusList.length === 0 && (
            <div className="text-center py-8">
              <h3 className="text-lg font-semibold mb-2">Nenhum status encontrado</h3>
              <p className="text-muted-foreground mb-4">
                Crie seu primeiro status personalizado para organizar suas atividades.
              </p>
              <Button onClick={handleCreateStatus}>
                <Plus className="h-4 w-4 mr-2" />
                Criar primeiro status
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal para criar/editar status */}
      <StatusModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        status={selectedStatus}
        onSuccess={handleModalSuccess}
      />

      {/* Dialog de confirmação para deletar */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar exclusão</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja deletar o status "{statusToDelete?.nome}"?
              Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>

          {statusToDelete && (statusToDelete._count?.atividades || 0) > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Este status não pode ser deletado pois está sendo usado por {statusToDelete._count?.atividades || 0} atividade(s).
                Remova ou altere o status dessas atividades primeiro.
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={isDeleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={isDeleting || (statusToDelete?._count.atividades || 0) > 0}
            >
              {isDeleting ? "Deletando..." : "Deletar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
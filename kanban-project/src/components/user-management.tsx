"use client"

import { useState, useEffect } from "react"
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { UserPlus, Pencil, Trash2, Search, Shield, User, Users } from "lucide-react"
import { UserType, userTypeLabels } from "@/src/utils/userTypes"
import { getUsers, createUser, updateUser, deleteUser } from "@/src/services/userService"

interface Usuario {
  id: number
  nome: string
  email: string
  tipo: string
}

export function UserManagement() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  // Estados para modal de criar/editar
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [currentUser, setCurrentUser] = useState<Usuario | null>(null)
  const [formData, setFormData] = useState({
    nome: "",
    email: "",
    senha: "",
    tipo: "",
  })
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Estados para modal de confirmação de exclusão
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [userToDelete, setUserToDelete] = useState<Usuario | null>(null)

  // Carregar usuários
  const loadUsers = async () => {
    try {
      setIsLoading(true)
      setError("")
      const users = await getUsers(searchTerm)
      // Filtrar apenas usuários com id definido
      const validUsers = users.filter((u): u is Usuario => u.id !== undefined) as Usuario[]
      setUsuarios(validUsers)
    } catch (err: any) {
      setError(err.message || "Erro ao carregar usuários")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadUsers()
  }, [])

  // Buscar com debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!isLoading) {
        loadUsers()
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [searchTerm])

  // Abrir modal para criar usuário
  const handleCreate = () => {
    setIsEditing(false)
    setCurrentUser(null)
    setFormData({ nome: "", email: "", senha: "", tipo: "" })
    setIsDialogOpen(true)
    setError("")
    setSuccess("")
  }

  // Abrir modal para editar usuário
  const handleEdit = (usuario: Usuario) => {
    setIsEditing(true)
    setCurrentUser(usuario)
    setFormData({
      nome: usuario.nome,
      email: usuario.email,
      senha: "",
      tipo: usuario.tipo,
    })
    setIsDialogOpen(true)
    setError("")
    setSuccess("")
  }

  // Abrir modal de confirmação de exclusão
  const handleDeleteClick = (usuario: Usuario) => {
    setUserToDelete(usuario)
    setIsDeleteDialogOpen(true)
    setError("")
    setSuccess("")
  }

  // Confirmar exclusão
  const confirmDelete = async () => {
    if (!userToDelete) return

    try {
      setIsSubmitting(true)
      await deleteUser(userToDelete.id)
      setSuccess("Usuário deletado com sucesso!")
      setIsDeleteDialogOpen(false)
      setUserToDelete(null)
      await loadUsers()
    } catch (err: any) {
      setError(err.message || "Erro ao deletar usuário")
      setIsDeleteDialogOpen(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Submeter formulário (criar ou editar)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSuccess("")

    // Validações
    if (!formData.nome || !formData.email || !formData.tipo) {
      setError("Preencha todos os campos obrigatórios")
      return
    }

    if (!isEditing && !formData.senha) {
      setError("Senha é obrigatória para novos usuários")
      return
    }

    try {
      setIsSubmitting(true)

      if (isEditing && currentUser) {
        // Editar usuário
        const dataToUpdate: any = {
          nome: formData.nome,
          email: formData.email,
          tipo: formData.tipo,
        }
        
        // Só incluir senha se foi fornecida
        if (formData.senha) {
          dataToUpdate.senha = formData.senha
        }

        await updateUser(currentUser.id, dataToUpdate)
        setSuccess("Usuário atualizado com sucesso!")
      } else {
        // Criar novo usuário
        await createUser({
          nome: formData.nome,
          email: formData.email,
          senha: formData.senha,
          tipo: formData.tipo,
        })
        setSuccess("Usuário criado com sucesso!")
      }

      setIsDialogOpen(false)
      setFormData({ nome: "", email: "", senha: "", tipo: "" })
      await loadUsers()
    } catch (err: any) {
      setError(err.message || "Erro ao salvar usuário")
    } finally {
      setIsSubmitting(false)
    }
  }

  // Obter badge de tipo
  const getBadgeVariant = (tipo: string) => {
    switch (tipo) {
      case UserType.ADMIN:
        return "default"
      case UserType.GERENTE:
        return "secondary"
      default:
        return "outline"
    }
  }

  const getBadgeIcon = (tipo: string) => {
    switch (tipo) {
      case UserType.ADMIN:
        return <Shield className="h-3 w-3 mr-1" />
      case UserType.GERENTE:
        return <Users className="h-3 w-3 mr-1" />
      default:
        return <User className="h-3 w-3 mr-1" />
    }
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Gerenciamento de Usuários</h2>
          <p className="text-muted-foreground">Crie e gerencie usuários do sistema</p>
        </div>
        <Button onClick={handleCreate} className="gap-2">
          <UserPlus className="h-4 w-4" />
          Novo Usuário
        </Button>
      </div>

      {/* Mensagens de feedback */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="border-green-500/50 bg-green-50 dark:bg-green-950/20">
          <AlertDescription className="text-green-700 dark:text-green-400">{success}</AlertDescription>
        </Alert>
      )}

      {/* Busca */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome ou email..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Lista de usuários */}
      <Card>
        <CardHeader>
          <CardTitle>Usuários Cadastrados</CardTitle>
          <CardDescription>
            {usuarios.length} {usuarios.length === 1 ? "usuário encontrado" : "usuários encontrados"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : usuarios.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Nenhum usuário encontrado
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium">Nome</th>
                    <th className="text-left py-3 px-4 font-medium">Email</th>
                    <th className="text-left py-3 px-4 font-medium">Tipo</th>
                    <th className="text-right py-3 px-4 font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {usuarios.map((usuario) => (
                    <tr key={usuario.id} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-3 px-4">{usuario.nome}</td>
                      <td className="py-3 px-4 text-muted-foreground">{usuario.email}</td>
                      <td className="py-3 px-4">
                        <Badge variant={getBadgeVariant(usuario.tipo)} className="gap-1">
                          {getBadgeIcon(usuario.tipo)}
                          {userTypeLabels[usuario.tipo as UserType]}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(usuario)}
                            title="Editar"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {usuario.tipo !== UserType.ADMIN && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteClick(usuario)}
                              title="Deletar"
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal de Criar/Editar */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Editar Usuário" : "Novo Usuário"}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Atualize as informações do usuário"
                : "Preencha os dados para criar um novo usuário"}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nome">Nome *</Label>
              <Input
                id="nome"
                value={formData.nome}
                onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                placeholder="Nome completo"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="email@exemplo.com"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tipo">Tipo de Usuário *</Label>
              <select
                id="tipo"
                value={formData.tipo}
                onChange={(e) => setFormData({ ...formData, tipo: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:border-primary focus:ring-1 focus:ring-primary/20 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                required
              >
                <option value="">Selecione o tipo</option>
                {Object.entries(userTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="senha">
                Senha {!isEditing && "*"} {isEditing && "(deixe em branco para manter)"}
              </Label>
              <Input
                id="senha"
                type="password"
                value={formData.senha}
                onChange={(e) => setFormData({ ...formData, senha: e.target.value })}
                placeholder="Senha"
                required={!isEditing}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsDialogOpen(false)}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Salvando...
                  </>
                ) : isEditing ? (
                  "Atualizar"
                ) : (
                  "Criar"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal de Confirmação de Exclusão */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja deletar o usuário <strong>{userToDelete?.nome}</strong>? Esta
              ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={isSubmitting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isSubmitting ? "Deletando..." : "Deletar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useIsAdmin } from "@/src/hooks/use-is-admin"
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { UserPlus, Pencil, Trash2, Search, Shield, User, Users, LogOut, Bell } from "lucide-react"
import { UserType, userTypeLabels } from "@/src/utils/userTypes"
import { getUsers, createUser, updateUser, deleteUser } from "@/src/services/userService"

interface Usuario {
  id: number
  nome: string
  email: string
  tipo: string
}

interface UserData {
  nome: string
  tipo?: string
}

export default function AdministratorPage() {
  const router = useRouter()
  const { isAdmin, isLoading: isAdminLoading } = useIsAdmin()

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

  const getInitials = (nome: string) => {
    return nome
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }

  const user: UserData = typeof window !== 'undefined' 
    ? JSON.parse(localStorage.getItem('user') || '{"nome":"Usuário"}') 
    : { nome: "Usuário" }

  const handleLogout = () => {
    localStorage.removeItem("authToken")
    localStorage.removeItem("user")
    router.push("/login")
  }

  useEffect(() => {
    const token = localStorage.getItem("authToken")
    if (!token) {
      router.push("/login")
      return
    }

    if (!isAdminLoading && !isAdmin) {
      router.push("/dashboard")
    }
  }, [isAdmin, isAdminLoading, router])

  // Carregar usuários
  const loadUsers = async () => {
    try {
      setIsLoading(true)
      setError("")
      const users = await getUsers(searchTerm)
      const validUsers = users.filter((u): u is Usuario => u.id !== undefined) as Usuario[]
      setUsuarios(validUsers)
    } catch (err: any) {
      setError(err.message || "Erro ao carregar usuários")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (isAdmin) {
      loadUsers()
    }
  }, [isAdmin])

  // Buscar com debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!isLoading && isAdmin) {
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
        const dataToUpdate: any = {
          nome: formData.nome,
          email: formData.email,
          tipo: formData.tipo,
        }
        
        if (formData.senha) {
          dataToUpdate.senha = formData.senha
        }

        await updateUser(currentUser.id, dataToUpdate)
        setSuccess("Usuário atualizado com sucesso!")
      } else {
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
  const getBadgeVariant = (tipo: string): "default" | "secondary" | "outline" => {
    switch (tipo) {
      case UserType.ADMIN:
        return "default"
      case UserType.GESTOR:
        return "secondary"
      default:
        return "outline"
    }
  }

  const getBadgeIcon = (tipo: string) => {
    switch (tipo) {
      case UserType.ADMIN:
        return <Shield className="h-3 w-3 mr-1" />
      case UserType.GESTOR:
        return <Users className="h-3 w-3 mr-1" />
      default:
        return <User className="h-3 w-3 mr-1" />
    }
  }

  if (isAdminLoading) {
    return (
      <div className="text-white w-full">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-fixed" />
        <div className="min-h-screen bg-black/40 backdrop-blur-sm w-full flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-white mx-auto mb-4"></div>
            <p className="text-lg text-white">Verificando permissões...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!isAdmin) {
    return null
  }

  return (
    <div className="text-white w-full">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-fixed" />

      <div className="min-h-screen bg-black/40 backdrop-blur-sm w-full">
        {/* HEADER TRANSLÚCIDO */}
        <header className="border-b border-white/10 bg-gradient-to-r from-[#102A6B]/70 via-[#14357F]/70 to-[#1E4AA0]/70 backdrop-blur-xl shadow-lg sticky top-0 z-10">
          <div className="px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-white/20 flex items-center justify-center text-sm font-bold backdrop-blur-sm">
                GD
              </div>
              <div>
                <h1 className="text-lg font-semibold leading-tight">
                  Grupo Discovery · Gerenciamento de Usuários
                </h1>
                <p className="text-xs text-white/70">
                  Crie e gerencie usuários do sistema
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button className="relative hidden md:inline-flex items-center justify-center rounded-full p-2 bg-white/10 border border-white/20 hover:bg-white/20 transition backdrop-blur-sm">
                <Bell className="h-4 w-4" />
                <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-red-500 border border-white" />
              </button>

              <div className="flex items-center gap-2">
                <Avatar className="h-9 w-9 border border-white/40">
                  <AvatarFallback className="bg-white/20 text-xs font-medium backdrop-blur-sm">
                    {getInitials(user.nome)}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden md:block text-right">
                  <p className="text-xs font-medium leading-tight">
                    {user.nome}
                  </p>
                  <p className="text-[11px] text-white/70 leading-tight">
                    {user.tipo || 'Administrador'}
                  </p>
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={handleLogout}
                className="border-white/40 text-xs bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm"
              >
                <LogOut className="h-3 w-3 mr-1.5" />
                Sair
              </Button>
            </div>
          </div>
        </header>

        {/* CONTEÚDO PRINCIPAL */}
        <main className="px-6 py-8 max-w-7xl mx-auto space-y-6">
          {/* Ações do topo */}
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-end">
            <Button onClick={handleCreate} className="gap-2 bg-blue-600 hover:bg-blue-700 text-white">
              <UserPlus className="h-4 w-4" />
              Novo Usuário
            </Button>
          </div>

          {/* Mensagens de feedback */}
          {error && (
            <Alert variant="destructive" className="bg-red-500/20 border-red-500/50 text-white">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert className="border-green-500/50 bg-green-500/20 text-green-100">
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}

          {/* Busca */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Buscar por nome ou email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-white/95 border-white/20 text-gray-900 placeholder:text-gray-500"
            />
          </div>

          {/* Lista de usuários */}
          <Card className="bg-white/95 backdrop-blur-xl border-white/20 shadow-xl">
            <CardHeader>
              <CardTitle className="text-gray-900">Usuários Cadastrados</CardTitle>
              <CardDescription>
                {usuarios.length} {usuarios.length === 1 ? "usuário encontrado" : "usuários encontrados"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : usuarios.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  Nenhum usuário encontrado
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-3 px-4 font-medium text-gray-700">Nome</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-700">Email</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-700">Tipo</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-700">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usuarios.map((usuario) => (
                        <tr key={usuario.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                          <td className="py-3 px-4 text-gray-900">{usuario.nome}</td>
                          <td className="py-3 px-4 text-gray-500">{usuario.email}</td>
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
                                className="text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              {usuario.tipo !== UserType.ADMIN && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDeleteClick(usuario)}
                                  title="Deletar"
                                  className="text-red-500 hover:text-red-700 hover:bg-red-50"
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
        </main>

        {/* Modal de Criar/Editar */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="bg-white">
            <DialogHeader>
              <DialogTitle className="text-gray-900">{isEditing ? "Editar Usuário" : "Novo Usuário"}</DialogTitle>
              <DialogDescription>
                {isEditing
                  ? "Atualize as informações do usuário"
                  : "Preencha os dados para criar um novo usuário"}
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="nome" className="text-gray-700">Nome *</Label>
                <Input
                  id="nome"
                  value={formData.nome}
                  onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                  placeholder="Nome completo"
                  required
                  className="bg-white border-gray-300"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className="text-gray-700">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="email@exemplo.com"
                  required
                  className="bg-white border-gray-300"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tipo" className="text-gray-700">Tipo de Usuário *</Label>
                <select
                  id="tipo"
                  value={formData.tipo}
                  onChange={(e) => setFormData({ ...formData, tipo: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
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
                <Label htmlFor="senha" className="text-gray-700">
                  Senha {!isEditing && "*"} {isEditing && "(deixe em branco para manter)"}
                </Label>
                <Input
                  id="senha"
                  type="password"
                  value={formData.senha}
                  onChange={(e) => setFormData({ ...formData, senha: e.target.value })}
                  placeholder="Senha"
                  required={!isEditing}
                  className="bg-white border-gray-300"
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
                <Button type="submit" disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-700 text-white">
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
          <AlertDialogContent className="bg-white">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-gray-900">Confirmar Exclusão</AlertDialogTitle>
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
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {isSubmitting ? "Deletando..." : "Deletar"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
// ESTE ARQUIVO VAI EM: src/app/administrator/page.tsx

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
import { UserPlus, Pencil, Trash2, Search, Shield, User, Users } from "lucide-react"
import { UserType, userTypeLabels } from "@/src/utils/userTypes"
import { getUsers, createUser, updateUser, deleteUser } from "@/src/services/userService"
import { HeaderBar } from "@/src/components/header-bar"

interface Usuario {
  id: number
  nome: string
  email: string
  tipo: string
}

interface UserData {
  nome: string
  email?: string
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
  const [user, setUser] = useState<UserData>({ nome: "Usuário" })

  // Estados para dados do HeaderBar
  const [projetos, setProjetos] = useState<any[]>([])
  const [atividades, setAtividades] = useState<any[]>([])
  const [arvores, setArvores] = useState<any[]>([])

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

  const handleLogout = () => {
    localStorage.removeItem("authToken")
    localStorage.removeItem("user")
    router.push("/login")
  }

  useEffect(() => {
    // Carregar usuário do localStorage
    if (typeof window !== 'undefined') {
      const storedUser = localStorage.getItem('user')
      if (storedUser) {
        try {
          setUser(JSON.parse(storedUser))
        } catch {
          setUser({ nome: "Usuário" })
        }
      }
    }

    const token = localStorage.getItem("authToken")
    if (!token) {
      router.push("/login")
      return
    }

    if (!isAdminLoading && !isAdmin) {
      router.push("/dashboard")
    }

    fetchHeaderData()
  }, [isAdmin, isAdminLoading, router])

  const fetchHeaderData = async () => {
    try {
      const [projetosRes, atividadesRes, arvoresRes] = await Promise.all([
        fetch("/api/projetos"),
        fetch("/api/activities"),
        fetch("/api/arvore")
      ])

      // Verificar se as respostas foram bem-sucedidas antes de fazer parse
      if (projetosRes.ok) {
        const projetosData = await projetosRes.json()
        setProjetos(projetosData.projetos || [])
      } else {
        console.warn("Erro ao buscar projetos:", projetosRes.status)
        setProjetos([])
      }

      if (atividadesRes.ok) {
        const atividadesData = await atividadesRes.json()
        setAtividades(Array.isArray(atividadesData) ? atividadesData : [])
      } else {
        console.warn("Erro ao buscar atividades:", atividadesRes.status)
        setAtividades([])
      }

      if (arvoresRes.ok) {
        const arvoresData = await arvoresRes.json()
        setArvores(Array.isArray(arvoresData) ? arvoresData : [])
      } else {
        console.warn("Erro ao buscar árvores:", arvoresRes.status)
        setArvores([])
      }
    } catch (error) {
      console.error("Erro ao buscar dados:", error)
      // Garantir que os estados são arrays vazios em caso de erro
      setProjetos([])
      setAtividades([])
      setArvores([])
    }
  }

  // Carregar usuários
  const loadUsers = async () => {
    try {
      setIsLoading(true)
      setError("")
      
      // Verificar se tem token antes de tentar carregar
      const token = localStorage.getItem("authToken")
      if (!token) {
        console.warn("Token não encontrado, aguardando autenticação...")
        setUsuarios([])
        return
      }
      
      const users = await getUsers(searchTerm)
      const validUsers = users.filter((u): u is Usuario => u.id !== undefined) as Usuario[]
      setUsuarios(validUsers)
    } catch (err: any) {
      // Não mostrar erro de autenticação na UI - apenas log
      if (err.message?.includes("autenticado") || err.message?.includes("401")) {
        console.warn("Erro de autenticação:", err.message)
        setUsuarios([])
      } else {
        setError(err.message || "Erro ao carregar usuários")
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    // Só carregar usuários quando for admin E tiver token
    const token = localStorage.getItem("authToken")
    if (isAdmin && token) {
      loadUsers()
    }
  }, [isAdmin])

  // Buscar com debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      const token = localStorage.getItem("authToken")
      if (!isLoading && isAdmin && token) {
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
      <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
        <div className="min-h-screen bg-black/40 backdrop-blur-sm flex items-center justify-center">
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
    <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
      {/* BACKGROUND FIXO */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />

      {/* HEADER */}
      <HeaderBar
        title="Gerenciar Usuários"
        subtitle="Crie e gerencie usuários do sistema"
        userName={user.nome}
        userRole="Administrador"
        userEmail={user.email || ''}
        projetos={projetos}
        arvores={arvores}
        onLogout={handleLogout}
      />

      {/* CONTEÚDO COM OVERLAY */}
      <div className="min-h-screen relative">
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />
        
        <main className="relative px-6 py-8 max-w-7xl mx-auto space-y-6">
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
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" />
            <Input
              placeholder="Buscar por nome ou email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-white/50"
            />
          </div>

          {/* Lista de usuários */}
          <Card className="bg-white/5 backdrop-blur-xl border border-white/10">
            <CardHeader>
              <CardTitle className="text-white">Usuários Cadastrados</CardTitle>
              <CardDescription className="text-white/60">
                {usuarios.length} {usuarios.length === 1 ? "usuário encontrado" : "usuários encontrados"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                </div>
              ) : usuarios.length === 0 ? (
                <div className="text-center py-8 text-white/50">
                  Nenhum usuário encontrado
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="text-left py-3 px-4 font-medium text-white/70">Nome</th>
                        <th className="text-left py-3 px-4 font-medium text-white/70">Email</th>
                        <th className="text-left py-3 px-4 font-medium text-white/70">Tipo</th>
                        <th className="text-right py-3 px-4 font-medium text-white/70">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usuarios.map((usuario) => (
                        <tr key={usuario.id} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                          <td className="py-3 px-4 text-white">{usuario.nome}</td>
                          <td className="py-3 px-4 text-white/70">{usuario.email}</td>
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
                                className="text-white/70 hover:text-white hover:bg-white/10"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              {usuario.tipo !== UserType.ADMIN && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDeleteClick(usuario)}
                                  title="Deletar"
                                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
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
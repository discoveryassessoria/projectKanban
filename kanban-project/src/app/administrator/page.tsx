// ESTE ARQUIVO VAI EM: src/app/administrator/page.tsx

"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { usePermissoes } from "@/src/hooks/use-permissoes"
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
import { Switch } from "@/components/ui/switch"
import { UserPlus, Pencil, Trash2, Search, Shield, User, Users, ChevronDown, ChevronUp, Lock, RotateCcw } from "lucide-react"
import { UserType, userTypeLabels } from "@/src/utils/userTypes"
import { getUsers, createUser, updateUser, deleteUser } from "@/src/services/userService"
import { HeaderBar } from "@/src/components/header-bar"

// ========================================
// CONSTANTES DE PERMISSÕES (mesmo mapa do permissoes.ts)
// ========================================
const MODULOS_PERMISSOES = [
  {
    modulo: 'Tarefas',
    icone: '✅',
    permissoes: [
      { chave: 'tarefas.ver', label: 'Ver tarefas' },
      { chave: 'tarefas.criar', label: 'Criar tarefas' },
      { chave: 'tarefas.editar', label: 'Editar tarefas' },
      { chave: 'tarefas.excluir', label: 'Excluir tarefas' },
      { chave: 'tarefas.iniciar_concluir', label: 'Iniciar e concluir tarefas' },
    ],
  },
  {
    modulo: 'Processos',
    icone: '📋',
    permissoes: [
      { chave: 'processos.ver', label: 'Ver processos' },
      { chave: 'processos.criar', label: 'Criar processos' },
      { chave: 'processos.editar', label: 'Editar processos' },
      { chave: 'processos.editar_status', label: 'Alterar status/etapa' },
      { chave: 'processos.excluir', label: 'Excluir processos' },
      { chave: 'processos.criar_coluna', label: 'Criar colunas no kanban' },
      { chave: 'processos.editar_coluna', label: 'Editar colunas no kanban' },
      { chave: 'processos.excluir_coluna', label: 'Excluir colunas no kanban' },
      { chave: 'processos.ver_paginas', label: 'Ver páginas (Protocolos/Info)' },
      { chave: 'processos.editar_paginas', label: 'Editar páginas (Protocolos/Info)' },
    ],
  },
  {
    modulo: 'Clientes / Cadastros',
    icone: '👤',
    permissoes: [
      { chave: 'clientes.ver', label: 'Ver contratantes e requerentes' },
      { chave: 'clientes.criar', label: 'Cadastrar clientes' },
      { chave: 'clientes.editar', label: 'Editar dados cadastrais' },
      { chave: 'clientes.excluir', label: 'Excluir clientes' },
    ],
  },
  {
    modulo: 'Financeiro',
    icone: '💰',
    permissoes: [
      { chave: 'financeiro.ver', label: 'Ver faturas e pagamentos' },
      { chave: 'financeiro.fatura_criar', label: 'Criar faturas' },
      { chave: 'financeiro.fatura_excluir', label: 'Excluir faturas' },
      { chave: 'financeiro.pagamento_criar', label: 'Registrar pagamentos' },
      { chave: 'financeiro.pagamento_editar', label: 'Editar pagamentos' },
      { chave: 'financeiro.pagamento_excluir', label: 'Excluir pagamentos' },
      { chave: 'financeiro.coluna_criar', label: 'Adicionar coluna na planilha' },
      { chave: 'financeiro.coluna_editar', label: 'Editar nome de coluna' },
      { chave: 'financeiro.coluna_excluir', label: 'Excluir coluna da planilha' },
      { chave: 'financeiro.custos_editar', label: 'Editar valores e reordenar planilha' },
    ],
  },
  {
    modulo: 'Mensagens',
    icone: '💬',
    permissoes: [
      { chave: 'mensagens.ver', label: 'Ver mensagens' },
      { chave: 'mensagens.responder', label: 'Responder mensagens' },
      { chave: 'mensagens.apagar', label: 'Apagar mensagens de outros' },
    ],
  },
  {
    modulo: 'Eventos',
    icone: '📅',
    permissoes: [
      { chave: 'eventos.ver', label: 'Ver eventos' },
      { chave: 'eventos.criar', label: 'Criar eventos' },
      { chave: 'eventos.editar', label: 'Editar eventos' },
      { chave: 'eventos.excluir', label: 'Excluir eventos' },
    ],
  },
  {
    modulo: 'Árvore Genealógica',
    icone: '🌳',
    permissoes: [
      { chave: 'arvore.ver', label: 'Ver árvore' },
      { chave: 'arvore.criar', label: 'Criar pessoas na árvore' },
      { chave: 'arvore.editar', label: 'Editar pessoas na árvore' },
      { chave: 'arvore.excluir', label: 'Excluir pessoas da árvore' },
      { chave: 'arvore.criar_documento', label: 'Criar documentos' },
      { chave: 'arvore.editar_documento', label: 'Editar documentos' },
      { chave: 'arvore.excluir_documento', label: 'Excluir documentos' },
    ],
  },
  {
    modulo: 'Administração',
    icone: '🛡️',
    permissoes: [
      { chave: 'usuarios.gerenciar', label: 'Ver usuários' },
      { chave: 'usuarios.criar', label: 'Criar usuários' },
      { chave: 'usuarios.editar', label: 'Editar usuários' },
      { chave: 'usuarios.excluir', label: 'Excluir usuários' },
    ],
  },
]

// Todas as chaves de permissão
const TODAS_CHAVES = MODULOS_PERMISSOES.flatMap(m => m.permissoes.map(p => p.chave))

interface Usuario {
  id: number
  nome: string
  email: string
  tipo: string
  perfilId?: number | null
  perfilNome?: string | null
}

interface Perfil {
  id: number
  nome: string
  descricao: string | null
  cor: string | null
  sistema: boolean
  permissoes: Record<string, boolean>
  _count?: { usuarios: number }
}

interface UserData {
  nome: string
  email?: string
  tipo?: string
}

export default function AdministratorPage() {
  const router = useRouter()
  const { pode, carregando: isAdminLoading } = usePermissoes()
  const isAdmin = pode('usuarios.gerenciar')

  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [perfis, setPerfis] = useState<Perfil[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [user, setUser] = useState<UserData>({ nome: "Usuário" })

  // Estados para dados do HeaderBar
  const [projetos, setProjetos] = useState<any[]>([])
  const [processos, setProcessos] = useState<any[]>([])
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

  // Estados para permissões no modal
  const [selectedPerfilId, setSelectedPerfilId] = useState<number | null>(null)
  const [permissoesEfetivas, setPermissoesEfetivas] = useState<Record<string, boolean>>({})
  const [permissoesCustom, setPermissoesCustom] = useState<Record<string, boolean>>({})
  const [showPermissoes, setShowPermissoes] = useState(false)
  const [expandedModulos, setExpandedModulos] = useState<string[]>([])

  // Estados para modal de confirmação de exclusão
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [userToDelete, setUserToDelete] = useState<Usuario | null>(null)

  const handleLogout = () => {
    localStorage.removeItem("authToken")
    localStorage.removeItem("user")
    router.push("/login")
  }

  // Buscar perfis disponíveis
  const fetchPerfis = useCallback(async () => {
    try {
      const token = localStorage.getItem("authToken")
      const response = await fetch("/api/perfis", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (response.ok) {
        const data = await response.json()
        setPerfis(data.perfis || [])
      }
    } catch (error) {
      console.error("Erro ao buscar perfis:", error)
    }
  }, [])

  useEffect(() => {
    if (typeof window !== "undefined") {
      const storedUser = localStorage.getItem("user")
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
    fetchPerfis()
  }, [isAdmin, isAdminLoading, router, fetchPerfis])

  const fetchHeaderData = async () => {
    try {
      const [projetosRes, processosRes, arvoresRes] = await Promise.all([
        fetch("/api/projetos"),
        fetch("/api/processos"),
        fetch("/api/arvore"),
      ])

      if (projetosRes.ok) {
        const projetosData = await projetosRes.json()
        setProjetos(projetosData.projetos || [])
      } else {
        setProjetos([])
      }

      if (processosRes.ok) {
        const processosData = await processosRes.json()
        setProcessos(processosData.processos || [])
      } else {
        setProcessos([])
      }

      if (arvoresRes.ok) {
        const arvoresData = await arvoresRes.json()
        setArvores(Array.isArray(arvoresData) ? arvoresData : [])
      } else {
        setArvores([])
      }
    } catch (error) {
      console.error("Erro ao buscar dados:", error)
      setProjetos([])
      setProcessos([])
      setArvores([])
    }
  }

  // Carregar usuários
  const loadUsers = async () => {
    try {
      setIsLoading(true)
      setError("")

      const token = localStorage.getItem("authToken")
      if (!token) {
        setUsuarios([])
        return
      }

      const users = await getUsers(searchTerm)
      const validUsers = users.filter((u): u is Usuario => u.id !== undefined) as Usuario[]
      setUsuarios(validUsers)
    } catch (err: any) {
      if (err.message?.includes("autenticado") || err.message?.includes("401")) {
        setUsuarios([])
      } else {
        setError(err.message || "Erro ao carregar usuários")
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    const token = localStorage.getItem("authToken")
    if (isAdmin && token) {
      loadUsers()
    }
  }, [isAdmin])

  useEffect(() => {
    const timer = setTimeout(() => {
      const token = localStorage.getItem("authToken")
      if (!isLoading && isAdmin && token) {
        loadUsers()
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [searchTerm])

  // ========================================
  // LÓGICA DE PERMISSÕES
  // ========================================

  // Quando muda o perfil selecionado, recalcular permissões efetivas
  useEffect(() => {
    const perfil = perfis.find((p) => p.id === selectedPerfilId)
    const perfilPerms = perfil?.permissoes || {}

    // Começar com tudo false
    const resultado: Record<string, boolean> = {}
    for (const chave of TODAS_CHAVES) {
      resultado[chave] = false
    }

    // Aplicar permissões do perfil
    for (const [key, value] of Object.entries(perfilPerms)) {
      if (key in resultado) {
        resultado[key] = !!value
      }
    }

    // Aplicar overrides custom
    for (const [key, value] of Object.entries(permissoesCustom)) {
      if (key in resultado) {
        resultado[key] = !!value
      }
    }

    // Se tipo é admin, tudo true
    if (formData.tipo === "admin") {
      for (const chave of TODAS_CHAVES) {
        resultado[chave] = true
      }
    }

    setPermissoesEfetivas(resultado)
  }, [selectedPerfilId, permissoesCustom, perfis, formData.tipo])

  // Toggle de uma permissão individual (cria override)
  const togglePermissao = (chave: string) => {
    if (formData.tipo === "admin") return // Admin não pode alterar

    const perfil = perfis.find((p) => p.id === selectedPerfilId)
    const valorPerfil = !!(perfil?.permissoes as Record<string, boolean>)?.[chave]
    const valorAtual = permissoesEfetivas[chave]
    const novoValor = !valorAtual

    // Se o novo valor é igual ao do perfil, remover o override
    if (novoValor === valorPerfil) {
      const novoCustom = { ...permissoesCustom }
      delete novoCustom[chave]
      setPermissoesCustom(novoCustom)
    } else {
      // Criar override
      setPermissoesCustom({ ...permissoesCustom, [chave]: novoValor })
    }
  }

  // Verificar se uma permissão tem override
  const temOverride = (chave: string): boolean => {
    return chave in permissoesCustom
  }

  // Resetar todas as customizações
  const resetarCustom = () => {
    setPermissoesCustom({})
  }

  // Toggle módulo inteiro
  const toggleModulo = (modulo: typeof MODULOS_PERMISSOES[0]) => {
    if (formData.tipo === "admin") return

    const todasAtivas = modulo.permissoes.every((p) => permissoesEfetivas[p.chave])
    const novoValor = !todasAtivas

    const novoCustom = { ...permissoesCustom }
    for (const perm of modulo.permissoes) {
      const perfil = perfis.find((p) => p.id === selectedPerfilId)
      const valorPerfil = !!(perfil?.permissoes as Record<string, boolean>)?.[perm.chave]

      if (novoValor === valorPerfil) {
        delete novoCustom[perm.chave]
      } else {
        novoCustom[perm.chave] = novoValor
      }
    }
    setPermissoesCustom(novoCustom)
  }

  // Expand/collapse módulo
  const toggleExpandModulo = (modulo: string) => {
    setExpandedModulos((prev) =>
      prev.includes(modulo) ? prev.filter((m) => m !== modulo) : [...prev, modulo]
    )
  }

  // ========================================
  // HANDLERS DE MODAL
  // ========================================

  const handleCreate = () => {
    setIsEditing(false)
    setCurrentUser(null)
    setFormData({ nome: "", email: "", senha: "", tipo: "" })
    setSelectedPerfilId(null)
    setPermissoesCustom({})
    setShowPermissoes(false)
    setExpandedModulos([])
    setIsDialogOpen(true)
    setError("")
    setSuccess("")
  }

  const handleEdit = async (usuario: Usuario) => {
    setIsEditing(true)
    setCurrentUser(usuario)
    setFormData({
      nome: usuario.nome,
      email: usuario.email,
      senha: "",
      tipo: usuario.tipo,
    })
    setShowPermissoes(false)
    setExpandedModulos([])
    setError("")
    setSuccess("")

    // Buscar permissões atuais do usuário
    try {
      const token = localStorage.getItem("authToken")
      const response = await fetch(`/api/usuarios/${usuario.id}/permissoes`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (response.ok) {
        const data = await response.json()
        setSelectedPerfilId(data.usuario.perfilId || null)
        setPermissoesCustom(data.permissoesCustom || {})
      } else {
        setSelectedPerfilId(null)
        setPermissoesCustom({})
      }
    } catch {
      setSelectedPerfilId(null)
      setPermissoesCustom({})
    }

    setIsDialogOpen(true)
  }

  const handleDeleteClick = (usuario: Usuario) => {
    setUserToDelete(usuario)
    setIsDeleteDialogOpen(true)
    setError("")
    setSuccess("")
  }

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSuccess("")

    if (!formData.nome || !formData.email) {
      setError("Preencha todos os campos obrigatórios")
      return
    }

    if (!formData.tipo) {
      setError("Selecione um perfil de permissões")
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

        // Salvar permissões (sempre, inclusive admin para manter perfilId correto)
        const token = localStorage.getItem("authToken")
        const temCustom = Object.keys(permissoesCustom).length > 0
        await fetch(`/api/usuarios/${currentUser.id}/permissoes`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            perfilId: selectedPerfilId,
            permissoesCustom: formData.tipo === "admin" ? null : (temCustom ? permissoesCustom : null),
          }),
        })

        setSuccess("Usuário atualizado com sucesso!")
      } else {
        await createUser({
          nome: formData.nome,
          email: formData.email,
          senha: formData.senha,
          tipo: formData.tipo,
        })

        // TODO: Se quiser já atribuir perfil na criação,
        // precisa buscar o ID do novo usuário e chamar a rota de permissões
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

  // ========================================
  // BADGES E UI HELPERS
  // ========================================

  const getBadgeVariant = (tipo: string): "default" | "secondary" | "outline" => {
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

  const getPerfilBadge = (usuario: Usuario) => {
    if (usuario.tipo === "admin") return null
    if (!usuario.perfilNome) return null

    const perfil = perfis.find((p) => p.nome === usuario.perfilNome)
    return (
      <span
        className="text-[10px] font-medium px-1.5 py-0.5 rounded-full ml-2"
        style={{
          backgroundColor: `${perfil?.cor || "#6B7280"}20`,
          color: perfil?.cor || "#6B7280",
        }}
      >
        {usuario.perfilNome}
      </span>
    )
  }

  // Contar overrides
  const totalOverrides = Object.keys(permissoesCustom).length

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
    <div className="relative min-h-screen text-white overflow-hidden">
      {/* BACKGROUND FIXO */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />

      {/* HEADER */}
      <HeaderBar
        title="Gerenciar Usuários"
        subtitle="Crie e gerencie usuários do sistema"
        userName={user.nome}
        userRole="Administrador"
        userEmail={user.email || ""}
        projetos={projetos}
        processos={processos}
        arvores={arvores}
        onLogout={handleLogout}
      />

      {/* CONTEÚDO COM OVERLAY */}
      <div className="min-h-screen relative">
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />

        <main className="relative px-6 py-8 max-w-7xl mx-auto space-y-6">
          {/* Ações do topo */}
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-end">
            {pode('usuarios.criar') && <Button onClick={handleCreate} className="gap-2 bg-blue-600 hover:bg-blue-700 text-white">
              <UserPlus className="h-4 w-4" />
              Novo Usuário
            </Button>}
          </div>

          {/* Mensagens de feedback */}
          {error && (
            <Alert className="bg-red-500/20 border-red-500/50 text-white">
              <AlertDescription className="text-white">{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert className="border-green-500/50 bg-green-500/20 text-white">
              <AlertDescription className="text-white">{success}</AlertDescription>
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
                <div className="text-center py-8 text-white/50">Nenhum usuário encontrado</div>
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
                          <td className="py-3 px-4 text-white">
                            {usuario.nome}
                            {getPerfilBadge(usuario)}
                          </td>
                          <td className="py-3 px-4 text-white/70">{usuario.email}</td>
                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                              usuario.tipo === 'admin' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' :
                              usuario.tipo === 'gerente' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' :
                              usuario.tipo === 'estagiario' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                              'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            }`}>
                              {getBadgeIcon(usuario.tipo)}
                              {userTypeLabels[usuario.tipo as UserType]}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex justify-end gap-2">
                              {pode('usuarios.editar') && <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleEdit(usuario)}
                                title="Editar"
                                className="text-white/70 hover:text-white hover:bg-white/10"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>}
                              {pode('usuarios.excluir') && usuario.tipo !== UserType.ADMIN && (
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

        {/* ========================================
            MODAL DE CRIAR/EDITAR COM PERMISSÕES
            ======================================== */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="bg-white max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-gray-900">
                {isEditing ? "Editar Usuário" : "Novo Usuário"}
              </DialogTitle>
              <DialogDescription>
                {isEditing
                  ? "Atualize as informações e permissões do usuário"
                  : "Preencha os dados para criar um novo usuário"}
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Campos básicos */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="nome" className="text-gray-700">
                    Nome *
                  </Label>
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
                  <Label htmlFor="email" className="text-gray-700">
                    Email *
                  </Label>
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
              </div>

              <div className="space-y-2">
                <Label htmlFor="senha" className="text-gray-700">
                  Senha {!isEditing && "*"} {isEditing && "(em branco = manter)"}
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

              {/* ========================================
                  SEÇÃO DE PERFIL E PERMISSÕES
                  ======================================== */}
                  <div className="border-t border-gray-200 pt-4 space-y-4">
                  {/* Seleção de perfil */}
                  <div className="space-y-2">
                    <Label className="text-gray-700 flex items-center gap-2">
                      <Shield className="h-4 w-4" />
                      Perfil de Permissões
                    </Label>
                    <select
                      value={selectedPerfilId || ""}
                      onChange={(e) => {
                        const val = e.target.value ? parseInt(e.target.value) : null
                        setSelectedPerfilId(val)
                        setPermissoesCustom({})
                        // Setar tipo automaticamente baseado no perfil
                        const perfilSelecionado = perfis.find(p => p.id === val)
                        if (perfilSelecionado) {
                          const tipoMap: Record<string, string> = {
                            'Administrador': 'admin',
                            'Gerente': 'gerente',
                            'Assistente': 'assistente',
                            'Estagiário': 'estagiario',
                          }
                          setFormData(prev => ({ ...prev, tipo: tipoMap[perfilSelecionado.nome] || 'assistente' }))
                        } else {
                          setFormData(prev => ({ ...prev, tipo: '' }))
                        }
                      }}
                      className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 focus:outline-none"
                    >
                      <option value="">Sem perfil (todas permissões desligadas)</option>
                      {perfis.map((perfil) => (
                        <option key={perfil.id} value={perfil.id}>
                          {perfil.nome}
                          {perfil.descricao ? ` — ${perfil.descricao}` : ""}
                        </option>
                      ))}
                    </select>

                    {/* Descrição do perfil selecionado */}
                    {selectedPerfilId && (
                      <p className="text-xs text-gray-500">
                        {perfis.find((p) => p.id === selectedPerfilId)?.descricao}
                      </p>
                    )}
                  </div>

                  {/* Botão para expandir permissões detalhadas */}
                  <button
                    type="button"
                    onClick={() => setShowPermissoes(!showPermissoes)}
                    className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
                  >
                    <Lock className="h-4 w-4" />
                    {showPermissoes ? "Ocultar permissões detalhadas" : "Personalizar permissões"}
                    {showPermissoes ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                    {totalOverrides > 0 && (
                      <span className="bg-amber-100 text-amber-700 text-[10px] font-medium px-1.5 py-0.5 rounded-full">
                        {totalOverrides} {totalOverrides === 1 ? "ajuste" : "ajustes"}
                      </span>
                    )}
                  </button>

                  {/* Painel de permissões detalhadas */}
                  {showPermissoes && (
                    <div className="space-y-3 bg-gray-50 rounded-lg p-4 border border-gray-200">
                      {/* Header com reset */}
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-500">
                          Toggle individual sobrescreve o perfil. Indicador{" "}
                          <span className="inline-block w-2 h-2 rounded-full bg-amber-400 mx-0.5" />{" "}
                          = personalizado
                        </p>
                        {totalOverrides > 0 && (
                          <button
                            type="button"
                            onClick={resetarCustom}
                            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                          >
                            <RotateCcw className="h-3 w-3" />
                            Resetar ajustes
                          </button>
                        )}
                      </div>

                      {/* Módulos */}
                      {MODULOS_PERMISSOES.map((modulo) => {
                        const expanded = expandedModulos.includes(modulo.modulo)
                        const todasAtivas = modulo.permissoes.every(
                          (p) => permissoesEfetivas[p.chave]
                        )
                        const algAtiva = modulo.permissoes.some(
                          (p) => permissoesEfetivas[p.chave]
                        )
                        const temOverrides = modulo.permissoes.some((p) =>
                          temOverride(p.chave)
                        )

                        return (
                          <div
                            key={modulo.modulo}
                            className="bg-white rounded-lg border border-gray-200 overflow-hidden"
                          >
                            {/* Header do módulo */}
                            <div
                              className="flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-gray-50"
                              onClick={() => toggleExpandModulo(modulo.modulo)}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-sm">{modulo.icone}</span>
                                <span className="text-sm font-medium text-gray-800">
                                  {modulo.modulo}
                                </span>
                                {temOverrides && (
                                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={todasAtivas}
                                  onCheckedChange={() => toggleModulo(modulo)}
                                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                  className="scale-75"
                                />
                                {expanded ? (
                                  <ChevronUp className="h-4 w-4 text-gray-400" />
                                ) : (
                                  <ChevronDown className="h-4 w-4 text-gray-400" />
                                )}
                              </div>
                            </div>

                            {/* Permissões individuais */}
                            {expanded && (
                              <div className="border-t border-gray-100 px-3 py-2 space-y-1">
                                {modulo.permissoes.map((perm) => {
                                  const ativa = !!permissoesEfetivas[perm.chave]
                                  const override = temOverride(perm.chave)

                                  return (
                                    <div
                                      key={perm.chave}
                                      className={`flex items-center justify-between py-1.5 px-2 rounded ${
                                        override ? "bg-amber-50" : ""
                                      }`}
                                    >
                                      <div className="flex items-center gap-2">
                                        {override && (
                                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                                        )}
                                        <span
                                          className={`text-xs ${
                                            ativa ? "text-gray-700" : "text-gray-400"
                                          }`}
                                        >
                                          {perm.label}
                                        </span>
                                      </div>
                                      <Switch
                                        checked={ativa}
                                        onCheckedChange={() => togglePermissao(perm.chave)}
                                        className="scale-75"
                                      />
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

              {/* Aviso para admin */}
              {formData.tipo === "admin" && (
                <div className="border-t border-gray-200 pt-4">
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200">
                    <Shield className="h-4 w-4 text-blue-600 flex-shrink-0" />
                    <p className="text-xs text-blue-700">
                      Administradores têm acesso total ao sistema. Não é necessário configurar
                      permissões.
                    </p>
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsDialogOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
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
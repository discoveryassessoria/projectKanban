// ESTE ARQUIVO VAI EM: src/app/settings/page.tsx

"use client"

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/src/contexts/toast-context'
import { getStoredUser, logout } from '@/lib/auth'
import { User, LogOut, Trash2, Shield, BadgeCheck, Mail, Calendar, Clock, Briefcase, CheckCircle2, TreeDeciduous, FileText } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { HeaderBar } from '@/src/components/header-bar'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface UserData {
  id: string | number
  nome: string
  email: string
  tipo?: string
  createdAt?: string
}

export default function SettingsPage() {
  const { showToast } = useToast()
  const router = useRouter()
  const [user, setUser] = useState<UserData | null>(getStoredUser())
  const [mounted, setMounted] = useState(false)

  // Estados para dados do HeaderBar
  const [projetos, setProjetos] = useState<any[]>([])
  const [processos, setProcessos] = useState<any[]>([])
  const [arvores, setArvores] = useState<any[]>([])

  // Estados para estatísticas
  const [stats, setStats] = useState({
    processosAtivos: 0,
    tarefasConcluidas: 0,
    arvoresGenealogicas: 0,
    documentos: 0
  })
  // Estado para modal de exclusão
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    setMounted(true)
    fetchHeaderData()
  }, [])

  const fetchHeaderData = async () => {
    try {
      const [projetosRes, processosRes, arvoresRes] = await Promise.all([
        fetch("/api/projetos"),
        fetch("/api/processos"),
        fetch("/api/arvore")
      ])

      let processosCount = 0
      let arvoresCount = 0

      if (projetosRes.ok) {
        const projetosData = await projetosRes.json()
        setProjetos(projetosData.projetos || [])
      }

      if (processosRes.ok) {
        const processosData = await processosRes.json()
        const processosList = processosData.processos || []
        setProcessos(processosList)
        processosCount = processosList.length
      }

      if (arvoresRes.ok) {
        const arvoresData = await arvoresRes.json()
        const arvoresList = Array.isArray(arvoresData) ? arvoresData : []
        setArvores(arvoresList)
        arvoresCount = arvoresList.length
      }

      // Buscar estatísticas adicionais
      let tarefasConcluidas = 0
      let documentosCount = 0

      try {
        const atividadesRes = await fetch("/api/activities")
        if (atividadesRes.ok) {
          const atividadesData = await atividadesRes.json()
          const atividades = Array.isArray(atividadesData) ? atividadesData : []
          tarefasConcluidas = atividades.filter((a: any) => a.concluida).length
        }
      } catch (e) {
        console.warn("Não foi possível buscar atividades")
      }

      try {
        const docsRes = await fetch("/api/documentos")
        if (docsRes.ok) {
          const docsData = await docsRes.json()
          documentosCount = Array.isArray(docsData) ? docsData.length : (docsData.documentos?.length || 0)
        }
      } catch (e) {
        console.warn("Não foi possível buscar documentos")
      }

      setStats({
        processosAtivos: processosCount,
        tarefasConcluidas,
        arvoresGenealogicas: arvoresCount,
        documentos: documentosCount
      })

    } catch (error) {
      console.error("Erro ao buscar dados:", error)
    }
  }

  const handleLogout = () => {
    logout()
    showToast('Logout realizado com sucesso!', 'success')
    router.push('/login')
  }

  const handleLogoutWithConfirm = () => {
    if (window.confirm('Tem certeza que deseja sair da sua conta?')) {
      handleLogout()
    }
  }

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== 'EXCLUIR') {
      showToast('Digite EXCLUIR para confirmar', 'error')
      return
    }

    setIsDeleting(true)

    try {
      const token = localStorage.getItem('authToken')
      const response = await fetch(`/api/usuarios/${user?.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })

      if (response.ok) {
        showToast('Conta excluída com sucesso', 'success')
        logout()
        router.push('/login')
      } else {
        const data = await response.json()
        showToast(data.error || 'Erro ao excluir conta', 'error')
      }
    } catch (error) {
      showToast('Erro ao excluir conta', 'error')
    } finally {
      setIsDeleting(false)
      setIsDeleteDialogOpen(false)
      setDeleteConfirmation('')
    }
  }

  const getTipoLabel = (tipo?: string) => {
    switch (tipo) {
      case 'admin': return 'Administrador'
      case 'gestor': return 'Gestor'
      case 'usuario': return 'Usuário'
      default: return tipo || 'Usuário'
    }
  }

  const getTipoIcon = (tipo?: string) => {
    switch (tipo) {
      case 'admin': return <Shield className="h-5 w-5 text-white/50" />
      default: return <BadgeCheck className="h-5 w-5 text-white/50" />
    }
  }

  if (!mounted) {
    return (
      <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
        <div className="min-h-screen bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="text-center">
            <User className="h-12 w-12 mx-auto mb-4 text-white animate-pulse" />
            <p className="text-lg text-white">Carregando...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
      {/* BACKGROUND FIXO */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
      
      {/* HEADER */}
      <HeaderBar
        title="Configurações"
        subtitle="Visualize suas informações e gerencie sua conta"
        userName={user?.nome || 'Usuário'}
        userRole={user?.tipo === 'admin' ? 'Administrador' : user?.tipo || 'Usuário'}
        userEmail={user?.email || ''}
        projetos={projetos}
        processos={processos}
        arvores={arvores}
        onLogout={handleLogout}
      />

      {/* CONTEÚDO COM OVERLAY */}
      <div className="min-h-screen relative">
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />
        <main className="relative px-6 py-8 max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* COLUNA ESQUERDA - Informações */}
            <div className="space-y-6">
              {/* Meu Perfil */}
              <Card className="bg-white/5 backdrop-blur-xl border border-white/10">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white">
                    <User className="h-5 w-5" />
                    Meu Perfil
                  </CardTitle>
                  <CardDescription className="text-white/60">
                    Suas informações pessoais
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                    <User className="h-5 w-5 text-white/50" />
                    <div>
                      <p className="text-xs text-white/50 uppercase tracking-wide">Nome</p>
                      <p className="text-white font-medium">{user?.nome}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                    <Mail className="h-5 w-5 text-white/50" />
                    <div>
                      <p className="text-xs text-white/50 uppercase tracking-wide">Email</p>
                      <p className="text-white font-medium">{user?.email}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                    {getTipoIcon(user?.tipo)}
                    <div>
                      <p className="text-xs text-white/50 uppercase tracking-wide">Tipo de conta</p>
                      <p className="text-white font-medium">{getTipoLabel(user?.tipo)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Estatísticas */}
              <Card className="bg-white/5 backdrop-blur-xl border border-white/10">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white">
                    <CheckCircle2 className="h-5 w-5" />
                    Estatísticas
                  </CardTitle>
                  <CardDescription className="text-white/60">
                    Seu resumo de atividades no sistema
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                      <div className="p-2 rounded-lg bg-blue-500/20">
                        <Briefcase className="h-4 w-4 text-blue-400" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-white">{stats.processosAtivos}</p>
                        <p className="text-xs text-white/50">Processos</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                      <div className="p-2 rounded-lg bg-green-500/20">
                        <CheckCircle2 className="h-4 w-4 text-green-400" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-white">{stats.tarefasConcluidas}</p>
                        <p className="text-xs text-white/50">Tarefas concluídas</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                      <div className="p-2 rounded-lg bg-purple-500/20">
                        <TreeDeciduous className="h-4 w-4 text-purple-400" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-white">{stats.arvoresGenealogicas}</p>
                        <p className="text-xs text-white/50">Árvores</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                      <div className="p-2 rounded-lg bg-amber-500/20">
                        <FileText className="h-4 w-4 text-amber-400" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-white">{stats.documentos}</p>
                        <p className="text-xs text-white/50">Documentos</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* COLUNA DIREITA - Ações */}
            <div className="space-y-6">
              {/* Sessão */}
              <Card className="bg-white/5 backdrop-blur-xl border border-white/10">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white">
                    <LogOut className="h-5 w-5" />
                    Sessão
                  </CardTitle>
                  <CardDescription className="text-white/60">
                    Gerencie sua sessão atual
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between p-4 rounded-lg bg-white/5 border border-white/10">
                    <div>
                      <h3 className="font-medium text-white">Sair da conta</h3>
                      <p className="text-sm text-white/60">
                        Você será redirecionado para a página de login
                      </p>
                    </div>
                    <Button 
                      onClick={handleLogoutWithConfirm}
                      variant="outline"
                      className="flex items-center gap-2 border-white/30 bg-white/10 text-white hover:bg-white/20"
                    >
                      <LogOut className="h-4 w-4" />
                      Logout
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Excluir Conta */}
              <Card className="bg-red-500/10 backdrop-blur-xl border border-red-500/30">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-red-400">
                    <Trash2 className="h-5 w-5" />
                    Excluir Conta
                  </CardTitle>
                  <CardDescription className="text-white/60">
                    Ação permanente e irreversível
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-white/60">
                      Todos os seus dados serão perdidos permanentemente
                    </p>
                    <Button 
                      onClick={() => setIsDeleteDialogOpen(true)}
                      variant="destructive"
                      className="flex items-center gap-2"
                    >
                      <Trash2 className="h-4 w-4" />
                      Excluir
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

          </div>
        </main>
      </div>

      {/* Modal de Confirmação de Exclusão */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent className="bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-600 flex items-center gap-2">
              <Trash2 className="h-5 w-5" />
              Excluir Conta Permanentemente
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                Tem certeza que deseja excluir sua conta? Esta ação é <strong>irreversível</strong> e todos os seus dados serão perdidos.
              </p>
              <div className="space-y-2">
                <Label htmlFor="confirm" className="text-gray-700">
                  Digite <strong>EXCLUIR</strong> para confirmar:
                </Label>
                <Input
                  id="confirm"
                  value={deleteConfirmation}
                  onChange={(e) => setDeleteConfirmation(e.target.value.toUpperCase())}
                  placeholder="EXCLUIR"
                  className="bg-white border-gray-300"
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel 
              onClick={() => setDeleteConfirmation('')}
              disabled={isDeleting}
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAccount}
              disabled={isDeleting || deleteConfirmation !== 'EXCLUIR'}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isDeleting ? 'Excluindo...' : 'Excluir minha conta'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
// ESTE ARQUIVO VAI EM: src/app/settings/page.tsx

"use client"

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/src/contexts/toast-context'
import { getStoredUser, logout } from '@/lib/auth'
import { User, LogOut, Trash2, Shield, BadgeCheck, Mail, Lock, CheckCircle, XCircle } from 'lucide-react'
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

// ========================================
// MAPA DE PERMISSÕES PARA EXIBIÇÃO
// ========================================
const MODULOS_DISPLAY = [
  {
    modulo: 'Tarefas',
    icone: '✅',
    permissoes: {
      'tarefas.ver': 'Ver tarefas',
      'tarefas.criar': 'Criar tarefas',
      'tarefas.editar': 'Editar tarefas',
      'tarefas.excluir': 'Excluir tarefas',
      'tarefas.iniciar_concluir': 'Iniciar e concluir tarefas',
    },
  },
  {
    modulo: 'Processos',
    icone: '📋',
    permissoes: {
      'processos.ver': 'Ver processos',
      'processos.criar': 'Criar processos',
      'processos.editar': 'Editar processos',
      'processos.editar_status': 'Alterar status/etapa',
      'processos.excluir': 'Excluir processos',
    },
  },
  {
    modulo: 'Clientes / Cadastros',
    icone: '👤',
    permissoes: {
      'clientes.ver': 'Ver contratantes e requerentes',
      'clientes.criar': 'Cadastrar clientes',
      'clientes.editar': 'Editar dados cadastrais',
      'clientes.excluir': 'Excluir clientes',
    },
  },
  {
    modulo: 'Financeiro',
    icone: '💰',
    permissoes: {
      'financeiro.ver': 'Ver faturas e pagamentos',
      'financeiro.criar': 'Criar faturas',
      'financeiro.editar': 'Editar faturas',
      'financeiro.dashboard': 'Ver dashboard financeiro',
      'financeiro.contas_pagar': 'Gerenciar contas a pagar',
    },
  },
  {
    modulo: 'Mensagens',
    icone: '💬',
    permissoes: {
      'mensagens.ver': 'Ver mensagens',
      'mensagens.responder': 'Responder mensagens',
    },
  },
  {
    modulo: 'Eventos',
    icone: '📅',
    permissoes: {
      'eventos.ver': 'Ver eventos',
      'eventos.criar': 'Criar eventos',
      'eventos.editar': 'Editar eventos',
      'eventos.excluir': 'Excluir eventos',
    },
  },
  {
    modulo: 'Árvore Genealógica',
    icone: '🌳',
    permissoes: {
      'arvore.ver': 'Ver árvore',
      'arvore.editar': 'Editar árvore',
    },
  },
  {
    modulo: 'Administração',
    icone: '🛡️',
    permissoes: {
      'usuarios.gerenciar': 'Gerenciar usuários',
    },
  },
]

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

  // Permissões do usuário
  const [permissoes, setPermissoes] = useState<Record<string, boolean>>({})
  const [perfilNome, setPerfilNome] = useState<string | null>(null)
  const [loadingPermissoes, setLoadingPermissoes] = useState(true)

  // Estado para modal de exclusão
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  const fetchPermissoes = useCallback(async () => {
    try {
      setLoadingPermissoes(true)
      const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
      const response = await fetch('/api/me/permissoes', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      })
      if (response.ok) {
        const data = await response.json()
        setPermissoes(data.permissoes || {})
        setPerfilNome(data.perfilNome || null)
      }
    } catch (error) {
      console.error('Erro ao buscar permissões:', error)
    } finally {
      setLoadingPermissoes(false)
    }
  }, [])

  useEffect(() => {
    setMounted(true)
    fetchHeaderData()
    fetchPermissoes()
  }, [fetchPermissoes])

  const fetchHeaderData = async () => {
    try {
      const [projetosRes, processosRes, arvoresRes] = await Promise.all([
        fetch("/api/projetos"),
        fetch("/api/processos"),
        fetch("/api/arvore")
      ])

      if (projetosRes.ok) {
        const projetosData = await projetosRes.json()
        setProjetos(projetosData.projetos || [])
      }

      if (processosRes.ok) {
        const processosData = await processosRes.json()
        setProcessos(processosData.processos || [])
      }

      if (arvoresRes.ok) {
        const arvoresData = await arvoresRes.json()
        setArvores(Array.isArray(arvoresData) ? arvoresData : [])
      }
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
      case 'gerente': return 'Gerente'
      case 'assistente': return 'Assistente'
      case 'estagiario': return 'Estagiário'
      default: return tipo || 'Usuário'
    }
  }

  const getTipoIcon = (tipo?: string) => {
    switch (tipo) {
      case 'admin': return <Shield className="h-5 w-5 text-white/50" />
      default: return <BadgeCheck className="h-5 w-5 text-white/50" />
    }
  }

  // Contar permissões
  const totalPermissoes = Object.keys(permissoes).length
  const permissoesAtivas = Object.values(permissoes).filter(v => v).length

  if (!mounted) {
    return (
      <div className="relative min-h-screen text-white overflow-hidden">
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
    <div className="relative min-h-screen text-white overflow-hidden">
      {/* BACKGROUND FIXO */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
      
      {/* HEADER */}
      <HeaderBar
        title="Configurações"
        subtitle="Visualize suas informações e gerencie sua conta"
        userName={user?.nome || 'Usuário'}
        userRole={getTipoLabel(user?.tipo)}
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

                  {perfilNome && (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                      <Shield className="h-5 w-5 text-white/50" />
                      <div>
                        <p className="text-xs text-white/50 uppercase tracking-wide">Perfil de permissões</p>
                        <p className="text-white font-medium">{perfilNome}</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

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
                  <div className="flex items-center justify-between gap-4 p-4 rounded-lg bg-white/5 border border-white/10">
                    <div className="min-w-0">
                      <h3 className="font-medium text-white">Sair da conta</h3>
                      <p className="text-sm text-white/60">
                        Você será redirecionado para a página de login
                      </p>
                    </div>
                    <Button 
                      onClick={handleLogoutWithConfirm}
                      variant="outline"
                      className="flex-shrink-0 flex items-center gap-2 border-white/30 bg-white/10 text-white hover:bg-white/20"
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

            {/* COLUNA DIREITA - Permissões */}
            <div className="flex flex-col">
              <Card className="bg-white/5 backdrop-blur-xl border border-white/10 flex-1">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-white">
                    <Lock className="h-5 w-5" />
                    Minhas Permissões
                  </CardTitle>
                  <CardDescription className="text-white/60">
                    {loadingPermissoes 
                      ? 'Carregando...' 
                      : `${permissoesAtivas} de ${totalPermissoes} permissões ativas`
                    }
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {loadingPermissoes ? (
                    <div className="flex justify-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {MODULOS_DISPLAY.map((modulo) => {
                        const perms = Object.entries(modulo.permissoes)
                        const ativas = perms.filter(([key]) => permissoes[key])
                        const todasAtivas = ativas.length === perms.length
                        const nenhumaAtiva = ativas.length === 0

                        return (
                          <div key={modulo.modulo} className="rounded-lg bg-white/5 border border-white/10 overflow-hidden">
                            <div className="flex items-center justify-between px-3 py-2.5 bg-white/5">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm">{modulo.icone}</span>
                                <span className="text-xs font-medium text-white">{modulo.modulo}</span>
                              </div>
                              <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${
                                todasAtivas 
                                  ? 'bg-green-500/20 text-green-400' 
                                  : nenhumaAtiva 
                                    ? 'bg-red-500/20 text-red-400' 
                                    : 'bg-amber-500/20 text-amber-400'
                              }`}>
                                {todasAtivas ? 'Total' : nenhumaAtiva ? 'Sem acesso' : `${ativas.length}/${perms.length}`}
                              </span>
                            </div>
                            <div className="px-3 py-2.5 space-y-1.5">
                              {perms.map(([key, label]) => {
                                const ativa = !!permissoes[key]
                                return (
                                  <div key={key} className="flex items-center gap-1.5 py-0.5">
                                    {ativa ? (
                                      <CheckCircle className="h-3 w-3 text-green-400 flex-shrink-0" />
                                    ) : (
                                      <XCircle className="h-3 w-3 text-red-400/60 flex-shrink-0" />
                                    )}
                                    <span className={`text-[10px] leading-tight ${ativa ? 'text-white/80' : 'text-white/40'}`}>
                                      {label}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
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
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-muted-foreground">
                <span className="block">
                  Tem certeza que deseja excluir sua conta? Esta ação é <strong>irreversível</strong> e todos os seus dados serão perdidos.
                </span>
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
"use client"

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTheme } from '@/src/hooks/use-theme'
import { useToast } from '@/src/contexts/toast-context'
import { getStoredUser, logout } from '@/lib/auth'
import { Moon, Sun, User, Lock, Mail, LogOut, Settings } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { HeaderBar } from '@/src/components/header-bar'

interface UserData {
  id: string | number
  nome: string
  email: string
  tipo?: string
}

export default function SettingsPage() {
  const { theme, toggleTheme } = useTheme()
  const { showToast } = useToast()
  const router = useRouter()
  const [user, setUser] = useState<UserData | null>(getStoredUser())
  const [mounted, setMounted] = useState(false)
  
  // Estados para dados do HeaderBar
  const [projetos, setProjetos] = useState<any[]>([])
  const [atividades, setAtividades] = useState<any[]>([])
  const [arvores, setArvores] = useState<any[]>([])
  
  const [emailForm, setEmailForm] = useState({
    newEmail: '',
    loading: false
  })

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    loading: false
  })
  
  useEffect(() => {
    setMounted(true)
    fetchHeaderData()
  }, [])

  const fetchHeaderData = async () => {
    try {
      const [projetosRes, atividadesRes, arvoresRes] = await Promise.all([
        fetch("/api/projetos"),
        fetch("/api/activities"),
        fetch("/api/arvore")
      ])

      const projetosData = await projetosRes.json()
      setProjetos(projetosData.projetos || [])

      const atividadesData = await atividadesRes.json()
      setAtividades(Array.isArray(atividadesData) ? atividadesData : [])

      const arvoresData = await arvoresRes.json()
      setArvores(Array.isArray(arvoresData) ? arvoresData : [])
    } catch (error) {
      console.error("Erro ao buscar dados:", error)
    }
  }

  const handleLogout = () => {
    logout()
    showToast('Logout realizado com sucesso!', 'success')
    router.push('/login')
  }
  
  if (!mounted) {
    return (
      <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
        <div className="min-h-screen bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="text-center">
            <Settings className="h-12 w-12 mx-auto mb-4 text-white animate-pulse" />
            <p className="text-lg text-white">Carregando configurações...</p>
          </div>
        </div>
      </div>
    )
  }
  
  const validatePasswordStrength = (password: string) => {
    const minLength = password.length >= 8
    const hasNumber = /\d/.test(password)
    const hasLetter = /[a-zA-Z]/.test(password)
    
    return {
      isStrong: minLength && hasNumber && hasLetter,
      suggestions: [
        !minLength && 'Pelo menos 8 caracteres',
        !hasNumber && 'Pelo menos 1 número',
        !hasLetter && 'Pelo menos 1 letra',
      ].filter(Boolean)
    }
  }
  
  const handleEmailUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    setEmailForm(prev => ({ ...prev, loading: true }))
    
    try {
      const response = await fetch('/api/user/update-email', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          newEmail: emailForm.newEmail,
          userId: user?.id 
        }),
      })

      if (response.ok) {
        const updatedUser = await response.json()
        setUser(updatedUser)
        localStorage.setItem('user', JSON.stringify(updatedUser))
        setEmailForm({ newEmail: '', loading: false })
        showToast('Email atualizado com sucesso!', 'success')
      } else {
        const error = await response.json()
        showToast(error.message || 'Erro ao atualizar email', 'error')
      }
    } catch (error) {
      showToast('Erro ao atualizar email', 'error')
    } finally {
      setEmailForm(prev => ({ ...prev, loading: false }))
    }
  }

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      showToast('As senhas não coincidem', 'error')
      return
    }

    const passwordValidation = validatePasswordStrength(passwordForm.newPassword)
    if (!passwordValidation.isStrong) {
      showToast(`Senha muito fraca. Requisitos: ${passwordValidation.suggestions.join(', ')}`, 'error')
      return
    }

    setPasswordForm(prev => ({ ...prev, loading: true }))
    
    try {
      const response = await fetch('/api/user/update-password', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
          userId: user?.id 
        }),
      })

      if (response.ok) {
        setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '', loading: false })
        showToast('Senha atualizada com sucesso!', 'success')
      } else {
        const error = await response.json()
        showToast(error.message || 'Erro ao atualizar senha', 'error')
      }
    } catch (error) {
      showToast('Erro ao atualizar senha', 'error')
    } finally {
      setPasswordForm(prev => ({ ...prev, loading: false }))
    }
  }

  const handleLogoutWithConfirm = () => {
    if (window.confirm('Tem certeza que deseja sair da sua conta?')) {
      handleLogout()
    }
  }

  return (
    <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
      {/* BACKGROUND FIXO */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />

      {/* HEADER */}
      <HeaderBar
        title="Configurações"
        subtitle="Gerencie suas preferências e informações da conta"
        userName={user?.nome || 'Usuário'}
        userRole={user?.tipo === 'admin' ? 'Administrador' : user?.tipo || 'Usuário'}
        userEmail={user?.email || ''}
        projetos={projetos}
        atividades={atividades}
        arvores={arvores}
        onLogout={handleLogout}
      />

      {/* CONTEÚDO COM OVERLAY */}
      <div className="min-h-screen relative">
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />
        
        <main className="relative px-6 py-8 max-w-4xl mx-auto">
          <Tabs defaultValue="appearance" className="w-full">
            <TabsList className="grid w-full grid-cols-4 bg-white/10 border border-white/20 backdrop-blur-xl">
              <TabsTrigger value="appearance" className="flex items-center gap-2 data-[state=active]:bg-white/20 text-white">
                <Sun className="h-4 w-4" />
                <span className="hidden sm:inline">Aparência</span>
              </TabsTrigger>
              <TabsTrigger value="account" className="flex items-center gap-2 data-[state=active]:bg-white/20 text-white">
                <Mail className="h-4 w-4" />
                <span className="hidden sm:inline">Email</span>
              </TabsTrigger>
              <TabsTrigger value="security" className="flex items-center gap-2 data-[state=active]:bg-white/20 text-white">
                <Lock className="h-4 w-4" />
                <span className="hidden sm:inline">Segurança</span>
              </TabsTrigger>
              <TabsTrigger value="session" className="flex items-center gap-2 data-[state=active]:bg-white/20 text-white">
                <User className="h-4 w-4" />
                <span className="hidden sm:inline">Conta</span>
              </TabsTrigger>
            </TabsList>

            {/* Tema */}
            <TabsContent value="appearance" className="mt-6">
              <Card className="bg-white/95 backdrop-blur-xl border-white/20 shadow-xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-gray-900">
                    {theme === 'light' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                    Tema da Interface
                  </CardTitle>
                  <CardDescription>
                    Escolha entre tema claro ou escuro para personalizar sua experiência
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">Tema atual: {theme === 'light' ? 'Claro' : 'Escuro'}</p>
                      <p className="text-sm text-gray-500">
                        Alterne entre os modos claro e escuro
                      </p>
                    </div>
                    <Button 
                      onClick={toggleTheme}
                      variant="outline" 
                      size="sm"
                      className="flex items-center gap-2"
                    >
                      {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                      {theme === 'light' ? 'Modo Escuro' : 'Modo Claro'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Email */}
            <TabsContent value="account" className="mt-6">
              <Card className="bg-white/95 backdrop-blur-xl border-white/20 shadow-xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-gray-900">
                    <Mail className="h-5 w-5" />
                    Alterar Email
                  </CardTitle>
                  <CardDescription>
                    Atualize seu endereço de email
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label className="text-gray-700">Email Atual</Label>
                    <div className="p-3 bg-gray-100 rounded-lg">
                      <p className="font-medium text-gray-900">{user?.email}</p>
                    </div>
                  </div>

                  <Separator />

                  <form onSubmit={handleEmailUpdate} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="newEmail" className="text-gray-700">Novo Email</Label>
                      <Input
                        id="newEmail"
                        type="email"
                        placeholder="Digite seu novo email"
                        value={emailForm.newEmail}
                        onChange={(e) => setEmailForm(prev => ({ ...prev, newEmail: e.target.value }))}
                        required
                        className="bg-white border-gray-300"
                      />
                    </div>
                    <Button 
                      type="submit" 
                      disabled={emailForm.loading || !emailForm.newEmail}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {emailForm.loading ? 'Atualizando...' : 'Atualizar Email'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Segurança */}
            <TabsContent value="security" className="mt-6">
              <Card className="bg-white/95 backdrop-blur-xl border-white/20 shadow-xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-gray-900">
                    <Lock className="h-5 w-5" />
                    Segurança da Conta
                  </CardTitle>
                  <CardDescription>
                    Altere sua senha para manter sua conta segura
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handlePasswordUpdate} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="currentPassword" className="text-gray-700">Senha Atual</Label>
                      <Input
                        id="currentPassword"
                        type="password"
                        placeholder="Digite sua senha atual"
                        value={passwordForm.currentPassword}
                        onChange={(e) => setPasswordForm(prev => ({ ...prev, currentPassword: e.target.value }))}
                        required
                        className="bg-white border-gray-300"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="newPassword" className="text-gray-700">Nova Senha</Label>
                      <Input
                        id="newPassword"
                        type="password"
                        placeholder="Digite sua nova senha"
                        value={passwordForm.newPassword}
                        onChange={(e) => setPasswordForm(prev => ({ ...prev, newPassword: e.target.value }))}
                        required
                        minLength={8}
                        className="bg-white border-gray-300"
                      />
                      <p className="text-xs text-gray-500">
                        A senha deve ter pelo menos 8 caracteres, incluindo letras e números
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="confirmPassword" className="text-gray-700">Confirmar Nova Senha</Label>
                      <Input
                        id="confirmPassword"
                        type="password"
                        placeholder="Confirme sua nova senha"
                        value={passwordForm.confirmPassword}
                        onChange={(e) => setPasswordForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                        required
                        minLength={8}
                        className="bg-white border-gray-300"
                      />
                    </div>

                    <Button 
                      type="submit" 
                      disabled={
                        passwordForm.loading || 
                        !passwordForm.currentPassword || 
                        !passwordForm.newPassword || 
                        !passwordForm.confirmPassword
                      }
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {passwordForm.loading ? 'Atualizando...' : 'Atualizar Senha'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Conta e Sessão */}
            <TabsContent value="session" className="mt-6">
              <div className="space-y-6">
                {/* Informações da Conta */}
                <Card className="bg-white/95 backdrop-blur-xl border-white/20 shadow-xl">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-gray-900">
                      <User className="h-5 w-5" />
                      Informações da Conta
                    </CardTitle>
                    <CardDescription>
                      Visualize suas informações pessoais
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="p-4 bg-gray-100 rounded-lg space-y-2">
                        <p className="text-gray-900"><span className="font-medium">Nome:</span> {user?.nome}</p>
                        <p className="text-gray-900"><span className="font-medium">Email:</span> {user?.email}</p>
                        <p className="text-gray-900"><span className="font-medium">Tipo:</span> {user?.tipo}</p>
                        <p className="text-gray-900"><span className="font-medium">ID:</span> {user?.id}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Sessão e Logout */}
                <Card className="bg-white/95 backdrop-blur-xl border-white/20 shadow-xl">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-red-600">
                      <LogOut className="h-5 w-5" />
                      Gerenciar Sessão
                    </CardTitle>
                    <CardDescription>
                      Saia da sua conta ou gerencie sua sessão
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                      <h3 className="font-medium text-red-600 mb-2">Sair da Conta</h3>
                      <p className="text-sm text-gray-600 mb-4">
                        Ao fazer logout, você será redirecionado para a página de login e precisará 
                        inserir suas credenciais novamente para acessar o sistema.
                      </p>
                      <Button 
                        onClick={handleLogoutWithConfirm}
                        variant="destructive" 
                        className="flex items-center gap-2"
                      >
                        <LogOut className="h-4 w-4" />
                        Fazer Logout
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  )
}
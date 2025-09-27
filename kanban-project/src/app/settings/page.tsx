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
import { Moon, Sun, User, Lock, Mail, LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function SettingsPage() {
  const { theme, toggleTheme } = useTheme()
  const { showToast } = useToast()
  const router = useRouter()
  const [user, setUser] = useState(getStoredUser())
  const [mounted, setMounted] = useState(false)
  
  // Estados para formulários - DEVEM vir antes de qualquer return condicional
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
  
  // Aguarda a hidratação para evitar erros
  useEffect(() => {
    setMounted(true)
  }, [])
  
  // Se ainda não foi montado, exibe loading
  if (!mounted) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <div className="flex items-center justify-center h-64">
          <div className="text-lg">Carregando configurações...</div>
        </div>
      </div>
    )
  }
  
  // Função para validar força da senha
  const validatePasswordStrength = (password: string) => {
    const minLength = password.length >= 8
    const hasNumber = /\d/.test(password)
    const hasLetter = /[a-zA-Z]/.test(password)
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password)
    
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

    // Validar força da senha
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

  const handleLogout = () => {
    if (window.confirm('Tem certeza que deseja sair da sua conta?')) {
      logout()
      showToast('Logout realizado com sucesso!', 'success')
      router.push('/auth')
    }
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Configurações</h1>
        <p className="text-muted-foreground mt-2">
          Gerencie suas preferências e informações da conta
        </p>
      </div>

      <Tabs defaultValue="appearance" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="appearance" className="flex items-center gap-2">
            <Sun className="h-4 w-4" />
            Aparência
          </TabsTrigger>
          <TabsTrigger value="account" className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Email
          </TabsTrigger>
          <TabsTrigger value="security" className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            Segurança
          </TabsTrigger>
          <TabsTrigger value="session" className="flex items-center gap-2">
            <User className="h-4 w-4" />
            Conta
          </TabsTrigger>
        </TabsList>

        {/* Tema */}
        <TabsContent value="appearance" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
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
                  <p className="font-medium">Tema atual: {theme === 'light' ? 'Claro' : 'Escuro'}</p>
                  <p className="text-sm text-muted-foreground">
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
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Alterar Email
              </CardTitle>
              <CardDescription>
                Atualize seu endereço de email
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Email atual */}
              <div className="space-y-2">
                <Label>Email Atual</Label>
                <div className="p-3 bg-muted rounded-lg">
                  <p className="font-medium">{user?.email}</p>
                </div>
              </div>

              <Separator />

              {/* Atualizar Email */}
              <form onSubmit={handleEmailUpdate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="newEmail">Novo Email</Label>
                  <Input
                    id="newEmail"
                    type="email"
                    placeholder="Digite seu novo email"
                    value={emailForm.newEmail}
                    onChange={(e) => setEmailForm(prev => ({ ...prev, newEmail: e.target.value }))}
                    required
                  />
                </div>
                <Button 
                  type="submit" 
                  disabled={emailForm.loading || !emailForm.newEmail}
                  className="w-full"
                >
                  {emailForm.loading ? 'Atualizando...' : 'Atualizar Email'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Segurança */}
        <TabsContent value="security" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
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
                  <Label htmlFor="currentPassword">Senha Atual</Label>
                  <Input
                    id="currentPassword"
                    type="password"
                    placeholder="Digite sua senha atual"
                    value={passwordForm.currentPassword}
                    onChange={(e) => setPasswordForm(prev => ({ ...prev, currentPassword: e.target.value }))}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="newPassword">Nova Senha</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    placeholder="Digite sua nova senha"
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm(prev => ({ ...prev, newPassword: e.target.value }))}
                    required
                    minLength={8}
                  />
                  <p className="text-xs text-muted-foreground">
                    A senha deve ter pelo menos 8 caracteres, incluindo letras e números
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirmar Nova Senha</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="Confirme sua nova senha"
                    value={passwordForm.confirmPassword}
                    onChange={(e) => setPasswordForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                    required
                    minLength={8}
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
                  className="w-full"
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
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Informações da Conta
                </CardTitle>
                <CardDescription>
                  Visualize suas informações pessoais
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="p-4 bg-muted rounded-lg">
                    <p><span className="font-medium">Nome:</span> {user?.nome}</p>
                    <p><span className="font-medium">Email:</span> {user?.email}</p>
                    <p><span className="font-medium">Tipo:</span> {user?.tipo}</p>
                    <p><span className="font-medium">ID:</span> {user?.id}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Sessão e Logout */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-destructive">
                  <LogOut className="h-5 w-5" />
                  Gerenciar Sessão
                </CardTitle>
                <CardDescription>
                  Saia da sua conta ou gerencie sua sessão
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 bg-destructive/5 border border-destructive/20 rounded-lg">
                  <h3 className="font-medium text-destructive mb-2">Sair da Conta</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Ao fazer logout, você será redirecionado para a página de login e precisará 
                    inserir suas credenciais novamente para acessar o sistema.
                  </p>
                  <Button 
                    onClick={handleLogout}
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
    </div>
  )
}

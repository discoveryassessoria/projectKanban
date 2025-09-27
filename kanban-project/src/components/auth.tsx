"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { UserType, userTypeLabels } from "@/src/utils/userTypes"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useTheme } from "@/src/hooks/use-theme"
import { Moon, Sun } from "lucide-react"

interface AuthProps {
  onAuthSuccess?: () => void
  redirectTo?: string
}

export function AuthComponent({ onAuthSuccess, redirectTo = "/dashboard" }: AuthProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const { theme, toggleTheme } = useTheme()
  const router = useRouter()

  // Verificar se já está logado
  useEffect(() => {
    const token = localStorage.getItem("authToken")
    if (token) {
      router.push(redirectTo)
    }
  }, [router, redirectTo])

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsLoading(true)
    setError("")

    const formData = new FormData(e.currentTarget)
    const email = formData.get("email") as string
    const senha = formData.get("senha") as string

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha }),
      })

      const data = await response.json()

      if (response.ok) {
        localStorage.setItem("authToken", data.token)
        localStorage.setItem("user", JSON.stringify(data.user))

        if (onAuthSuccess) {
          onAuthSuccess()
        } else {
          router.push(redirectTo)
        }
      } else {
        setError(data.error || "Erro ao fazer login")
      }
    } catch (error) {
      setError("Erro de conexão. Tente novamente.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsLoading(true)
    setError("")
    setSuccess("")

    const formData = new FormData(e.currentTarget)
    const nome = formData.get("nome") as string
    const email = formData.get("email") as string
    const senha = formData.get("senha") as string
    const confirmSenha = formData.get("confirmSenha") as string
    const tipo = formData.get("tipo") as string

    if (senha !== confirmSenha) {
      setError("As senhas não coincidem")
      setIsLoading(false)
      return
    }

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, email, senha, tipo }),
      })

      const data = await response.json()

      if (response.ok) {
        setSuccess("Conta criada com sucesso! Faça login para continuar.")
        ;(e.target as HTMLFormElement).reset()
      } else {
        setError(data.error || "Erro ao criar conta")
      }
    } catch (error) {
      setError("Erro de conexão. Tente novamente.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <Card className="w-full max-w-md mx-auto border-border/50 shadow-xl bg-card/95 backdrop-blur-sm">
        <CardHeader className="text-center space-y-3 pb-6 relative">
          {/* Botão de toggle de tema no cabeçalho */}
          <div className="absolute top-4 right-4">
            <Button
              variant="outline"
              size="icon"
              onClick={toggleTheme}
              className="h-8 w-8 bg-background/80 backdrop-blur-sm border-border/50 hover:bg-muted/50 transition-colors"
              title={theme === 'light' ? 'Alternar para modo escuro' : 'Alternar para modo claro'}
              aria-label={theme === 'light' ? 'Alternar para modo escuro' : 'Alternar para modo claro'}
            >
              {theme === 'light' ? (
                <Moon className="h-3.5 w-3.5" />
              ) : (
                <Sun className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
          
          <CardTitle className="text-3xl font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
            Bem-vindo
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Faça login ou crie uma nova conta para continuar
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6 bg-muted/50">
              <TabsTrigger value="login" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">
                Login
              </TabsTrigger>
              <TabsTrigger value="register" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">
                Criar Conta
              </TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="space-y-6 mt-6">
              <form onSubmit={handleLogin} className="space-y-5">
                <div className="space-y-3">
                  <Label htmlFor="login-email" className="text-sm font-medium">
                    Email
                  </Label>
                  <Input
                    id="login-email"
                    name="email"
                    type="email"
                    placeholder="seu@email.com"
                    required
                    disabled={isLoading}
                    className="h-11 bg-background border-input/50 focus:border-primary focus:ring-1 focus:ring-primary/20"
                  />
                </div>
                <div className="space-y-3">
                  <Label htmlFor="login-senha" className="text-sm font-medium">
                    Senha
                  </Label>
                  <Input
                    id="login-senha"
                    name="senha"
                    type="password"
                    placeholder="Sua senha"
                    required
                    disabled={isLoading}
                    className="h-11 bg-background border-input/50 focus:border-primary focus:ring-1 focus:ring-primary/20"
                  />
                </div>

                {error && (
                  <Alert variant="destructive" className="border-destructive/50 bg-destructive/5">
                    <AlertDescription className="text-sm">{error}</AlertDescription>
                  </Alert>
                )}

                <Button 
                  type="submit" 
                  className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-200" 
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Entrando...
                    </>
                  ) : (
                    "Entrar"
                  )}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="register" className="space-y-6 mt-6">
              <form onSubmit={handleRegister} className="space-y-5">
                <div className="space-y-3">
                  <Label htmlFor="register-nome" className="text-sm font-medium">
                    Nome
                  </Label>
                  <Input
                    id="register-nome"
                    name="nome"
                    type="text"
                    placeholder="Seu nome completo"
                    required
                    disabled={isLoading}
                    className="h-11 bg-background border-input/50 focus:border-primary focus:ring-1 focus:ring-primary/20"
                  />
                </div>
                <div className="space-y-3">
                  <Label htmlFor="register-email" className="text-sm font-medium">
                    Email
                  </Label>
                  <Input
                    id="register-email"
                    name="email"
                    type="email"
                    placeholder="seu@email.com"
                    required
                    disabled={isLoading}
                    className="h-11 bg-background border-input/50 focus:border-primary focus:ring-1 focus:ring-primary/20"
                  />
                </div>
                <div className="space-y-3">
                  <Label htmlFor="register-tipo" className="text-sm font-medium">
                    Tipo de Usuário
                  </Label>
                  <select
                    id="register-tipo"
                    name="tipo"
                    className="flex h-11 w-full rounded-md border border-input/50 bg-background px-3 py-2 text-sm ring-offset-background focus:border-primary focus:ring-1 focus:ring-primary/20 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 [&>option]:bg-background [&>option]:text-foreground"
                    required
                    disabled={isLoading}
                  >
                    <option value="" className="text-muted-foreground">
                      Selecione o tipo
                    </option>
                    {Object.entries(userTypeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-3">
                  <Label htmlFor="register-senha" className="text-sm font-medium">
                    Senha
                  </Label>
                  <Input
                    id="register-senha"
                    name="senha"
                    type="password"
                    placeholder="Sua senha"
                    required
                    disabled={isLoading}
                    className="h-11 bg-background border-input/50 focus:border-primary focus:ring-1 focus:ring-primary/20"
                  />
                </div>
                <div className="space-y-3">
                  <Label htmlFor="register-confirm" className="text-sm font-medium">
                    Confirmar Senha
                  </Label>
                  <Input
                    id="register-confirm"
                    name="confirmSenha"
                    type="password"
                    placeholder="Confirme sua senha"
                    required
                    disabled={isLoading}
                    className="h-11 bg-background border-input/50 focus:border-primary focus:ring-1 focus:ring-primary/20"
                  />
                </div>

                {error && (
                  <Alert variant="destructive" className="border-destructive/50 bg-destructive/5">
                    <AlertDescription className="text-sm">{error}</AlertDescription>
                  </Alert>
                )}

                {success && (
                  <Alert className="border-green-500/50 bg-green-50 dark:bg-green-950/20">
                    <AlertDescription className="text-sm text-green-700 dark:text-green-400">
                      {success}
                    </AlertDescription>
                  </Alert>
                )}

                <Button 
                  type="submit" 
                  className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-200" 
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Criando conta...
                    </>
                  ) : (
                    "Criar Conta"
                  )}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </>
  )
}

export default AuthComponent

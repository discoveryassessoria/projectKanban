"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"

interface AuthProps {
  onAuthSuccess?: () => void
  redirectTo?: string
}

export default function AuthComponent({
  onAuthSuccess,
  redirectTo = "/dashboard",
}: AuthProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const router = useRouter()

  // redirecionar se já estiver logado
  useEffect(() => {
    const token = localStorage.getItem("authToken")
    if (token) router.push(redirectTo)
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
        onAuthSuccess ? onAuthSuccess() : router.push(redirectTo)
      } else {
        setError(data.error || "Erro ao fazer login")
      }
    } catch {
      setError("Erro de conexão. Tente novamente.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
  <Card
    className="
      w-full max-w-sm mx-auto
      bg-white text-slate-900 dark:bg-white
      rounded-[24px] shadow-2xl border border-slate-200
    "
  >
    {/* Cabeçalho */}
    <CardHeader className="text-center pt-4 pb-1 px-8">
      <CardTitle className="text-[28px] font-semibold text-slate-900 leading-tight">
        Bem-vindo!
      </CardTitle>
      <CardDescription className="mt-1 text-[14px] text-slate-500 leading-tight">
        Faça login para continuar.
      </CardDescription>
    </CardHeader>

    {/* Conteúdo */}
    <CardContent className="px-8 pt-3 pb-4">
      <form onSubmit={handleLogin} className="space-y-3">
        {/* EMAIL */}
        <div className="space-y-1">
          <Label
            htmlFor="login-email"
            className="text-sm font-medium text-slate-900"
          >
            Email
          </Label>
          <Input
            id="login-email"
            name="email"
            type="email"
            placeholder="seu@email.com"
            required
            disabled={isLoading}
            className="
              h-12 text-[15px]
              !bg-white dark:!bg-white
              border border-slate-300
              !text-slate-900 dark:!text-slate-900
              placeholder:text-slate-400
              rounded-md
              focus-visible:ring-2
              focus-visible:ring-[#123C73]/30
              focus-visible:border-[#123C73]
              transition-all duration-150
            "
          />
        </div>

        {/* SENHA */}
        <div className="space-y-1">
          <Label
            htmlFor="login-senha"
            className="text-sm font-medium text-slate-900"
          >
            Senha
          </Label>
          <Input
            id="login-senha"
            name="senha"
            type="password"
            placeholder="Sua senha"
            required
            disabled={isLoading}
            className="
              h-12 text-[15px]
              !bg-white dark:!bg-white
              border border-slate-300
              !text-slate-900 dark:!text-slate-900
              placeholder:text-slate-400
              rounded-md
              focus-visible:ring-2
              focus-visible:ring-[#123C73]/30
              focus-visible:border-[#123C73]
              transition-all duration-150
            "
          />
        </div>

        {/* ERRO */}
        {error && (
          <Alert className="border-red-200 bg-red-50">
            <AlertDescription className="text-sm text-red-700">
              {error}
            </AlertDescription>
          </Alert>
        )}

        {/* BOTÃO */}
        <Button
          type="submit"
          className="
            w-full h-12
            bg-[#123C73] hover:bg-[#0f315f]
            text-white font-medium text-[15px]
            rounded-md
            transition-all duration-150
          "
          disabled={isLoading}
        >
          {isLoading ? "Entrando..." : "Entrar"}
        </Button>

        {/* TEXTO FINAL */}
        <div className="pt-2 text-center text-[13px] text-slate-500 leading-tight">
          <p className="italic mb-[2px]">Não possui uma conta?</p>
          <p>Entre em contato com um administrador.</p>
        </div>
      </form>
    </CardContent>
  </Card>
  )
}

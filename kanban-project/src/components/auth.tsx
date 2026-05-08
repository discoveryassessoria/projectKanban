"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"

interface AuthProps {
  onAuthSuccess?: () => void
  redirectTo?: string
}

// 🆕 07/05/2026 — Helpers de leitura/limpeza de auth no cliente.
//
// Regra: o COOKIE é a fonte da verdade pra estado de "logado". O middleware
// só lê o cookie; se ele expirou ou foi removido, qualquer token velho que
// sobrou no localStorage é lixo. Mantemos os dois sincronizados pra que
// auth.tsx e middleware nunca discordem (essa discordância era a causa
// do pisca infinito na tela de login).
function lerCookie(nome: string): string | null {
  if (typeof document === "undefined") return null
  const match = document.cookie
    .split("; ")
    .find((linha) => linha.startsWith(`${nome}=`))
  return match ? decodeURIComponent(match.split("=")[1]) : null
}

function limparAuth(): void {
  if (typeof window === "undefined") return
  localStorage.removeItem("authToken")
  localStorage.removeItem("user")
  document.cookie =
    "authToken=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT"
}

export default function AuthComponent({
  onAuthSuccess,
  redirectTo = "/dashboard",
}: AuthProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const router = useRouter()

  // 🆕 07/05/2026 — redirect "já logado" sem causar loop.
  //
  // Antes este useEffect tinha [router, redirectTo] como dependência e
  // chamava window.location.href = redirectTo se houvesse QUALQUER token
  // no localStorage. Isso causava um loop visível na URL piscando:
  //
  //   1. Usuário abre /login com token velho no localStorage mas SEM
  //      cookie válido (cookie expirou ou nunca existiu)
  //   2. useEffect dispara → window.location.href = "/dashboard"
  //   3. middleware.ts intercepta /dashboard, vê que não tem cookie,
  //      redireciona pra /login
  //   4. /login monta de novo, useEffect dispara de novo, repete
  //
  // Correção: só redireciona pra /dashboard se houver token no
  // localStorage E cookie correspondente. Se um existir sem o outro,
  // limpa tudo e fica no /login. Roda apenas no mount.
  useEffect(() => {
    const tokenLS = localStorage.getItem("authToken")
    const tokenCookie = lerCookie("authToken")

    if (tokenLS && tokenCookie) {
      // Ambos presentes: confia no middleware pra validar quando chegar
      // em /dashboard. Usa router.replace pra navegação SPA (sem reload).
      router.replace(redirectTo)
    } else if (tokenLS || tokenCookie) {
      // Só um deles: estado inconsistente, limpa tudo e fica no login.
      // Isso quebra o ciclo do loop.
      limparAuth()
    }
    // Se nenhum: fica no login normalmente, sem fazer nada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // ← deps vazias: roda só uma vez no mount

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsLoading(true)
    setError("")

    const formData = new FormData(e.currentTarget)
    const email = formData.get("email") as string
    const senha = formData.get("senha") as string

    try {
      console.log("Tentando fazer login com email:", email)
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha }),
      })

      console.log("Status da resposta:", response.status)
      const data = await response.json()
      console.log("Dados da resposta:", data)

      if (response.ok) {
        console.log("Login bem-sucedido!")
        localStorage.setItem("authToken", data.token)
        localStorage.setItem("user", JSON.stringify(data.user))

        // Cookie pro middleware ler. 7 dias de validade.
        document.cookie = `authToken=${data.token}; path=/; max-age=${60 * 60 * 24 * 7}`

        if (onAuthSuccess) {
          onAuthSuccess()
        } else {
          // 🆕 router.replace em vez de window.location.href:
          // navegação SPA sem reload da página inteira.
          router.replace(redirectTo)
        }
      } else {
        console.log("Erro no login:", data.error)
        setError(data.error || "Erro ao fazer login")
      }
    } catch (error) {
      console.error("Erro de conexão:", error)
      setError("Erro de conexão. Tente novamente.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div
      className="
        w-full max-w-md mx-auto
        bg-white
        text-slate-900
        rounded-[20px] 
        shadow-2xl 
        border border-slate-200
        p-8
      "
    >
      {/* Cabeçalho */}
      <div className="text-center mb-6">
        <h1 className="text-[28px] font-semibold text-slate-900">
          Bem-vindo!
        </h1>
        <p className="text-[14px] text-slate-500 mt-0.5">
          Faça login para continuar.
        </p>
      </div>

      {/* Formulário */}
      <form onSubmit={handleLogin} className="space-y-4">
        {/* EMAIL */}
        <div className="space-y-1.5">
          <Label
            htmlFor="login-email"
            className="text-sm font-medium text-slate-700"
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
              bg-white
              border border-slate-200
              text-slate-900
              placeholder:text-slate-400
              rounded-lg
              focus-visible:ring-2
              focus-visible:ring-[#123C73]/30
              focus-visible:border-[#123C73]
              transition-all duration-150
            "
          />
        </div>

        {/* SENHA */}
        <div className="space-y-1.5">
          <Label
            htmlFor="login-senha"
            className="text-sm font-medium text-slate-700"
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
              bg-white
              border border-slate-200
              text-slate-900
              placeholder:text-slate-400
              rounded-lg
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
            rounded-lg
            transition-all duration-150
            mt-2
          "
          disabled={isLoading}
        >
          {isLoading ? "Entrando..." : "Entrar"}
        </Button>

        {/* TEXTO FINAL */}
        <div className="pt-3 text-center text-[13px] text-slate-500">
          <p className="italic">Não possui uma conta?</p>
          <p>Entre em contato com um administrador.</p>
        </div>
      </form>
    </div>
  )
}
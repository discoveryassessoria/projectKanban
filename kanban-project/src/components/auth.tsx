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

// 🆕 12/05/2026 — Detecta tokens em formato antigo (base64 simples) vs JWT.
// JWT tem formato "header.payload.signature" (3 partes separadas por ponto).
// Tokens antigos eram uma string base64 única sem pontos. Distinguir
// permite limpar tokens velhos automaticamente após a migração de auth.
function isJwtFormat(token: string): boolean {
  return token.split(".").length === 3
}

export default function AuthComponent({
  onAuthSuccess,
  redirectTo = "/dashboard",
}: AuthProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const router = useRouter()

  // 🆕 12/05/2026 — Sequência de checagens no mount:
  //
  //   1. Algum token está em formato antigo (base64 sem pontos)?
  //      → Limpa tudo. Usuário pré-migração JWT precisa relogar.
  //      Sem isso, ocorria race condition: useEffect chamava
  //      router.replace('/dashboard') com cookie antigo, middleware
  //      rejeitava, voltava pra /login, ciclo repetia enquanto usuário
  //      tentava clicar em Entrar.
  //
  //   2. Tem AMBOS (localStorage + cookie)?
  //      → Confia e redireciona pra dashboard. Middleware valida lá.
  //
  //   3. Tem só UM deles?
  //      → Estado inconsistente, limpa e fica no /login.
  //
  //   4. Nenhum?
  //      → Fica no /login normalmente.
  //
  // Roda apenas no mount (deps vazias).
  useEffect(() => {
    const tokenLS = localStorage.getItem("authToken")
    const tokenCookie = lerCookie("authToken")

    // 1. Token em formato antigo → limpa e fica no login
    if (
      (tokenLS && !isJwtFormat(tokenLS)) ||
      (tokenCookie && !isJwtFormat(tokenCookie))
    ) {
      limparAuth()
      return
    }

    // 2. Ambos presentes e em formato JWT → redireciona
    if (tokenLS && tokenCookie) {
      router.replace(redirectTo)
    } else if (tokenLS || tokenCookie) {
      // 3. Só um → inconsistente, limpa
      limparAuth()
    }
    // 4. Nenhum → não faz nada, fica no login
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
          // 🆕 12/05/2026 — Hard reload (window.location) em vez de
          // router.replace. Garante que qualquer estado React antigo
          // (token velho que sobrou de pré-migração JWT) seja descartado.
          // Custo: um reload de página. Benefício: zero race condition
          // entre estado React, localStorage, cookie e middleware.
          window.location.href = redirectTo
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
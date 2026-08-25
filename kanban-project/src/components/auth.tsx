"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { credenciaisDoCliente, descartarCredenciais } from "@/src/lib/sessao/cliente"

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

// ÚLTIMO E-MAIL — conveniência de tela, não credencial.
//
// Guarda SÓ o e-mail, para a próxima visita ao login pedir apenas a senha.
// Nunca senha, nunca token. Fica fora de `limparAuth`/`limparCredenciais` de
// propósito: é justamente ao sair — por "Sair" ou por expiração — que ele
// precisa sobreviver. Some só quando o usuário pede, em "Entrar com outra
// conta". Como as duas rotinas de limpeza removem chaves uma a uma (não há
// `localStorage.clear()` no projeto), sobreviver é o comportamento padrão e
// não exigiu mexer em nenhuma delas.
const K_ULTIMO_EMAIL = "sessao:ultimoEmail"

function lerUltimoEmail(): string | null {
  if (typeof window === "undefined") return null
  try {
    const v = localStorage.getItem(K_ULTIMO_EMAIL)
    return v && v.trim() ? v : null
  } catch {
    return null
  }
}

function guardarUltimoEmail(email: string): void {
  try {
    if (email.trim()) localStorage.setItem(K_ULTIMO_EMAIL, email.trim())
  } catch {
    /* storage cheio ou bloqueado: lembrar é conveniência, não pode impedir o login */
  }
}

function esquecerUltimoEmail(): void {
  try {
    localStorage.removeItem(K_ULTIMO_EMAIL)
  } catch {
    /* idem */
  }
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
  // Inicializador preguiçoso: lê o storage UMA vez, na criação do estado. O
  // componente só é renderizado depois de montar no cliente (login/page.tsx
  // segura com `useIsClient`), então não há divergência de hidratação; o guard
  // de `typeof window` em `lerUltimoEmail` cobre qualquer reuso fora dali.
  const [ultimoEmail, setUltimoEmail] = useState<string | null>(() => lerUltimoEmail())
  const router = useRouter()

  const modoLembrado = ultimoEmail !== null

  function trocarDeConta() {
    esquecerUltimoEmail()
    setUltimoEmail(null)
    setError("")
  }

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
    // A DEFINIÇÃO DE SESSÃO É UMA SÓ, e mora em `src/lib/sessao/cliente.ts`.
    //
    // Aqui existia uma segunda: "logado = authToken + cookie". O dashboard usava
    // outra: "logado = authToken + user". Com token e cookie presentes e `user`
    // ausente, esta tela mandava para o dashboard e o dashboard mandava de volta —
    // 1.853 navegações em 12 segundos, o formulário destruído a cada volta, e o
    // login preso em "Entrando…" porque a navegação de sucesso era engolida no meio.
    const c = credenciaisDoCliente()

    // SESSÃO PELA METADE NÃO É MEIO LOGADO: é resto de sessão anterior. Apaga e FICA
    // aqui. Navegar com credencial incompleta é exatamente o que fechava o ciclo.
    if (c.incompleta) { descartarCredenciais(); return }

    // Sessão completa: quem valida de verdade é o middleware, no destino.
    if (c.completa) router.replace(redirectTo)
    // Nenhuma credencial: fica no login, que é onde o usuário já está.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // ← deps vazias: roda só uma vez no mount

  // ── Diagnóstico do travamento relatado ────────────────────────────────────
  // Há uma falha que não reproduz em bancada: depois de ficar ocioso, o usuário
  // volta, digita a senha e a tela fica em "Entrando…" para sempre. Duas coisas
  // acontecem aqui, e as duas valem independentemente da causa raiz:
  //
  //   1. RELATAR — se a requisição não responder, ou se o 200 chegar e a
  //      navegação não acontecer, o cliente conta o que viu. Sem isso eu só
  //      posso adivinhar, e já adivinhei errado duas vezes.
  //   2. NÃO MENTIR — um botão preso em "Entrando…" é beco sem saída. Passado
  //      o limite, o estado volta e o usuário recebe uma saída de verdade.
  const relatar = (fase: string, extra: Record<string, unknown> = {}) => {
    try {
      const nav = (performance.getEntriesByType("navigation")[0] ?? {}) as PerformanceNavigationTiming
      void fetch("/api/auth/diagnostico-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          fase,
          visibilidade: document.visibilityState,
          restauradaDoCache: nav.type === "back_forward",
          msDesdeCarregamento: Math.round(performance.now()),
          temTokenLocal: !!localStorage.getItem("authToken"),
          temCookie: document.cookie.includes("authToken="),
          online: navigator.onLine,
          agente: navigator.userAgent,
          ...extra,
        }),
      }).catch(() => { /* diagnóstico nunca atrapalha o login */ })
    } catch { /* idem */ }
  }

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsLoading(true)
    setError("")

    const formData = new FormData(e.currentTarget)
    const email = formData.get("email") as string
    const senha = formData.get("senha") as string

    const t0 = Date.now()
    // A requisição não pode ficar pendente para sempre: é exatamente esse o
    // sintoma relatado. 20s é folgado para uma rota que responde em ~0,4s.
    const cancelador = new AbortController()
    const limite = setTimeout(() => cancelador.abort(), 20_000)

    try {
      console.log("Tentando fazer login com email:", email)
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha }),
        signal: cancelador.signal,
      })

      console.log("Status da resposta:", response.status)
      const data = await response.json()
      console.log("Dados da resposta:", data)

      if (response.ok) {
        console.log("Login bem-sucedido!")
        localStorage.setItem("authToken", data.token)
        localStorage.setItem("user", JSON.stringify(data.user))
        // Só depois do 200: e-mail que não autenticou não vira sugestão.
        guardarUltimoEmail(email)

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
          //
          // VIGIA: se em 8s esta página ainda estiver viva, a navegação não
          // aconteceu — e é esse o segundo sintoma possível do travamento.
          // O usuário deixa de ficar preso num botão que não anda.
          setTimeout(() => {
            relatar("navegacao-nao-ocorreu", {
              msDecorridos: Date.now() - t0, fetchConcluido: true, httpStatus: 200,
            })
            setIsLoading(false)
            setError("A sessão foi criada, mas a página não avançou. Clique em Entrar novamente.")
          }, 8_000)
          window.location.href = redirectTo
        }
      } else {
        console.log("Erro no login:", data.error)
        setError(data.error || "Erro ao fazer login")
      }
    } catch (error) {
      const porTempo = error instanceof DOMException && error.name === "AbortError"
      if (porTempo) {
        relatar("fetch-nao-respondeu", { msDecorridos: Date.now() - t0, fetchConcluido: false })
        setError("O servidor não respondeu. Tente entrar novamente.")
      } else {
        console.error("Erro de conexão:", error)
        setError("Erro de conexão. Tente novamente.")
      }
    } finally {
      clearTimeout(limite)
      setIsLoading(false)
    }
  }

  return (
    <div
      className="
        w-full max-w-md mx-auto
        bg-[var(--surface-primary)]
        text-[var(--text-secondary)]
        rounded-[20px] 
        shadow-[var(--elev-3)] 
        border border-[var(--border-default)]
        p-8
      "
    >
      {/* Cabeçalho */}
      <div className="text-center mb-6">
        <h1 className="text-[28px] font-semibold text-[var(--text-secondary)]">
          {modoLembrado ? "Bem-vindo de volta!" : "Bem-vindo!"}
        </h1>
        <p className="text-[14px] text-[var(--text-secondary)] mt-0.5">
          {modoLembrado ? "Confirme sua senha para continuar." : "Faça login para continuar."}
        </p>
      </div>

      {/* Formulário */}
      <form onSubmit={handleLogin} className="space-y-4">
        {/* EMAIL — lembrado (leitura) ou campo normal */}
        {modoLembrado ? (
          <div className="space-y-1.5">
            {/* O e-mail vai no POST por aqui: `handleLogin` continua lendo
                `formData.get("email")` sem saber que existem dois modos. Sem
                `required` — campo oculto não participa da validação do browser. */}
            <input type="hidden" name="email" value={ultimoEmail} />
            <div
              className="
                flex items-center gap-3
                h-12 px-3
                bg-[var(--surface-secondary)]
                border border-[var(--border-default)]
                rounded-lg
              "
            >
              <span
                aria-hidden="true"
                className="
                  flex h-7 w-7 shrink-0 items-center justify-center
                  rounded-full bg-[var(--action-primary)] text-[12px] font-semibold text-[var(--action-primary-ink)]
                "
              >
                {ultimoEmail.slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate text-[15px] text-[var(--text-secondary)]" title={ultimoEmail}>
                {ultimoEmail}
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label
              htmlFor="login-email"
              className="text-sm font-medium text-[var(--text-secondary)]"
            >
              Email
            </Label>
            <Input
              id="login-email"
              name="email"
              type="email"
              placeholder="seu@email.com"
              required
              autoFocus
              disabled={isLoading}
              className="
                h-12 text-[15px]
                bg-[var(--surface-primary)]
                border border-[var(--border-default)]
                text-[var(--text-secondary)]
                placeholder:text-[var(--text-secondary)]
                rounded-lg
                focus-visible:ring-2
                focus-visible:ring-[var(--border-strong)]/30
                focus-visible:border-[var(--border-strong)]
                transition-all duration-150
              "
            />
          </div>
        )}

        {/* SENHA */}
        <div className="space-y-1.5">
          <Label
            htmlFor="login-senha"
            className="text-sm font-medium text-[var(--text-secondary)]"
          >
            Senha
          </Label>
          <Input
            id="login-senha"
            name="senha"
            type="password"
            placeholder="Sua senha"
            required
            // No modo lembrado o e-mail já está resolvido: o cursor começa onde
            // resta digitar. No modo normal quem recebe o foco é o e-mail.
            autoFocus={modoLembrado}
            disabled={isLoading}
            className="
              h-12 text-[15px]
              bg-[var(--surface-primary)]
              border border-[var(--border-default)]
              text-[var(--text-secondary)]
              placeholder:text-[var(--text-secondary)]
              rounded-lg
              focus-visible:ring-2
              focus-visible:ring-[var(--border-strong)]/30
              focus-visible:border-[var(--border-strong)]
              transition-all duration-150
            "
          />
        </div>

        {/* ERRO */}
        {error && (
          <Alert className="border-[var(--border-default)] bg-[var(--surface-secondary)]">
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
            bg-[var(--action-primary)] hover:bg-[var(--action-primary-hover)]
            text-[var(--action-primary-ink)] font-medium text-[15px]
            rounded-lg
            transition-all duration-150
            mt-2
          "
          disabled={isLoading}
        >
          {isLoading ? "Entrando..." : "Entrar"}
        </Button>

        {/* TROCAR DE CONTA — o único caminho que apaga o e-mail lembrado. */}
        {modoLembrado && (
          <div className="text-center">
            <button
              type="button"
              onClick={trocarDeConta}
              disabled={isLoading}
              className="
                text-[13px] text-[var(--text-secondary)] underline underline-offset-2
                transition-colors hover:text-[var(--text-primary)]
                disabled:opacity-50 disabled:cursor-not-allowed
              "
            >
              Não é você? Entrar com outra conta
            </button>
          </div>
        )}

        {/* TEXTO FINAL */}
        <div className="pt-3 text-center text-[13px] text-[var(--text-secondary)]">
          <p className="italic">Não possui uma conta?</p>
          <p>Entre em contato com um administrador.</p>
        </div>
      </form>
    </div>
  )
}
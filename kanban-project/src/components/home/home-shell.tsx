"use client"

// ============================================================================
// SHELL DO CENTRO OPERACIONAL
// ----------------------------------------------------------------------------
// Exatamente a mesma casca do módulo Financeiro (src/app/financeiro/page.tsx):
// fundo arquitetônico europeu desfocado + overlay escuro + HeaderBar padrão.
// A Home e o drill-down das filas compartilham este shell — mesma iluminação,
// mesma tipografia, mesma barra lateral, mesmos componentes.
//
// VARIANTE "claro" (16/09/2026) — redesign da Página Inicial, só dela: a Home
// pediu superfície clara/premium (ivory-azul, igual ao resto do DS de tema
// claro), sem a cidade escurecida por trás. O drill-down de fila
// (`/dashboard/fila/[key]`) não pediu nada disso e continua na variante
// "escuro" (o default, sem tocar em nenhuma linha do comportamento antigo).
// `HeaderBar` (câmbio, busca, notificações, usuário, sair) é o MESMO
// componente nas duas variantes — só a busca liga, porque a Home pediu
// explicitamente "manter os elementos globais já existentes".
// ============================================================================

import * as React from "react"
import { useRouter } from "next/navigation"
import { HeaderBarApp } from "@/src/components/header-bar-app"
import { encerrarSessao } from "@/src/lib/sessao/cliente"
import { useJsonLocalStorage } from "@/src/lib/cliente"

export function HomeShell({
  titulo = "Centro Operacional",
  subtitulo = "O que precisa ser feito agora",
  variante = "escuro",
  children,
}: {
  titulo?: string
  subtitulo?: string
  /** "escuro" (default, inalterado) = cidade + véu. "claro" = ivory-azul do DS, sem imagem. */
  variante?: "escuro" | "claro"
  children: React.ReactNode
}) {
  const router = useRouter()
  // Leitura oficial do localStorage: segura na hidratação, referência estável e
  // reagindo a troca de usuário em outra aba. Payload inválido devolve `null` — o
  // placeholder continua sendo o fallback, como antes.
  const userSalvo = useJsonLocalStorage<{ nome?: string; tipo?: string; email?: string }>("user")
  const user = userSalvo ?? { nome: "Usuário" }

  function sair() { void encerrarSessao("manual") }

  const claro = variante === "claro"

  return (
    <div className={`relative min-h-screen [overflow-x:clip] ${claro ? "text-[var(--text-primary)]" : "text-white"}`}>
      {claro ? (
        // Sem imagem, sem véu: o `body` (globals.css) já pinta o mesmo ivory-azul
        // que o resto do sistema usa — esta camada só existe pra cobrir o fixed
        // do próprio body atrás do header sticky, mesma técnica, cor lisa.
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[var(--app-background)]" />
      ) : (
        <>
          {/* AMBIENTE — receita única do sistema: imagem fixa nítida + degradê escuro.
              O degradê é quase opaco onde o conteúdo vive e abre na base, então a
              cidade aparece nítida embaixo — decisão de composição, não sobra. */}
          <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
          <div
            className="pointer-events-none fixed inset-0 -z-10"
            style={{
              background:
                "var(--landscape-veil)",
            }}
          />
        </>
      )}

      <HeaderBarApp
        title={titulo}
        subtitle={subtitulo}
        userName={user?.nome || "Usuário"}
        userRole={user?.tipo === "admin" ? "Administrador" : user?.tipo || "Usuário"}
        userEmail={user?.email || ""}
        ocultarBusca={!claro}
        onLogout={sair}
      />

      <div className="min-h-screen relative">
        <main className="relative">{children}</main>
      </div>
    </div>
  )
}

"use client"

// ============================================================================
// SHELL DO CENTRO OPERACIONAL
// ----------------------------------------------------------------------------
// Exatamente a mesma casca do módulo Financeiro (src/app/financeiro/page.tsx):
// fundo arquitetônico europeu desfocado + overlay escuro + HeaderBar padrão.
// A Home e o drill-down das filas compartilham este shell — mesma iluminação,
// mesma tipografia, mesma barra lateral, mesmos componentes.
// ============================================================================

import * as React from "react"
import { useRouter } from "next/navigation"
import { HeaderBar } from "@/src/components/header-bar"
import { encerrarSessao } from "@/src/lib/sessao/cliente"
import { useJsonLocalStorage } from "@/src/lib/cliente"

export function HomeShell({
  titulo = "Centro Operacional",
  subtitulo = "O que precisa ser feito agora",
  children,
}: {
  titulo?: string
  subtitulo?: string
  children: React.ReactNode
}) {
  const router = useRouter()
  // Leitura oficial do localStorage: segura na hidratação, referência estável e
  // reagindo a troca de usuário em outra aba. Payload inválido devolve `null` — o
  // placeholder continua sendo o fallback, como antes.
  const userSalvo = useJsonLocalStorage<{ nome?: string; tipo?: string; email?: string }>("user")
  const user = userSalvo ?? { nome: "Usuário" }

  function sair() { void encerrarSessao("manual") }

  return (
    <div className="relative min-h-screen [overflow-x:clip] text-white">
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

      <HeaderBar
        title={titulo}
        subtitle={subtitulo}
        userName={user?.nome || "Usuário"}
        userRole={user?.tipo === "admin" ? "Administrador" : user?.tipo || "Usuário"}
        userEmail={user?.email || ""}
        ocultarBusca
        onLogout={sair}
      />

      <div className="min-h-screen relative">
        <main className="relative">{children}</main>
      </div>
    </div>
  )
}

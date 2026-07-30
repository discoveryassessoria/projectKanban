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
import { useUsuarioLogado } from "@/src/hooks/use-dados-headerbar"
import { encerrarSessao } from "@/src/lib/sessao/cliente"

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
  // Usuário logado: estado EXTERNO (armazenamento do navegador), não copiado.
  const user = useUsuarioLogado()


  function sair() { void encerrarSessao("manual") }

  return (
    <div className="relative min-h-screen overflow-x-hidden text-white">
      {/* Fundo arquitetônico desfocado e escurecido — idêntico ao Financeiro */}
      <div className="pointer-events-none fixed inset-0 -z-10 scale-105 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat blur-[6px]" />
      <div className="pointer-events-none fixed inset-0 -z-10 bg-black/60" />

      <HeaderBar
        title={titulo}
        subtitle={subtitulo}
        userName={user?.nome || "Usuário"}
        userRole={user?.tipo === "admin" ? "Administrador" : user?.tipo || "Usuário"}
        userEmail={user?.email || ""}
        ocultarBusca
        onLogout={sair}
      />

      <div className="relative min-h-screen">
        <div className="pointer-events-none absolute inset-0 bg-black/10" />
        <main className="relative">{children}</main>
      </div>
    </div>
  )
}

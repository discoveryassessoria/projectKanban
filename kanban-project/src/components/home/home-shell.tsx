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
    <div className="relative min-h-screen overflow-x-hidden text-white">
      {/* ----------------------------------------------------------------------
          AMBIENTE — a foto não é textura sob o texto, é HORIZONTE.
          O borrão uniforme + preto 60% deixava a imagem passando por baixo do
          conteúdo (contraste baixo em tudo, sem ganhar profundidade em nada).
          Aqui o véu é quase opaco na faixa onde o conteúdo vive e só abre na
          base: a cidade aparece nítida embaixo, como decisão de composição.
          ---------------------------------------------------------------------- */}
      <div
        className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat"
        style={{ filter: "saturate(.55) contrast(1.02) brightness(.92)" }}
      />
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "linear-gradient(180deg, rgba(8,9,11,.985) 0%, rgba(8,9,11,.975) 46%, rgba(8,9,11,.95) 60%," +
            " rgba(8,9,11,.86) 72%, rgba(8,9,11,.76) 86%, rgba(8,9,11,.88) 100%)",
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

      {/* Sem véu extra aqui: quem controla a luz da tela é a camada de ambiente
          acima. Um `bg-black/10` a mais só apagaria o horizonte. */}
      <div className="relative min-h-screen">
        <main className="relative">{children}</main>
      </div>
    </div>
  )
}

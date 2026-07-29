"use client"
import { encerrarSessao } from "@/src/lib/sessao/cliente"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

// 🆕 07/05/2026 — Helper local pra ler cookie no cliente.
// Mantemos a mesma regra do auth.tsx: o COOKIE é a fonte da verdade, e
// se ele não existir, qualquer token velho que sobrou no localStorage é
// lixo. Sem essa coordenação, /login e / disputavam o redirect e
// causavam o pisca infinito na URL.
function lerCookie(nome: string): string | null {
  if (typeof document === "undefined") return null
  const match = document.cookie
    .split("; ")
    .find((linha) => linha.startsWith(`${nome}=`))
  return match ? decodeURIComponent(match.split("=")[1]) : null
}

export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    const tokenLS = localStorage.getItem("authToken")
    const tokenCookie = lerCookie("authToken")

    // Só considera "logado" se localStorage E cookie batem.
    // Se faltar um, limpa o lixo e manda pra /login.
    if (tokenLS && tokenCookie) {
      router.replace("/dashboard")
    } else if (tokenLS || tokenCookie) {
      // Estado inconsistente (só metade da credencial): isso É um fim de sessão
      // — passa pelo ponto único, que limpa tudo, AUDITA o motivo, avisa as
      // outras abas e navega. Não duplicamos a limpeza aqui.
      void encerrarSessao("token_invalido")
    } else {
      router.replace("/login")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // ← deps vazias: roda só uma vez no mount

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
    </div>
  )
}
"use client"

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
    } else {
      if (tokenLS || tokenCookie) {
        // Estado inconsistente: limpa antes de redirecionar pra /login
        // pra que /login não tente redirecionar de volta com o lixo.
        localStorage.removeItem("authToken")
        localStorage.removeItem("user")
        document.cookie =
          "authToken=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT"
      }
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
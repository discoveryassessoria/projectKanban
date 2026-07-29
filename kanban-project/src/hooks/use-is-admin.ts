"use client"

import { useMemo, useSyncExternalStore } from "react"

interface User {
  id: number
  nome: string
  email: string
  tipo: string
}

// O usuário logado é um estado EXTERNO ao React (localStorage). Ler com
// useSyncExternalStore em vez de copiar para o estado num efeito: não há render
// intermediário com valor errado, o hook reage a login/logout em outra aba e o
// snapshot do servidor (undefined) representa honestamente "ainda não sei".
const CHAVE = "user"

function subscrever(aoMudar: () => void) {
  window.addEventListener("storage", aoMudar)
  return () => window.removeEventListener("storage", aoMudar)
}
const lerNoCliente = () => localStorage.getItem(CHAVE)
const lerNoServidor = () => undefined

export function useIsAdmin() {
  const bruto = useSyncExternalStore(subscrever, lerNoCliente, lerNoServidor)

  const user = useMemo<User | null>(() => {
    if (!bruto) return null
    try {
      return JSON.parse(bruto) as User
    } catch (error) {
      console.error("Erro ao verificar tipo de usuário:", error)
      return null
    }
  }, [bruto])

  // undefined = servidor/hidratação (ainda não lemos o armazenamento do navegador).
  return { isAdmin: user?.tipo === "admin", isLoading: bruto === undefined, user }
}

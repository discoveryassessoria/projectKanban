"use client"

// src/hooks/use-is-admin.ts
// O papel do usuário vem do localStorage — mas lido pela abstração oficial de
// cliente, não por um efeito de montagem. A leitura direta obrigava a copiar o
// valor para o estado depois de montar (setState em efeito), o que rendia um
// render extra e um instante em que a tela já dizia "não é admin" sem saber.
//
// `useJsonLocalStorage` resolve os três pontos de uma vez: é seguro na
// hidratação, devolve referência estável e reage a mudança em OUTRAS abas —
// então trocar de usuário numa aba não deixa a outra com o papel antigo.

import { useIsClient, useJsonLocalStorage } from "@/src/lib/cliente"

interface User {
  id: number
  nome: string
  email: string
  tipo: string
}

export function useIsAdmin() {
  // No servidor e no primeiro render não existe localStorage: `isLoading` cobre
  // exatamente essa janela, como antes.
  const noCliente = useIsClient()
  // JSON corrompido devolve `null` pela própria abstração — o `try/catch` que
  // vivia aqui terminava em `isAdmin: false`, que é o mesmo resultado.
  const user = useJsonLocalStorage<User>("user")

  return {
    isAdmin: user?.tipo === "admin",
    isLoading: !noCliente,
    user,
  }
}

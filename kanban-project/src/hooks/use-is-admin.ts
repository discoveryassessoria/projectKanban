"use client"

import { useEffect, useState } from "react"

interface User {
  id: number
  nome: string
  email: string
  tipo: string
}

export function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    try {
      const userData = localStorage.getItem("user")
      if (userData) {
        const parsedUser = JSON.parse(userData) as User
        setUser(parsedUser)
        setIsAdmin(parsedUser.tipo === "admin")
      }
    } catch (error) {
      console.error("Erro ao verificar tipo de usuário:", error)
      setIsAdmin(false)
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  return { isAdmin, isLoading, user }
}

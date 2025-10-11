"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { UserManagement } from "@/src/components/user-management"
import { useIsAdmin } from "@/src/hooks/use-is-admin"

export default function AdministratorPage() {
  const router = useRouter()
  const { isAdmin, isLoading } = useIsAdmin()

  useEffect(() => {
    // Verificar autenticação
    const token = localStorage.getItem("authToken")
    if (!token) {
      router.push("/auth")
      return
    }

    // Verificar se é admin (após carregar)
    if (!isLoading && !isAdmin) {
      router.push("/dashboard")
    }
  }, [isAdmin, isLoading, router])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (!isAdmin) {
    return null
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <UserManagement />
    </div>
  )
}

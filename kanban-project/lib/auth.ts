export interface User {
  id: number
  nome: string
  email: string
  tipo: string
}

export function getStoredUser(): User | null {
  if (typeof window === "undefined") return null

  try {
    const userData = localStorage.getItem("user")
    return userData ? JSON.parse(userData) : null
  } catch {
    return null
  }
}

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null

  return localStorage.getItem("authToken")
}

export function isAuthenticated(): boolean {
  return !!(getStoredToken() && getStoredUser())
}

export function logout(): void {
  if (typeof window === "undefined") return

  localStorage.removeItem("authToken")
  localStorage.removeItem("user")
}

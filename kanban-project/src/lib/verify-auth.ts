import { NextRequest } from "next/server"

export function verifyAuth(request: NextRequest): {
  isAuthenticated: boolean
  isAdmin: boolean
  userId?: number
  tipo?: string
} {
  try {
    const authHeader = request.headers.get("authorization")
    const token = authHeader?.replace("Bearer ", "")
    if (!token) return { isAuthenticated: false, isAdmin: false }

    const parts = token.split(".")
    if (parts.length !== 3) return { isAuthenticated: false, isAdmin: false }

    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    const decoded = JSON.parse(atob(payloadB64))

    if (decoded.exp && Date.now() / 1000 > decoded.exp) {
      return { isAuthenticated: false, isAdmin: false }
    }

    return {
      isAuthenticated: true,
      isAdmin: decoded.tipo === "admin",
      userId: decoded.userId,
      tipo: decoded.tipo,
    }
  } catch {
    return { isAuthenticated: false, isAdmin: false }
  }
}
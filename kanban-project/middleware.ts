// middleware.ts (raiz do projeto)
// Protege rotas /dashboard e /administrator validando JWT.

import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { verifyAuthToken } from "@/lib/auth-jwt"

export async function middleware(request: NextRequest) {
  const token =
    request.cookies.get("authToken")?.value ||
    request.headers.get("authorization")?.replace("Bearer ", "")

  // Proteger rotas que requerem autenticação
  if (
    request.nextUrl.pathname.startsWith("/dashboard") ||
    request.nextUrl.pathname.startsWith("/administrator")
  ) {
    if (!token) {
      return NextResponse.redirect(new URL("/login", request.url))
    }

    // 🆕 Validação JWT real (jose, HS256). Antes era atob() + JSON.parse,
    // que aceitava qualquer string base64 — inclusive forjada.
    const decoded = await verifyAuthToken(token)
    if (!decoded) {
      return NextResponse.redirect(new URL("/login", request.url))
    }

    // Proteção específica para rota administrator - apenas admins
    if (request.nextUrl.pathname.startsWith("/administrator")) {
      if (decoded.tipo !== "admin") {
        return NextResponse.redirect(new URL("/dashboard", request.url))
      }
    }

    return NextResponse.next()
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/dashboard/:path*", "/administrator/:path*"],
}
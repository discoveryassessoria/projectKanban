import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(request: NextRequest) {
  const token =
    request.cookies.get("authToken")?.value || request.headers.get("authorization")?.replace("Bearer ", "")

  // Proteger rotas que requerem autenticação
  if (request.nextUrl.pathname.startsWith("/dashboard") || request.nextUrl.pathname.startsWith("/administrator")) {
    if (!token) {
      return NextResponse.redirect(new URL("/login", request.url))
    }

    try {
      // Verificação simples do token (decodificar base64)
      const decoded = JSON.parse(atob(token))

      // Verificar se o token não expirou
      if (decoded.exp && Date.now() > decoded.exp) {
        return NextResponse.redirect(new URL("/login", request.url))
      }

      // Proteção específica para rota administrator - apenas admins
      if (request.nextUrl.pathname.startsWith("/administrator")) {
        if (decoded.tipo !== "admin") {
          return NextResponse.redirect(new URL("/dashboard", request.url))
        }
      }

      return NextResponse.next()
    } catch (error) {
      return NextResponse.redirect(new URL("/login", request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/dashboard/:path*", "/administrator/:path*"],
}

import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(request: NextRequest) {
  // Verificar se a rota é protegida
  if (request.nextUrl.pathname.startsWith("/dashboard")) {
    const token =
      request.cookies.get("authToken")?.value || request.headers.get("authorization")?.replace("Bearer ", "")

    if (!token) {
      return NextResponse.redirect(new URL("/auth", request.url))
    }

    try {
      // Verificação simples do token (decodificar base64)
      const decoded = JSON.parse(atob(token))

      // Verificar se o token não expirou
      if (decoded.exp && Date.now() > decoded.exp) {
        return NextResponse.redirect(new URL("/auth", request.url))
      }

      return NextResponse.next()
    } catch (error) {
      return NextResponse.redirect(new URL("/auth", request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/dashboard/:path*"],
}

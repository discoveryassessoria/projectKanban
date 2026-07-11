// middleware.ts (raiz do projeto)
// CP-SEC — Guard central de autenticação.
//
// Duas responsabilidades:
//  1) Páginas /dashboard e /administrator: redireciona para /login se o JWT
//     interno for inválido (comportamento original preservado).
//  2) TODA rota /api/* passa a exigir JWT interno válido (deny-by-default),
//     exceto uma allowlist pública curada. Retorna 401 JSON quando ausente
//     ou forjado. O token é lido do cookie `authToken` (enviado
//     automaticamente pelo browser) OU do header Authorization.
//
// Isso fecha centralmente o acesso anônimo às rotas internas (financeiro,
// fase, documentos, genealogia, clientes, logs, etc.) sem precisar editar o
// corpo de cada handler. Verificação real via `jose` (Edge-compatível).

import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { verifyAuthToken } from "@/lib/auth-jwt"

/**
 * Rotas /api PÚBLICAS (não exigem token interno). Cada entrada é justificada:
 *  - /api/auth/login  → autenticação interna (não pode exigir estar logado).
 *  - /api/app/        → portal do cliente; usa token próprio (app-auth) e
 *                       cada rota se auto-verifica. `gerar-acesso` recebe gate
 *                       de staff no próprio handler.
 *  - /api/blog/       → blog público do site institucional (somente leitura).
 *  - /api/cambio      → cotação de câmbio (somente leitura, sem PII).
 *  - /api/paises      → catálogo de países (somente leitura).
 *
 * Observações:
 *  - /api/status NÃO é health check — é o CRUD de colunas do Kanban
 *    (POST/PUT/DELETE), então fica PROTEGIDO.
 *  - /api/test-db NÃO está aqui de propósito — fica bloqueado pelo gate e
 *    ainda é desativado em produção no próprio handler.
 */
const API_PUBLICA: string[] = [
  "/api/auth/login",
  "/api/app/",
  "/api/blog/",
  "/api/blog",
  "/api/cambio",
  "/api/paises",
]

function isApiPublica(pathname: string): boolean {
  return API_PUBLICA.some(
    (p) => pathname === p || pathname.startsWith(p)
  )
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const token =
    request.cookies.get("authToken")?.value ||
    request.headers.get("authorization")?.replace("Bearer ", "")

  // ===== 1) Gate de API (deny-by-default) =====
  if (pathname.startsWith("/api/")) {
    if (isApiPublica(pathname)) {
      return NextResponse.next()
    }

    if (!token) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    }

    // Verificação real da assinatura. `verifyAuthToken` retorna null em
    // qualquer falha; se o segredo não estiver configurado, `getSecretKey`
    // lança — capturamos e negamos (fail-closed, nunca fallback inseguro).
    let decoded = null
    try {
      decoded = await verifyAuthToken(token)
    } catch {
      decoded = null
    }

    if (!decoded) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    }

    return NextResponse.next()
  }

  // ===== 2) Gate de páginas protegidas (redirect) =====
  if (
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/administrator")
  ) {
    if (!token) {
      return NextResponse.redirect(new URL("/login", request.url))
    }

    let decoded = null
    try {
      decoded = await verifyAuthToken(token)
    } catch {
      decoded = null
    }

    if (!decoded) {
      return NextResponse.redirect(new URL("/login", request.url))
    }

    // Rota administrator: apenas admins
    if (pathname.startsWith("/administrator") && decoded.tipo !== "admin") {
      return NextResponse.redirect(new URL("/dashboard", request.url))
    }

    return NextResponse.next()
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/dashboard/:path*", "/administrator/:path*", "/api/:path*"],
}

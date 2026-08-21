// middleware.ts (raiz do projeto)
// CP-SEC — Guard central de autenticação.
//
// Três responsabilidades:
//  1) Páginas /dashboard e /administrator: redireciona para /login se o JWT
//     interno for inválido (comportamento original preservado).
//  2) TODA rota /api/* passa a exigir JWT interno válido (deny-by-default),
//     exceto uma allowlist pública curada. Retorna 401 JSON quando ausente
//     ou forjado. O token é lido do cookie `authToken` (enviado
//     automaticamente pelo browser) OU do header Authorization.
//  3) CORS das rotas /api/app/* (só elas), incluindo o preflight OPTIONS.
//     Ver o bloco CORS mais abaixo para o porquê e o critério de origem.
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
 *  - /api/auth/logout → encerra sessão; aceita token expirado só para auditar.
 *  - /api/app/        → portal do cliente; usa token próprio (app-auth) e
 *                       cada rota se auto-verifica. `gerar-acesso` recebe gate
 *                       de staff no próprio handler.
 *  - /api/blog/       → blog público do site institucional (somente leitura).
 *  - /api/cambio      → cotação de câmbio (somente leitura, sem PII).
 *  - /api/paises      → catálogo de países (somente leitura).
 *  - /api/cron/cambio, /api/cron/registral
 *                     → invocados pelo Vercel Cron, que não carrega JWT
 *                       interno. Cada handler se auto-verifica: exige o header
 *                       `x-vercel-cron` OU `Authorization: Bearer CRON_SECRET`
 *                       (o registral aceita ainda operador com a permissão
 *                       `registral.reprocessar`). Mesma convenção de /api/app/:
 *                       o middleware libera, o handler decide.
 *
 * Observações:
 *  - /api/status NÃO é health check — é o CRUD de colunas do Kanban
 *    (POST/PUT/DELETE), então fica PROTEGIDO.
 *  - /api/test-db NÃO está aqui de propósito — fica bloqueado pelo gate e
 *    ainda é desativado em produção no próprio handler.
 */
const API_PUBLICA: string[] = [
  "/api/auth/login",
  // Logout precisa aceitar token EXPIRADO: é exatamente quando a sessão morre
  // por inatividade que queremos registrar quem expirou. O handler só audita e
  // apaga o cookie — não concede nada.
  "/api/auth/logout",
  "/api/app/",
  "/api/blog/",
  "/api/blog",
  "/api/cambio",
  "/api/paises",
  // Listados um a um, NÃO por prefixo "/api/cron/": um cron novo nasce
  // bloqueado e só entra aqui por decisão consciente, depois de conferir que
  // o handler se auto-verifica. Prefixo isentaria automaticamente uma rota
  // futura que esquecesse desse gate.
  "/api/cron/cambio",
  "/api/cron/registral",
  // ── ENTRARAM EM 21/08, DEPOIS DE TRÊS MESES SEM RODAR ────────────────────
  //
  // O desenho acima está certo — cron novo nasce bloqueado — e foi justamente ele
  // que pegou o erro: `saude`, `avisos-prazo` e `reconciliar-fases` foram agendados
  // no `vercel.json` e NUNCA entraram aqui. A Vercel os chamava no horário e o
  // middleware devolvia 401, todas as vezes, em silêncio. O diagnóstico automático
  // estava parado desde 2 de agosto; os avisos de prazo nunca saíram; o
  // reconciliador de fases, que existe para o processo não ficar estacionado, nunca
  // varreu nada.
  //
  // Os três se auto-verificam (`x-vercel-cron`, `CRON_SECRET` ou operador com
  // permissão de gerenciamento) — conferido um a um antes de listar. E
  // `scripts/guard-crons-alcancaveis.test.ts` passou a cobrar que todo cron do
  // `vercel.json` esteja aqui, para não haver uma quarta vez.
  "/api/cron/saude",
  "/api/cron/avisos-prazo",
  "/api/cron/reconciliar-fases",
  "/api/cron/outbox",
]

function isApiPublica(pathname: string): boolean {
  if (pathname === "/api/whatsapp/webhook") return true

  return API_PUBLICA.some(
    (p) => pathname === p || pathname.startsWith(p)
  )
}

// ============================================================================
// CORS — exclusivo de /api/app/*
//
// O app mobile roda nativo em iOS/Android, onde CORS simplesmente não existe:
// é regra de navegador. Este bloco existe por um motivo só — destravar o modo
// web do Expo (`npx expo start`, localhost:8081) durante o desenvolvimento e
// contra deploys de preview.
//
// Em PRODUÇÃO a allowlist fica vazia de propósito: nenhum navegador deve
// chamar /api/app/*, e o app instalado não é afetado por isso.
//
// Não emitimos `Access-Control-Allow-Credentials`: o app autentica por
// `Authorization: Bearer` e não manda cookie cross-origin.
// ============================================================================

/**
 * Origens fixas liberadas, separadas por vírgula (ver APP_CORS_ORIGENS no
 * .env.example). Deve ficar vazia em produção.
 */
const CORS_ORIGENS_FIXAS: string[] = (process.env.APP_CORS_ORIGENS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean)

/**
 * Ancorada nas duas pontas de propósito: sem o `^...$` isto casaria com
 * `https://localhost.dominio-do-atacante.com`. A porta é livre porque o Expo
 * escolhe outra sozinho quando a 8081 já está ocupada.
 */
const CORS_LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

/**
 * VERCEL_ENV, e não NODE_ENV: na Vercel o NODE_ENV vale "production" também
 * nos deploys de preview, o que fecharia o CORS justamente onde queremos
 * testar. Rodando local, VERCEL_ENV é undefined e já cai no ramo de dev.
 */
function ehProducao(): boolean {
  return process.env.VERCEL_ENV === "production"
}

function ehRotaDoApp(pathname: string): boolean {
  return pathname.startsWith("/api/app/")
}

/**
 * Devolve a origem a ecoar de volta, ou null se ela não for reconhecida.
 * Nunca devolvemos "*": estas rotas servem PII e são autenticadas por Bearer.
 * Origem desconhecida sai SEM header CORS (o navegador bloqueia) em vez de com
 * erro — responder diferente viraria um jeito de sondar a allowlist.
 */
function origemPermitida(origem: string | null): string | null {
  if (!origem) return null
  if (CORS_ORIGENS_FIXAS.includes(origem)) return origem
  if (!ehProducao() && CORS_LOCALHOST.test(origem)) return origem
  return null
}

/**
 * `Vary: Origin` vai SEMPRE, inclusive quando a origem foi recusada: sem ele
 * a CDN pode guardar a resposta com o Allow-Origin de um site e entregá-la a
 * outro. Preserva um Vary já existente em vez de sobrescrever.
 */
function aplicarCors(resposta: NextResponse, origem: string | null): NextResponse {
  const varyAtual = resposta.headers.get("Vary")

  if (!varyAtual) {
    resposta.headers.set("Vary", "Origin")
  } else if (
    !varyAtual.split(",").some((v) => v.trim().toLowerCase() === "origin")
  ) {
    resposta.headers.set("Vary", `${varyAtual}, Origin`)
  }

  if (origem) {
    resposta.headers.set("Access-Control-Allow-Origin", origem)
  }

  return resposta
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ===== 0) Preflight de CORS (/api/app/* apenas) =====
  // Fica ANTES do gate de autenticação porque o navegador não manda o header
  // Authorization no preflight — exigir token aqui quebraria toda chamada
  // cross-origin. Hoje /api/app/ está em API_PUBLICA e passaria de qualquer
  // forma, mas deixar este short-circuit primeiro mantém o preflight de pé
  // caso essa entrada saia da allowlist um dia.
  if (request.method === "OPTIONS" && ehRotaDoApp(pathname)) {
    const origem = origemPermitida(request.headers.get("origin"))
    const resposta = new NextResponse(null, { status: 204 })

    if (origem) {
      resposta.headers.set(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
      )
      resposta.headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
      )
      // 24h: evita um preflight a cada chamada durante o desenvolvimento.
      resposta.headers.set("Access-Control-Max-Age", "86400")
    }

    return aplicarCors(resposta, origem)
  }

  const token =
    request.cookies.get("authToken")?.value ||
    request.headers.get("authorization")?.replace("Bearer ", "")

  // ===== 1) Gate de API (deny-by-default) =====
  if (pathname.startsWith("/api/")) {
    if (isApiPublica(pathname)) {
      const resposta = NextResponse.next()

      // Só /api/app/* ganha CORS. As demais rotas públicas (blog, câmbio,
      // países, cron) seguem exatamente como antes.
      if (ehRotaDoApp(pathname)) {
        return aplicarCors(resposta, origemPermitida(request.headers.get("origin")))
      }

      return resposta
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

// lib/operacional/erro-indisponibilidade-prisma.ts
// ============================================================================
// CONTENÇÃO/TIMEOUT DO PRISMA → 503 DIAGNOSTICÁVEL, não 500 genérico.
//
// Etapa 2, fechamento (26/09/2026) — diagnóstico da Etapa 1: `minhaFila` →
// `visaoGerencial` já levou ~3,1s numa chamada real; sob contenção do pool
// de conexões (`connection_limit`, ver `lib/prisma.ts`), o Prisma estoura com
// P2024 (pool timeout) ou, na conexão em si, P1001/P1008/P1017 — nenhum dos
// três é bug de código, e nenhum tinha tratamento: virava um 500 sem corpo
// estruturado, indistinguível de um erro real de programação.
//
// A DIFERENÇA QUE IMPORTA: isto é INDISPONIBILIDADE TRANSITÓRIA (o banco
// está sob carga, a próxima tentativa tende a funcionar), não um erro de
// negócio. 503 + `retryAfterMs` diz isso explicitamente pro chamador — o
// front decide retentar, em vez de mostrar "não foi possível carregar" na
// primeira tentativa.
// ============================================================================
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"

/**
 * P2024 — pool de conexões esgotado (o `PrismaClientKnownRequestError` que a
 * contenção de fato produz, confirmado no diagnóstico da Etapa 1).
 * P1001/P1008/P1017 — banco inalcançável/timeout de conexão/conexão
 * encerrada (`PrismaClientInitializationError`) — mesma classe de sintoma,
 * outra camada da mesma causa (contenção/instabilidade transitória).
 */
const CODIGOS_INDISPONIBILIDADE = new Set(["P2024", "P1001", "P1008", "P1017"])

/** O código Prisma do erro, de QUALQUER uma das duas classes que o carregam — `null` se não for erro Prisma conhecido. */
export function codigoPrismaDoErro(e: unknown): string | null {
  if (e instanceof Prisma.PrismaClientKnownRequestError) return e.code
  if (e instanceof Prisma.PrismaClientInitializationError) return e.errorCode ?? null
  return null
}

/**
 * `null` = não é indisponibilidade transitória — quem chama deixa o erro
 * propagar (é um bug de verdade, não contenção). Não-`null` = a resposta
 * pronta pra devolver: 503, corpo `{ erro: 'indisponivel', retryAfterMs }`.
 */
export function respostaSeIndisponibilidade(e: unknown): NextResponse | null {
  const codigo = codigoPrismaDoErro(e)
  if (!codigo || !CODIGOS_INDISPONIBILIDADE.has(codigo)) return null
  return NextResponse.json({ erro: "indisponivel", retryAfterMs: 1500 }, { status: 503 })
}

/** Roda `fn`, loga a duração (sempre — sucesso ou erro), sem mudar o resultado nem a exceção. */
export async function comDuracaoLogada<T>(rotulo: string, fn: () => Promise<T>): Promise<T> {
  const inicio = Date.now()
  try {
    return await fn()
  } finally {
    console.log(`[perf] ${rotulo} ${Date.now() - inicio}ms`)
  }
}

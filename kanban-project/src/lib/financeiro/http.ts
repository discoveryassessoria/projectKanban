// src/lib/financeiro/http.ts
// ============================================================================
// F7.6 — Acesso HTTP do Financeiro no cliente: UMA definição, não 20 cópias.
// Antes cada tela redeclarava `authHeaders` localmente; qualquer mudança de
// autenticação exigiria caçar arquivo por arquivo (e uma cópia esquecida vira
// uma tela que fala com a API sem token).
// ============================================================================

/** Token do usuário logado (client-side). null no servidor/SSR. */
export function authToken(): string | null {
  return typeof window !== "undefined" ? localStorage.getItem("authToken") : null
}

/** Cabeçalhos de autenticação da API (Bearer). `extra` compõe sem sobrescrever. */
export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const t = authToken()
  return { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(extra ?? {}) }
}

/** Cabeçalhos para requisições com corpo JSON. */
export function jsonHeaders(extra?: Record<string, string>): Record<string, string> {
  return authHeaders({ "Content-Type": "application/json", ...(extra ?? {}) })
}

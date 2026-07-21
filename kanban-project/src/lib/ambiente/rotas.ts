// src/lib/ambiente/rotas.ts
//
// Decisão PURA de "esta rota é corporativa/neutra?" — testável sem DOM.
// Financeiro Geral (/financas, /financeiro) é neutro; Financeiro DO PROCESSO é
// aba dentro da view do processo (mesma rota) e herda o país de lá.

export const ROTAS_NEUTRAS = [
  "/financas",
  "/financeiro",
  "/settings",
  "/administrator",
  "/dashboard",
  "/activities",
  "/mensagens",
] as const

export function rotaEhNeutra(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return ROTAS_NEUTRAS.some((r) => pathname === r || pathname.startsWith(r + "/"))
}

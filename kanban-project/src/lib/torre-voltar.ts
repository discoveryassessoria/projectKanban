// src/lib/torre-voltar.ts
// ============================================================================
// "← VOLTAR" DAS PÁGINAS DA TORRE — a regra, pura (testável sem navegador).
//   Há página anterior DENTRO do sistema → volta nela (history.back: mesma aba da Torre e mesmos filtros, que vivem na URL).
//   Não há (link direto, aba nova, veio de fora) → vai para a Torre, aba Processos.
// "Dentro do sistema" = mesma origem e não é a tela de login.
// ============================================================================

export const DESTINO_SEM_ANTERIOR = "/torre?aba=processos"

export interface EntradaDoHistorico {
  /** A entrada ANTERIOR do histórico (Navigation API), quando o navegador a expõe; `null` = não há; `undefined` = o navegador não expõe. */
  anteriorUrl?: string | null
  origem: string
  referrer: string
  tamanhoHistorico: number
}

function ehDoSistema(url: string, origem: string): boolean {
  try {
    const u = new URL(url, origem)
    return u.origin === origem && !u.pathname.startsWith("/login")
  } catch { return false }
}

export function haPaginaAnteriorNoSistema(e: EntradaDoHistorico): boolean {
  if (e.anteriorUrl !== undefined) return e.anteriorUrl !== null && ehDoSistema(e.anteriorUrl, e.origem)
  // Sem Navigation API: só confia no que o navegador garante — veio de uma página do sistema e há mais de uma entrada.
  return e.tamanhoHistorico > 1 && !!e.referrer && ehDoSistema(e.referrer, e.origem)
}

/** Lê o navegador (cliente) e entrega os dados da regra. */
export function lerEntradaDoHistorico(): EntradaDoHistorico {
  const nav = (window as unknown as { navigation?: { currentEntry?: { index: number } | null; entries: () => Array<{ url: string | null }> } }).navigation
  let anteriorUrl: string | null | undefined
  if (nav?.currentEntry && typeof nav.entries === "function") {
    const entradas = nav.entries()
    const anterior = entradas[nav.currentEntry.index - 1]
    anteriorUrl = anterior?.url ?? null
  }
  return { anteriorUrl, origem: window.location.origin, referrer: document.referrer, tamanhoHistorico: window.history.length }
}

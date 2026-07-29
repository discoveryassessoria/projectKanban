import * as React from "react"

const MOBILE_BREAKPOINT = 768

/**
 * O viewport é estado EXTERNO ao React (vive no browser), então quem o lê é
 * `useSyncExternalStore` — a API feita exatamente para isso. A versão anterior
 * assinava o matchMedia num efeito e chamava setState no corpo dele, o que
 * dispara um render em cascata logo depois da montagem.
 *
 * Semântica preservada: no servidor — e no primeiro render da hidratação — o
 * retorno é `false`, igual ao `!!undefined` de antes. Daí em diante o valor vem
 * direto do browser, sem passar por estado do React.
 */
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function assinar(aoMudar: () => void): () => void {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", aoMudar)
  return () => mql.removeEventListener("change", aoMudar)
}

const lerDoCliente = (): boolean => window.innerWidth < MOBILE_BREAKPOINT
const lerDoServidor = (): boolean => false

export function useIsMobile(): boolean {
  return React.useSyncExternalStore(assinar, lerDoCliente, lerDoServidor)
}

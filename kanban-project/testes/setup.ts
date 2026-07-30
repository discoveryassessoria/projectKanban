// testes/setup.ts
// ============================================================================
// Setup dos testes de componente. Roda antes de cada arquivo.
//
// Três coisas que o jsdom não traz e que a base usa de verdade:
//  • matchMedia — `useIsMobile` assina isso;
//  • BroadcastChannel — o gerente de sessão sincroniza abas por ele;
//  • ResizeObserver / scrollTo — componentes de UI e listas usam.
//
// Sem esses stubs o teste falharia por falta de ambiente, não por defeito do
// componente — e um teste que falha por motivo errado é pior que nenhum teste.
// ============================================================================
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// ── matchMedia ──────────────────────────────────────────────────────────────
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

// ── BroadcastChannel ────────────────────────────────────────────────────────
if (typeof globalThis.BroadcastChannel === 'undefined') {
  class CanalFalso {
    onmessage: ((e: MessageEvent) => void) | null = null
    constructor(public name: string) {}
    postMessage(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
    close(): void {}
  }
  Object.defineProperty(globalThis, 'BroadcastChannel', { writable: true, value: CanalFalso })
}

// ── observadores e scroll ───────────────────────────────────────────────────
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ObservadorFalso {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { writable: true, value: ObservadorFalso })
}
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {}
}

beforeEach(() => {
  // Cada teste começa com storage limpo: sessão e preferências não vazam entre
  // casos, senão um teste passa por causa do estado deixado pelo anterior.
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

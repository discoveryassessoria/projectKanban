// src/lib/cliente/index.ts
// ============================================================================
// ABSTRAÇÕES OFICIAIS DE CLIENTE — detecção de cliente, leitura de
// localStorage e valores dependentes do navegador.
//
// O problema que resolvem: no Next, o primeiro render também acontece no
// SERVIDOR, onde `window` e `localStorage` não existem. A base inteira contornava
// isso com `const [mounted, setMounted] = useState(false)` + um efeito que
// chamava `setMounted(true)` — o que funciona, mas custa um render em cascata em
// TODA tela e é exatamente o que o React Compiler aponta.
//
// A correção certa não é mover o acesso ao browser para o servidor (isso
// reintroduziria o mismatch), e sim usar `useSyncExternalStore`, a API que o
// React criou para ler estado EXTERNO: ela recebe um `getServerSnapshot`
// separado, então servidor e primeira hidratação retornam o mesmo valor por
// contrato — sem divergência e sem render extra.
//
// Padrão já validado em `hooks/use-mobile.ts`.
// ============================================================================
"use client"

import { useCallback, useSyncExternalStore } from "react"

// ── detecção de cliente ─────────────────────────────────────────────────────
// Store constante: o "está no cliente" nunca muda depois de montado, então a
// assinatura é um no-op e o snapshot é literal. Substitui `mounted`.
const semAssinatura = () => () => {}
const noCliente = () => true
const noServidor = () => false

/**
 * `true` no cliente, `false` no servidor e no primeiro render da hidratação —
 * idêntico ao que o par `useState(false)` + `setMounted(true)` entregava, porém
 * sem o render em cascata.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(semAssinatura, noCliente, noServidor)
}

// ── localStorage ────────────────────────────────────────────────────────────
// Uma chave de storage é estado externo compartilhado: outra aba pode mudá-la.
// Por isso a assinatura escuta `storage` (mudança vinda de outra aba) e um
// evento próprio (mudança nesta aba, que o browser não notifica sozinho).

const EVENTO_LOCAL = "discovery:localstorage"
const ouvintes = new Set<() => void>()

function assinarStorage(aoMudar: () => void): () => void {
  ouvintes.add(aoMudar)
  const externo = () => aoMudar()
  window.addEventListener("storage", externo)
  window.addEventListener(EVENTO_LOCAL, externo)
  return () => {
    ouvintes.delete(aoMudar)
    window.removeEventListener("storage", externo)
    window.removeEventListener(EVENTO_LOCAL, externo)
  }
}

/** Escreve e avisa esta aba (o evento `storage` nativo só chega nas OUTRAS). */
export function gravarLocal(chave: string, valor: unknown): void {
  if (typeof window === "undefined") return
  try {
    if (valor === undefined || valor === null) localStorage.removeItem(chave)
    else localStorage.setItem(chave, typeof valor === "string" ? valor : JSON.stringify(valor))
  } catch {
    /* storage cheio ou bloqueado: não é motivo para derrubar a tela */
  }
  window.dispatchEvent(new Event(EVENTO_LOCAL))
}

/**
 * Lê uma chave crua do localStorage. `null` no servidor e no primeiro render —
 * quem consome trata a ausência, que é o estado honesto naquele instante.
 */
export function useLocalStorage(chave: string): string | null {
  const ler = useCallback(() => {
    try { return localStorage.getItem(chave) } catch { return null }
  }, [chave])
  const lerServidor = useCallback(() => null, [])
  return useSyncExternalStore(assinarStorage, ler, lerServidor)
}

/**
 * Lê uma chave JSON. Devolve `null` quando ausente, ilegível ou no servidor —
 * nunca lança: uma credencial corrompida não pode quebrar a renderização.
 *
 * O cache por texto bruto existe porque `useSyncExternalStore` exige snapshot
 * ESTÁVEL: sem ele, cada leitura devolveria um objeto novo e o React entraria em
 * laço de render.
 */
const cacheJson = new Map<string, { bruto: string | null; valor: unknown }>()

export function useJsonLocalStorage<T>(chave: string): T | null {
  const bruto = useLocalStorage(chave)
  const cacheado = cacheJson.get(chave)
  if (cacheado && cacheado.bruto === bruto) return cacheado.valor as T | null
  let valor: unknown = null
  if (bruto != null) {
    try { valor = JSON.parse(bruto) } catch { valor = null }
  }
  cacheJson.set(chave, { bruto, valor })
  return valor as T | null
}

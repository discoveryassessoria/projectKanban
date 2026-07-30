"use client"

// src/hooks/use-dados-headerbar.ts
// ============================================================================
// Dados que TODA tela com HeaderBar precisa: o usuário logado, a lista de
// processos e a lista de árvores (alimentam a busca e os seletores do topo).
//
// Existe porque esse mesmo bloco estava copiado em ~6 páginas, cada cópia com o
// seu próprio efeito de montagem. Ponto único:
//   • usuário  → estado EXTERNO (localStorage) lido com useSyncExternalStore,
//                sem cópia para o estado do React num efeito;
//   • listas   → busca na montagem com AbortController; o estado só é escrito na
//                continuação da promessa, nunca de forma síncrona no efeito.
// ============================================================================
import { useEffect, useMemo, useState, useSyncExternalStore } from "react"

export interface UsuarioHeaderBar {
  nome: string
  email?: string
  tipo?: string
}

const USUARIO_PADRAO: UsuarioHeaderBar = { nome: "Usuário" }

function subscreverUsuario(aoMudar: () => void) {
  window.addEventListener("storage", aoMudar)
  return () => window.removeEventListener("storage", aoMudar)
}
const lerUsuarioNoCliente = () => localStorage.getItem("user")
const lerUsuarioNoServidor = () => null

function autorizacao(): HeadersInit | undefined {
  const token = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return token ? { Authorization: `Bearer ${token}` } : undefined
}

/** Usuário logado, lido do armazenamento do navegador (reage a login/logout). */
export function useUsuarioLogado(): UsuarioHeaderBar {
  const bruto = useSyncExternalStore(subscreverUsuario, lerUsuarioNoCliente, lerUsuarioNoServidor)
  return useMemo(() => {
    if (!bruto) return USUARIO_PADRAO
    try {
      const u = JSON.parse(bruto) as UsuarioHeaderBar
      return u?.nome ? u : USUARIO_PADRAO
    } catch {
      return USUARIO_PADRAO
    }
  }, [bruto])
}

/** Processos e árvores usados pelo HeaderBar (busca global e seletores). */
export function useDadosHeaderBar() {
  const user = useUsuarioLogado()
  const [processos, setProcessos] = useState<any[]>([])
  const [arvores, setArvores] = useState<any[]>([])

  useEffect(() => {
    const ac = new AbortController()
    const cabecalhos = autorizacao()
    fetch("/api/processos", { signal: ac.signal, headers: cabecalhos })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!ac.signal.aborted) setProcessos(d?.processos ?? []) })
      .catch(() => {})
    fetch("/api/arvore", { signal: ac.signal, headers: cabecalhos })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!ac.signal.aborted) setArvores(Array.isArray(d) ? d : []) })
      .catch(() => {})
    return () => ac.abort()
  }, [])

  return { user, processos, arvores }
}

/**
 * `true` só depois da hidratação no cliente. Substitui o par
 * `useState(false)` + `useEffect(() => setMounted(true), [])`: o valor vem do
 * próprio React (snapshot de servidor × cliente), sem estado nem efeito.
 */
export function useMontadoNoCliente(): boolean {
  return useSyncExternalStore(semAssinatura, () => true, () => false)
}
const semAssinatura = () => () => {}

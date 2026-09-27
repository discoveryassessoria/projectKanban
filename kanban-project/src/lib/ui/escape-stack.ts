// src/lib/ui/escape-stack.ts
// ============================================================================
// SSOT do fechamento por Esc entre overlays empilhados (achado real, 27/09/2026:
// drawer de documento aberto DENTRO do modal do processo — cada um registrava o
// PRÓPRIO `document.addEventListener("keydown", ...)`, cego ao outro. Um Esc só
// disparava os dois listeners de uma vez: fechava o drawer E o modal do processo
// juntos, porque ambos escutam o MESMO `document`, sem hierarquia de bubbling
// entre si para `stopPropagation` resolver).
//
// A pilha é a ordem de ABERTURA: quem abriu por último é quem o Esc fecha. Os
// overlays mais antigos na pilha nem veem o evento.
// ============================================================================

import { useEffect, useRef } from "react"

type Handler = () => void

const pilha: Handler[] = []
let ouvindo = false

function aoTecla(e: KeyboardEvent) {
  if (e.key !== "Escape") return
  const topo = pilha[pilha.length - 1]
  if (!topo) return
  e.stopPropagation()
  topo()
}

/**
 * Registra um overlay aberto (drawer, modal). Chamar dentro de um `useEffect`
 * quando `isOpen` é true, e usar o retorno como função de limpeza:
 *
 *   useEffect(() => {
 *     if (!isOpen) return
 *     return registrarEscape(onClose)
 *   }, [isOpen, onClose])
 *
 * ATENÇÃO à dependência: se `onClose` no array de deps for uma arrow function
 * inline (o padrão comum: `onClose={() => setX(null)}`), toda vez que o PAI
 * re-renderiza — por qualquer motivo, não só abrir/fechar — o efeito
 * desregistra e registra de novo, e o overlay pula pro TOPO da pilha mesmo
 * sem ter sido reaberto. Um modal externo que só re-renderiza (ex.: polling)
 * pode assim "roubar" o topo de um drawer aberto depois dele. Prefira
 * `useFecharComEsc` abaixo, que já resolve isso.
 */
export function registrarEscape(onClose: Handler): () => void {
  if (!ouvindo) {
    document.addEventListener("keydown", aoTecla, true)
    ouvindo = true
  }
  pilha.push(onClose)
  return () => {
    const i = pilha.lastIndexOf(onClose)
    if (i !== -1) pilha.splice(i, 1)
    if (pilha.length === 0 && ouvindo) {
      document.removeEventListener("keydown", aoTecla, true)
      ouvindo = false
    }
  }
}

/**
 * Versão em hook de `registrarEscape`, IMUNE à identidade de `onClose`: só
 * (des)registra na pilha quando `isOpen` muda — nunca por causa de um
 * `onClose` recriado a cada render do pai. A versão mais recente de `onClose`
 * sempre é a chamada, via ref.
 */
export function useFecharComEsc(isOpen: boolean, onClose: Handler): void {
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })
  useEffect(() => {
    if (!isOpen) return
    return registrarEscape(() => onCloseRef.current())
  }, [isOpen])
}

// src/lib/financeiro/useChaveIdempotencia.ts
// ============================================================================
// CHAVE DE IDEMPOTÊNCIA da tela — uma definição, cinco telas.
//
// Semântica preservada: a chave nasce UMA vez por sessão da tela (montagem) e
// vale para todas as tentativas daquela operação. Duplo-clique e retry reusam a
// mesma chave e o servidor reaproveita a requisição em vez de duplicar o
// lançamento; reabrir a tela gera uma chave nova, porque aí é outra operação.
//
// Por que não gerar direto no `useRef(...)`: o argumento do useRef é avaliado a
// CADA render, então `Date.now()`/`Math.random()` rodavam durante o render —
// impuro por definição, e o primeiro a quebrar sob render concorrente. Aqui a
// geração acontece no efeito de montagem; a leitura só ocorre no submit, que é
// sempre posterior.
// ============================================================================
"use client"

import { useEffect, useRef } from "react"

function gerar(prefixo: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefixo}-${crypto.randomUUID()}`
  }
  return `${prefixo}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Devolve um ref com a chave de idempotência da sessão da tela.
 * `prefixo` identifica a operação (ex.: `custo-42`), o que torna a chave legível
 * na auditoria sem revelar nada sensível.
 */
export function useChaveIdempotencia(prefixo: string): { readonly current: string } {
  const chave = useRef<string>("")
  useEffect(() => {
    // Só na montagem (ou quando a operação alvo muda): manter a mesma chave é o
    // que faz o retry ser idempotente.
    chave.current = gerar(prefixo)
  }, [prefixo])
  return chave
}

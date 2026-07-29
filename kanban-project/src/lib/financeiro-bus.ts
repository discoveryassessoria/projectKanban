// src/lib/financeiro-bus.ts
// ============================================================================
// Camada ÚNICA de revalidação financeira (o projeto não usa react-query). Toda
// mutação financeira (criar/editar/redistribuir/registrar pagamento/aplicar crédito/
// renegociar/estornar/cancelar/arquivar) emite UM evento; qualquer componente
// montado (Receitas, participantes, cobranças, pagamentos, extrato, timeline,
// dashboard, Central) se inscreve e recarrega — sem recarregar a página.
// Puro browser CustomEvent → funciona entre componentes irmãos e independentes.
// ============================================================================
"use client"

import { useCallback, useEffect, useMemo } from "react"

export type EscopoFinanceiro =
  | "receita" | "participantes" | "cobrancas" | "pagamentos" | "creditos"
  | "extrato" | "timeline" | "dashboard" | "central" | "tudo"

const EVENTO = "discovery:financeiro-mutado"

export interface MutacaoFinanceira {
  escopos: EscopoFinanceiro[]
  processoId?: number | null
  obrigacaoId?: number | null
  receitaRef?: string | null
  em: number
}

/** Emite uma mutação financeira — todos os assinantes revalidam. */
export function emitirMutacaoFinanceira(m?: Partial<MutacaoFinanceira>): void {
  if (typeof window === "undefined") return
  const detail: MutacaoFinanceira = {
    escopos: m?.escopos && m.escopos.length ? m.escopos : ["tudo"],
    processoId: m?.processoId ?? null, obrigacaoId: m?.obrigacaoId ?? null, receitaRef: m?.receitaRef ?? null,
    em: Date.now(),
  }
  window.dispatchEvent(new CustomEvent<MutacaoFinanceira>(EVENTO, { detail }))
}

/**
 * Assina revalidações financeiras. `escopos` filtra o que interessa ao componente
 * (default: qualquer). `onMutacao` é chamado a cada mutação relevante — o componente
 * refaz suas queries (fetch) ali. Não recarrega a página.
 */
export function useRevalidacaoFinanceira(
  onMutacao: (m: MutacaoFinanceira) => void,
  escopos: EscopoFinanceiro[] = ["tudo"],
): void {
  // `escopos` chega como array literal na maioria das chamadas, então sua
  // identidade muda a cada render do assinante. A CHAVE textual é o que
  // realmente identifica o filtro — extraída para uma variável (o array de deps
  // precisa ser estaticamente verificável) e memoizada.
  const chaveEscopos = escopos.join(",")
  const escoposEstaveis = useMemo(() => chaveEscopos.split(",") as EscopoFinanceiro[], [chaveEscopos])

  // O handler é reconstruído só quando o filtro ou o callback mudam de verdade.
  const handler = useCallback((ev: Event) => {
    const m = (ev as CustomEvent<MutacaoFinanceira>).detail
    if (!m) return
    const querTudo = escoposEstaveis.includes("tudo")
    const relevante = querTudo || m.escopos.includes("tudo") || m.escopos.some((e) => escoposEstaveis.includes(e))
    if (relevante) onMutacao(m)
  }, [onMutacao, escoposEstaveis])

  useEffect(() => {
    window.addEventListener(EVENTO, handler)
    return () => window.removeEventListener(EVENTO, handler)
  }, [handler])
}

/** Núcleo PURO (testável sem DOM): decide se uma mutação é relevante p/ um assinante. */
export function mutacaoRelevante(mutacaoEscopos: EscopoFinanceiro[], assinanteEscopos: EscopoFinanceiro[]): boolean {
  if (assinanteEscopos.includes("tudo") || mutacaoEscopos.includes("tudo")) return true
  return mutacaoEscopos.some((e) => assinanteEscopos.includes(e))
}

"use client"

// src/components/arvore/inteligencia/use-analise-arvore.ts
// ============================================================================
// LIGA O MOTOR GENEALÓGICO À ÁRVORE — sem tocar no desenho dela.
//
// O motor (`src/lib/genealogia/`) já existia inteiro e estava ÓRFÃO: nenhum
// componente o chamava. Ele produz, numa passada só e de forma determinística,
// tudo o que a árvore sabe sobre si mesma — conflitos, duplicidades, lacunas,
// linha de cidadania, gargalos, qualidade e próximos passos.
//
// Este hook é a única ponte. Ele NÃO renderiza nada: o cálculo é invisível, e
// quem decide mostrar é o painel. Por isso ligar o motor não altera um pixel do
// layout aprovado — o desenho da árvore continua sendo o mesmo componente.
//
// Sobre memoização: numa árvore grande a análise é cara e não pode rodar a cada
// render (arrastar um nó dispara dezenas). Ela é memoizada pelas entradas — e
// isso funciona porque `pessoas` vem do cache da camada de dados, que mantém a
// MESMA referência enquanto a resposta não muda, e `unioes` é derivada dela.
// ============================================================================

import { useMemo } from "react"
import { analisarArvore, type OpcoesAnalise } from "@/src/lib/genealogia/motor/analisar"
import { montarIndice, type ItemIndice } from "@/src/lib/genealogia/motor/busca"
import type { AnaliseArvore, PaisAlvo, PessoaEntrada, UniaoEntrada } from "@/src/lib/genealogia/motor/tipos"
import type { GrafoGenealogico } from "@/src/lib/genealogia/motor/grafo"

export interface ResultadoAnalise {
  analise: (AnaliseArvore & { grafo: GrafoGenealogico }) | null
  /** Índice pronto para a busca por comando (⌘K). */
  indice: ItemIndice[]
  /** true quando não há dados suficientes para analisar. */
  vazia: boolean
}

const SEM_INDICE: ItemIndice[] = []

/**
 * Mapeia o país do processo para o alvo de cidadania que o motor entende.
 * Fora da lista devolve `null` — o motor então analisa sem linha de cidadania,
 * em vez de inventar uma.
 */
export function paisAlvoDe(pais: string | null | undefined): PaisAlvo | null {
  const chave = (pais ?? "").toUpperCase()
  if (chave === "ITALIA" || chave === "ITÁLIA") return "ITALIA"
  if (chave === "PORTUGAL") return "PORTUGAL"
  if (chave === "ESPANHA") return "ESPANHA"
  if (chave === "ALEMANHA") return "ALEMANHA"
  return null
}

export function useAnaliseArvore(
  pessoas: PessoaEntrada[],
  unioes: UniaoEntrada[],
  opcoes: OpcoesAnalise = {},
): ResultadoAnalise {
  const paisAlvo = opcoes.paisAlvo ?? null
  const raizId = opcoes.raizId ?? null

  const analise = useMemo(
    () => (pessoas.length ? analisarArvore(pessoas, unioes, { paisAlvo, raizId }) : null),
    [pessoas, unioes, paisAlvo, raizId],
  )

  const indice = useMemo(
    () => (analise ? montarIndice(analise.grafo, analise) : SEM_INDICE),
    [analise],
  )

  return { analise, indice, vazia: analise === null }
}

// src/lib/genealogia/motor/qualidade.ts
//
// QUALIDADE DA ÁRVORE — as quatro porcentagens (Qualidade, Completude,
// Consistência, Cobertura) E a conta de cada uma, numa passada só.
//
// Antes, `analisar.ts` calculava os quatro números e jogava a conta fora: a tela
// mostrava "Completude 72%" sem poder dizer o que faltava. Agora cada medida sai
// como `{ valor, itens[] }` — o `valor` é produzido a partir dos MESMOS itens que
// a tela lista, então número e decomposição não podem divergir. Não existe uma
// segunda função "para explicar": explicar é ler `itens`.
//
// As fórmulas são as de sempre (nenhuma mudou de comportamento):
//   Completude   média da completude de cada pessoa; quem está na linha pesa 4×.
//   Consistência 100 − (Σ pontos de conflito/duplicidade ÷ nº de pessoas × 8).
//   Cobertura    % das pessoas da linha de cidadania com ficha ≥ 80% completa.
//   Qualidade    40% completude + 30% consistência + 30% cobertura.
//
// PURO: sem rede, sem relógio, sem banco.

import type { GrafoGenealogico } from "./grafo"
import {
  ORDEM_SEVERIDADE,
  type AnalisePessoa,
  type Insight,
  type ItemDecomposicao,
  type Medida,
  type QualidadeArvore,
} from "./tipos"
import { nomeCompleto } from "./texto"

/** Peso de quem está na linha de cidadania na média de completude. */
export const PESO_LINHA_NA_COMPLETUDE = 4
/** Ficha a partir da qual a pessoa conta como "resolvida" na cobertura da linha. */
export const LIMIAR_COBERTURA = 80
/** Multiplicador da penalidade de consistência. */
export const FATOR_CONSISTENCIA = 8
export const PESOS_QUALIDADE = { completude: 0.4, consistencia: 0.3, cobertura: 0.3 } as const
/** Teto de itens listados por medida (o total real continua em `totalItens`). */
export const TETO_ITENS_MEDIDA = 100

function cortar(itens: ItemDecomposicao[]): { itens: ItemDecomposicao[]; omitidos: number } {
  if (itens.length <= TETO_ITENS_MEDIDA) return { itens, omitidos: 0 }
  return { itens: itens.slice(0, TETO_ITENS_MEDIDA), omitidos: itens.length - TETO_ITENS_MEDIDA }
}

function nomeDe(grafo: GrafoGenealogico, id: number): string {
  const p = grafo.pessoa(id)
  return p ? nomeCompleto(p) : `#${id}`
}

function camposQueFaltam(a: AnalisePessoa) {
  return a.campos
    .filter((c) => !c.preenchido)
    .map((c) => ({ chave: c.chave, rotulo: c.rotulo, peso: c.peso }))
}

function textoFaltam(campos: Array<{ rotulo: string; peso: number }>): string {
  return campos.map((c) => `${c.rotulo} (peso ${c.peso})`).join(", ")
}

export function calcularQualidade(
  grafo: GrafoGenealogico,
  porPessoa: Map<number, AnalisePessoa>,
  /** A lista COMPLETA de achados (antes do corte de exibição). */
  insights: Insight[],
  linha: number[],
  geracoes: Map<number, number>,
): QualidadeArvore {
  const total = grafo.pessoas.length
  const conflitos = insights.filter((i) => i.categoria === "conflito").length
  const duplicidades = insights.filter((i) => i.categoria === "duplicidade").length
  const lacunas = insights.filter((i) => i.categoria === "lacuna").length

  // ── Completude ────────────────────────────────────────────────────────────
  let somaNum = 0
  let somaDen = 0
  let somaPeso = 0
  const itensCompletude: ItemDecomposicao[] = []
  porPessoa.forEach((a) => {
    const w = a.naLinhaCidadania ? PESO_LINHA_NA_COMPLETUDE : 1
    const num = a.completude * w
    const den = 100 * w
    somaNum += num
    somaDen += den
    somaPeso += w
    if (a.completude >= 100) return
    const faltam = camposQueFaltam(a)
    itensCompletude.push({
      chave: `completude-${a.pessoaId}`,
      rotulo: nomeDe(grafo, a.pessoaId),
      pessoaId: a.pessoaId,
      pessoaIds: [a.pessoaId],
      numerador: num,
      denominador: den,
      pesa: true,
      detalhe:
        `Ficha ${a.completude}% completa${a.naLinhaCidadania ? " · na linha de cidadania (peso 4)" : " (peso 1)"}.` +
        (faltam.length ? ` Faltam: ${textoFaltam(faltam)}.` : ""),
      campos: faltam,
    })
  })
  itensCompletude.sort(
    (x, y) => y.denominador! - y.numerador - (x.denominador! - x.numerador) || x.pessoaId! - y.pessoaId!,
  )
  const completude = somaPeso ? Math.round(somaNum / somaPeso) : 0
  const cCompletude = cortar(itensCompletude)

  // ── Consistência ──────────────────────────────────────────────────────────
  const itensConsistencia: ItemDecomposicao[] = insights
    .filter((i) => i.categoria === "conflito" || i.categoria === "duplicidade")
    .map((i) => {
      const pontos = ORDEM_SEVERIDADE[i.severidade] * 2
      return {
        chave: i.id,
        rotulo: i.titulo,
        pessoaId: i.pessoaIds[0] ?? null,
        pessoaIds: [...i.pessoaIds],
        numerador: pontos,
        denominador: null,
        pesa: true,
        detalhe: `${pontos} ponto(s) (${i.severidade}). ${i.explicacao}`,
        campos: [],
      }
    })
    .sort((x, y) => y.numerador - x.numerador || x.chave.localeCompare(y.chave))
  const penalidade = itensConsistencia.reduce((acc, i) => acc + i.numerador, 0)
  const consistencia = Math.max(
    0,
    Math.round(100 - (total ? (penalidade / total) * FATOR_CONSISTENCIA : penalidade)),
  )
  const cConsistencia = cortar(itensConsistencia)

  // ── Cobertura da linha ────────────────────────────────────────────────────
  const itensCobertura: ItemDecomposicao[] = []
  let resolvidos = 0
  for (const id of linha) {
    const a = porPessoa.get(id)
    if (!a) continue
    const ok = a.completude >= LIMIAR_COBERTURA
    if (ok) resolvidos++
    const faltam = camposQueFaltam(a)
    itensCobertura.push({
      chave: `cobertura-${id}`,
      rotulo: nomeDe(grafo, id),
      pessoaId: id,
      pessoaIds: [id],
      numerador: ok ? 1 : 0,
      denominador: 1,
      pesa: !ok,
      detalhe: ok
        ? `Ficha ${a.completude}% completa — conta como resolvida (mínimo ${LIMIAR_COBERTURA}%).`
        : `Ficha ${a.completude}% completa — abaixo do mínimo de ${LIMIAR_COBERTURA}%.` +
          (faltam.length ? ` Faltam: ${textoFaltam(faltam)}.` : ""),
      campos: ok ? [] : faltam,
    })
  }
  // Quem pesa primeiro; dentro de cada grupo, a ordem da linha (requerente → dante causa).
  itensCobertura.sort((x, y) => Number(y.pesa) - Number(x.pesa))
  const coberturaLinha = linha.length ? Math.round((resolvidos / linha.length) * 100) : 0

  const geracoesMapeadas = geracoes.size
    ? Math.max(...[...geracoes.values()]) - Math.min(...[...geracoes.values()]) + 1
    : 0

  // ── Qualidade geral ───────────────────────────────────────────────────────
  const score = Math.round(
    completude * PESOS_QUALIDADE.completude +
      consistencia * PESOS_QUALIDADE.consistencia +
      coberturaLinha * PESOS_QUALIDADE.cobertura,
  )
  const componente = (
    chave: "completude" | "consistencia" | "cobertura",
    rotulo: string,
    valor: number,
  ): ItemDecomposicao => {
    const peso = PESOS_QUALIDADE[chave]
    return {
      chave,
      rotulo,
      pessoaId: null,
      pessoaIds: [],
      numerador: valor * peso,
      denominador: 100 * peso,
      pesa: valor < 100,
      detalhe: `${valor}% × peso de ${Math.round(peso * 100)}% = ${Math.round(valor * peso * 10) / 10} ponto(s) de ${Math.round(peso * 100)}.`,
      campos: [],
    }
  }
  const itensQualidade = [
    componente("completude", "Completude", completude),
    componente("consistencia", "Consistência", consistencia),
    componente("cobertura", "Cobertura da linha", coberturaLinha),
  ]

  const detalhe = {
    qualidade: {
      chave: "qualidade",
      rotulo: "Qualidade geral",
      valor: score,
      formula: "40% da Completude + 30% da Consistência + 30% da Cobertura da linha.",
      numerador: itensQualidade.reduce((s, i) => s + i.numerador, 0),
      denominador: 100,
      observacao: null,
      itens: itensQualidade,
      totalItens: itensQualidade.length,
      omitidos: 0,
    },
    completude: {
      chave: "completude",
      rotulo: "Completude",
      valor: completude,
      formula:
        "Média da completude de cada pessoa. Quem está na linha de cidadania pesa 4, as demais pesam 1. " +
        "A completude de uma pessoa é o peso dos campos preenchidos ÷ o peso dos campos que o papel dela exige.",
      numerador: somaNum,
      denominador: somaDen,
      observacao: null,
      itens: cCompletude.itens,
      totalItens: porPessoa.size,
      omitidos: cCompletude.omitidos,
    },
    consistencia: {
      chave: "consistencia",
      rotulo: "Consistência",
      valor: consistencia,
      formula:
        `100 − (soma dos pontos de conflito e duplicidade ÷ nº de pessoas × ${FATOR_CONSISTENCIA}). ` +
        "Cada achado vale 2 × o grau da severidade (crítico 5, alto 4, médio 3, baixo 2, info 1).",
      numerador: penalidade,
      denominador: total,
      observacao: null,
      itens: cConsistencia.itens,
      totalItens: itensConsistencia.length,
      omitidos: cConsistencia.omitidos,
    },
    cobertura: {
      chave: "cobertura",
      rotulo: "Cobertura da linha",
      valor: coberturaLinha,
      formula: `Pessoas da linha de cidadania com ficha ≥ ${LIMIAR_COBERTURA}% completa ÷ pessoas da linha.`,
      numerador: resolvidos,
      denominador: linha.length,
      observacao: linha.length
        ? null
        : "Não há linha de cidadania identificada (falta país-alvo ou ascendente com nacionalidade registrada), então não há o que cobrir.",
      itens: itensCobertura,
      totalItens: linha.length,
      omitidos: 0,
    },
  } satisfies QualidadeArvore["detalhe"]

  return {
    score,
    completude,
    consistencia,
    coberturaLinha,
    totalPessoas: total,
    totalUnioes: grafo.unioes.length,
    geracoesMapeadas,
    conflitos,
    duplicidades,
    lacunas,
    detalhe,
  }
}

export type { Medida }

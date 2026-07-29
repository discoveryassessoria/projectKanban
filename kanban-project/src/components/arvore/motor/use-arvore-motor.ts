// src/components/arvore/motor/use-arvore-motor.ts
//
// Ponte única entre os dados da árvore e tudo que a tela desenha.
//
// Todo cálculo pesado (índice do grafo, análise, layout, índice de busca) mora
// aqui, memoizado pela identidade dos dados. A tela nunca recalcula por hover,
// por seleção ou por movimento de câmera — só quando os DADOS mudam ou quando
// o operador troca de modo. É essa separação que mantém o canvas fluido.

import { useMemo } from "react"
import { analisarArvore } from "@/src/lib/genealogia/motor/analisar"
import { montarIndice, type ItemIndice } from "@/src/lib/genealogia/motor/busca"
import { calcularLayout, calcularVisiveis, type Orientacao, type ResultadoLayout } from "@/src/lib/genealogia/layout/layout-familiar"
import type { AnaliseArvore, PaisAlvo, PessoaEntrada, UniaoEntrada } from "@/src/lib/genealogia/motor/tipos"
import type { GrafoGenealogico } from "@/src/lib/genealogia/motor/grafo"
import {
  aplicarRamos,
  comFronteira,
  fronteiraGeracional,
  ramosVazios,
  type EstadoRamos,
} from "@/src/lib/genealogia/navegacao/ramos"
import { montarFacetas, type Facetas } from "@/src/lib/genealogia/motor/facetas"
import { FOLGAS } from "./tokens"
import type { PessoaArvore, UniaoArvore } from "../types"

export type ModoVisualizacao = "completa" | "ascendentes" | "descendentes" | "linha" | "familia" | "ramo"

export interface EntradaMotor {
  pessoas: PessoaArvore[]
  unioes: UniaoArvore[]
  pessoaPrincipalId: number | null
  paisProcesso?: string | null
  modo: ModoVisualizacao
  focoId: number | null
  orientacao: Orientacao
  /** Dimensão do card, já derivada das opções de exibição. */
  larguraNo: number
  alturaNo: number
  posicoesManuais?: Record<string, { x: number; y: number }> | null
  /** Ramos recolhidos pelo operador. */
  ramos?: EstadoRamos | null
  /**
   * Quantas gerações de ascendentes a leitura mostra antes de pedir "+".
   * 0 ou ausente = sem limite (usado pelas vistas que não são de ascendência).
   */
  limiteGeracoes?: number
}

export interface SaidaMotor {
  grafo: GrafoGenealogico
  analise: AnaliseArvore
  layout: ResultadoLayout
  indiceBusca: ItemIndice[]
  paisAlvo: PaisAlvo | null
  /** Ids escondidos pelo modo atual — usados pelo aviso "N pessoas ocultas". */
  ocultos: number[]
  /** Por pessoa recolhida: quantos parentes ficaram dobrados atrás dela. */
  escondidosPorPessoa: Map<number, { ascendentes: number; descendentes: number }>
  /** Quem está no limite de gerações — o card ganha "+" para revelar mais. */
  fronteira: Set<number>
  /** Conjunto efetivamente desenhado (modo de foco + colapso). */
  visiveis: Set<number> | null
  /** Facetas de sobrenome e localidade — índice navegável da árvore. */
  facetas: Facetas
}

const PAISES_VALIDOS: PaisAlvo[] = ["ITALIA", "PORTUGAL", "ESPANHA", "ALEMANHA"]

function normalizarPais(v: string | null | undefined): PaisAlvo | null {
  if (!v) return null
  const up = v.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  return PAISES_VALIDOS.find((p) => up.includes(p)) ?? null
}

/** Converte o shape da UI para o shape do motor sem cópia profunda supérflua. */
function paraEntrada(p: PessoaArvore): PessoaEntrada {
  return p as unknown as PessoaEntrada
}
function uniaoParaEntrada(u: UniaoArvore): UniaoEntrada {
  return u as unknown as UniaoEntrada
}

export function useArvoreMotor(entrada: EntradaMotor): SaidaMotor {
  const {
    pessoas,
    unioes,
    pessoaPrincipalId,
    paisProcesso,
    modo,
    focoId,
    orientacao,
    larguraNo,
    alturaNo,
    posicoesManuais,
    ramos,
    limiteGeracoes,
  } = entrada

  const paisAlvo = useMemo(() => normalizarPais(paisProcesso), [paisProcesso])

  // 1. Análise — depende só dos dados. Hover e pan não passam por aqui.
  const analiseCompleta = useMemo(() => {
    return analisarArvore(
      pessoas.map(paraEntrada),
      unioes.map(uniaoParaEntrada),
      { paisAlvo, raizId: pessoaPrincipalId },
    )
  }, [pessoas, unioes, paisAlvo, pessoaPrincipalId])

  const grafo = analiseCompleta.grafo

  // 2. Índice de busca — derivado da análise, também estável.
  const indiceBusca = useMemo(() => montarIndice(grafo, analiseCompleta), [grafo, analiseCompleta])

  // 3. Conjunto visível pelo modo de foco.
  const visiveisModo = useMemo(
    () => calcularVisiveis(grafo, modo, focoId ?? pessoaPrincipalId, analiseCompleta.linhaCidadania),
    [grafo, modo, focoId, pessoaPrincipalId, analiseCompleta.linhaCidadania],
  )

  const ramosAtuais = ramos ?? ramosVazios()
  const raizLeitura = focoId ?? pessoaPrincipalId ?? analiseCompleta.linhaCidadania[0] ?? null

  // 3a. Fronteira geracional — a árvore abre num número legível de gerações e
  //     cresce onde o operador pede, em vez de despejar tudo de uma vez.
  const fronteira = useMemo(
    () =>
      limiteGeracoes && limiteGeracoes > 0
        ? fronteiraGeracional(grafo, raizLeitura, limiteGeracoes, ramosAtuais.expandidos)
        : new Set<number>(),
    [grafo, raizLeitura, limiteGeracoes, ramosAtuais.expandidos],
  )

  // 3b. Colapso de ramos — aplicado DEPOIS do modo, nunca antes: o modo define
  //     o universo, o colapso dobra pedaços dentro dele. Para o alcance, a
  //     fronteira geracional é apenas mais uma dobra.
  const comRamos = useMemo(
    () =>
      aplicarRamos(grafo, visiveisModo, comFronteira(ramosAtuais, fronteira), [
        focoId,
        pessoaPrincipalId,
        analiseCompleta.linhaCidadania[0] ?? null,
      ]),
    [grafo, visiveisModo, ramosAtuais, fronteira, focoId, pessoaPrincipalId, analiseCompleta.linhaCidadania],
  )
  const visiveis = comRamos.visiveis

  // 4. Layout — recalcula quando muda modo, orientação, densidade ou colapso.
  const layout = useMemo(
    () =>
      calcularLayout(grafo, {
        orientacao,
        densidade: "confortavel",
        larguraNo,
        alturaNo,
        visiveis,
        raizId: pessoaPrincipalId,
        posicoesManuais,
        folgas: FOLGAS[orientacao],
      }),
    [grafo, orientacao, larguraNo, alturaNo, visiveis, pessoaPrincipalId, posicoesManuais],
  )

  const ocultos = useMemo(() => {
    if (!visiveis) return []
    return grafo.pessoas.filter((p) => !visiveis.has(p.id)).map((p) => p.id)
  }, [grafo, visiveis])

  // 5. Facetas (sobrenomes/localidades) — derivadas do grafo, não do visível:
  //    o índice serve para ENCONTRAR o que está fora da tela.
  const facetas = useMemo(
    () => montarFacetas(grafo, { linhaCidadania: analiseCompleta.linhaCidadania }),
    [grafo, analiseCompleta.linhaCidadania],
  )

  return {
    grafo,
    analise: analiseCompleta,
    layout,
    indiceBusca,
    paisAlvo,
    ocultos,
    escondidosPorPessoa: comRamos.escondidosPorPessoa,
    fronteira,
    visiveis,
    facetas,
  }
}

/**
 * Conjuntos de destaque de uma pessoa: ascendência e descendência.
 * Separado do hook principal porque muda a cada seleção — e seleção não pode
 * custar um recálculo de layout.
 */
export function useDestaque(
  grafo: GrafoGenealogico,
  pessoaId: number | null,
  linhaCidadania: number[],
) {
  return useMemo(() => {
    if (pessoaId == null) {
      return {
        ascendentes: new Set<number>(),
        descendentes: new Set<number>(),
        relacionados: new Set<number>(),
        linha: new Set(linhaCidadania),
      }
    }
    const ascendentes = grafo.ancestrais(pessoaId)
    const descendentes = grafo.descendentes(pessoaId)
    const relacionados = new Set<number>([pessoaId])
    ascendentes.forEach((id) => relacionados.add(id))
    descendentes.forEach((id) => relacionados.add(id))
    grafo.conjugesIds(pessoaId).forEach((id) => relacionados.add(id))
    grafo.irmaosIds(pessoaId).forEach((id) => relacionados.add(id))
    return { ascendentes, descendentes, relacionados, linha: new Set(linhaCidadania) }
  }, [grafo, pessoaId, linhaCidadania])
}

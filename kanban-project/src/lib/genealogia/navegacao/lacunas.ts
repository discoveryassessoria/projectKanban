// src/lib/genealogia/navegacao/lacunas.ts
//
// O QUE UM PAI/MÃE AUSENTE SIGNIFICA — determinístico, nunca genérico.
//
// Os cartões "Adicionar Pai" e "Adicionar Mãe" eram placeholders mudos: a mesma
// caixa tracejada tanto para o pai do requerente (sem o qual não existe linha de
// transmissão) quanto para a mãe de um primo de terceiro grau (que não muda
// nada). O operador tinha de descobrir sozinho qual dos dois importava.
//
// Este módulo decide, a partir da topologia, em qual dos casos aquele slot está.
// Ele NÃO inventa impacto: cada rótulo abaixo é consequência de um fato do grafo
// — a pessoa está na cadeia de alguém, ancora quem está, ou não toca nenhuma
// linha. Onde o grafo não sustenta uma afirmação forte, o texto é fraco de
// propósito.
//
// PURO: sem rede, sem banco, sem relógio.

import type { GrafoGenealogico } from "../motor/grafo"
import type { MapaLinhagens } from "../motor/linhagens"
import { nomeCompleto } from "../motor/texto"

export type RelevanciaLacuna = "continua_linha" | "ancora_linha" | "fora_da_linha"

export interface LacunaParental {
  pessoaId: number
  papel: "pai" | "mae"
  /** Cabeçalho curto: "Pai ainda não cadastrado". */
  titulo: string
  /** Uma frase dizendo o que essa ausência custa. Sempre derivada do grafo. */
  explicacao: string
  relevancia: RelevanciaLacuna
  /** Requerentes cuja linha passa (ou passaria) por aqui. */
  requerentesAfetados: number[]
}

const ROTULO: Record<"pai" | "mae", string> = {
  pai: "Pai ainda não cadastrado",
  mae: "Mãe ainda não cadastrada",
}

/**
 * O que significa faltar pai/mãe nesta pessoa.
 *
 * Três situações, nesta ordem de força:
 *
 * 1. CONTINUA A LINHA — a pessoa está na cadeia de transmissão de alguém e é o
 *    TOPO dela. Sem esse ascendente a linha simplesmente para. É o caso mais
 *    forte, e o único em que se pode dizer "necessário para continuar".
 *
 * 2. ANCORA A LINHA — a pessoa está numa cadeia, mas não no topo (já tem o outro
 *    genitor mapeado acima). O ascendente que falta é complementar: ajuda o
 *    dossiê, não destrava a linha.
 *
 * 3. FORA DA LINHA — a pessoa não participa de nenhuma transmissão. Cadastrar o
 *    ascendente é legítimo, mas não muda cidadania nenhuma hoje. Dizer o
 *    contrário seria inventar urgência.
 */
export function analisarLacunaParental(
  g: GrafoGenealogico,
  mapa: MapaLinhagens,
  pessoaId: number,
  papel: "pai" | "mae",
): LacunaParental {
  const pessoa = g.pessoa(pessoaId)
  const nome = pessoa ? nomeCompleto(pessoa) : `#${pessoaId}`
  const requerentesAfetados = mapa.compartilhadas.get(pessoaId) ?? []
  const base = { pessoaId, papel, titulo: ROTULO[papel], requerentesAfetados }

  if (requerentesAfetados.length === 0) {
    return {
      ...base,
      relevancia: "fora_da_linha",
      explicacao: "Este ramo não participa da transmissão de cidadania hoje.",
    }
  }

  // Topo da cadeia = ninguém acima dele nela. É o que define "a linha para aqui".
  const ehTopo = requerentesAfetados.some((reqId) => {
    const l = mapa.porRequerente.get(reqId)
    if (!l) return false
    return l.cadeia[l.cadeia.length - 1] === pessoaId
  })

  const nomesReq = requerentesAfetados
    .map((id) => {
      const p = g.pessoa(id)
      return p ? nomeCompleto(p) : `#${id}`
    })
    .slice(0, 3)

  if (ehTopo) {
    return {
      ...base,
      relevancia: "continua_linha",
      explicacao:
        requerentesAfetados.length === 1
          ? `Necessário para continuar a linhagem de ${nomesReq[0]} — hoje a linha para em ${nome}.`
          : `Necessário para continuar ${requerentesAfetados.length} linhagens (${nomesReq.join(", ")}) — todas param em ${nome}.`,
    }
  }

  return {
    ...base,
    relevancia: "ancora_linha",
    explicacao:
      requerentesAfetados.length === 1
        ? `${nome} está na linhagem de ${nomesReq[0]}; este ascendente completa o dossiê, mas a linha já segue pelo outro genitor.`
        : `${nome} está em ${requerentesAfetados.length} linhagens; este ascendente completa o dossiê, mas a linha já segue pelo outro genitor.`,
  }
}

/**
 * Todas as lacunas parentais que o canvas desenha.
 *
 * O canvas só cria slot "+pai/+mãe" para a pessoa raiz (profundidade 0), então
 * esta função recebe os ids que ele realmente vai desenhar — em vez de varrer a
 * árvore inteira e devolver explicação para slot que ninguém vê.
 */
export function analisarLacunas(
  g: GrafoGenealogico,
  mapa: MapaLinhagens,
  pessoaIds: readonly number[],
): Map<string, LacunaParental> {
  const saida = new Map<string, LacunaParental>()
  for (const id of pessoaIds) {
    const p = g.pessoa(id)
    if (!p) continue
    if (p.paiId == null || !g.existe(p.paiId)) {
      saida.set(`pai-${id}`, analisarLacunaParental(g, mapa, id, "pai"))
    }
    if (p.maeId == null || !g.existe(p.maeId)) {
      saida.set(`mae-${id}`, analisarLacunaParental(g, mapa, id, "mae"))
    }
  }
  return saida
}

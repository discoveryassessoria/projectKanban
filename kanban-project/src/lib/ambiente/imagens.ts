// src/lib/ambiente/imagens.ts
//
// BIBLIOTECA DE IMAGENS DO AMBIENTE.
//
// Não existe "uma imagem por país". Existe uma biblioteca por país e por
// ENQUADRAMENTO, e a escolha é determinística por processo — o mesmo processo
// reabre sempre na mesma cidade (a câmera não pula), processos diferentes do
// mesmo país caem em cidades diferentes (o sistema parece vivo).
//
// Enquanto a biblioteca estiver vazia, o fundo é um céu procedural gerado a
// partir da paleta do país. Basta soltar os JPGs em
//   public/ambiente/<pais>/<enquadramento>/
// e rodar o build: o prebuild regenera manifest.generated.ts sozinho.

import type { PaisKey } from "./paises"
import { MANIFESTO_AMBIENTE } from "./manifest.generated"

export type Enquadramento = "aerea" | "cidade" | "consulado" | "paisagem"

export const ENQUADRAMENTOS: Enquadramento[] = ["aerea", "cidade", "consulado", "paisagem"]

/**
 * A fase escolhe o enquadramento. Casamento por substring da key/label da fase
 * porque as fases são configuráveis no Gerenciamento — não podemos depender de
 * uma lista fixa de códigos.
 */
export function enquadramentoDaFase(fase: string | null | undefined): Enquadramento {
  const f = (fase ?? "").toLowerCase()
  if (!f) return "cidade"
  if (f.includes("genealog") || f.includes("arvore") || f.includes("árvore") || f.includes("pesquisa")) return "aerea"
  if (f.includes("consul") || f.includes("protocol") || f.includes("agendamento")) return "consulado"
  if (f.includes("entrega") || f.includes("final") || f.includes("conclu") || f.includes("cidadania")) return "paisagem"
  // Emissão documental, tradução, apostilamento, retificação — a cidade.
  return "cidade"
}

/** Hash estável e barato. Mesmo processo → mesmo índice, entre sessões e devices. */
function hash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

export interface ImagemAmbiente {
  url: string
  /** Slug do arquivo, sem extensão — serve de legenda ("veneza" → Veneza). */
  cidade: string
}

/**
 * Escolhe a imagem do processo. Retorna null quando a biblioteca daquele país
 * ainda está vazia — nesse caso o AmbienteFundo cai no céu procedural.
 *
 * Cai para outro enquadramento do mesmo país antes de desistir: é melhor mostrar
 * uma cidade italiana do que perder a Itália porque falta a foto aérea.
 */
export function resolverImagem(
  pais: PaisKey,
  enquadramento: Enquadramento,
  seed: string | number,
): ImagemAmbiente | null {
  const doPais = MANIFESTO_AMBIENTE[pais]
  if (!doPais) return null

  const ordem: Enquadramento[] = [enquadramento, ...ENQUADRAMENTOS.filter(e => e !== enquadramento)]
  for (const enq of ordem) {
    const lista = doPais[enq]
    if (lista && lista.length > 0) {
      const idx = hash(`${pais}:${enq}:${seed}`) % lista.length
      const arquivo = lista[idx]
      return {
        url: `/ambiente/${pais}/${enq}/${arquivo}`,
        cidade: arquivo.replace(/\.[^.]+$/, "").replace(/[-_]\d+$/, ""),
      }
    }
  }
  return null
}

/** "florenca" → "Florença" quando conhecido; senão capitaliza o slug. */
const NOMES_BONITOS: Record<string, string> = {
  florenca: "Florença", vaticano: "Vaticano", veneza: "Veneza", roma: "Roma",
  toscana: "Toscana", alpes: "Alpes", barcelona: "Barcelona", madrid: "Madrid",
  sevilha: "Sevilha", toledo: "Toledo", valencia: "Valência", lisboa: "Lisboa",
  porto: "Porto", sintra: "Sintra", braga: "Braga", acores: "Açores",
  paris: "Paris", lyon: "Lyon", estrasburgo: "Estrasburgo", nice: "Nice",
  bordeaux: "Bordeaux", berlim: "Berlim", munique: "Munique", colonia: "Colônia",
  varsovia: "Varsóvia", cracovia: "Cracóvia", viena: "Viena",
}

export function nomeDaCidade(slug: string): string {
  return NOMES_BONITOS[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1)
}

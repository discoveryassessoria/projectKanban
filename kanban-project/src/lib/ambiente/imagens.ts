// src/lib/ambiente/imagens.ts
//
// BIBLIOTECA DE IMAGENS DO AMBIENTE (pura, sem React).
//
// Biblioteca por país e por ENQUADRAMENTO. Enquanto vazia, o fundo é um céu
// procedural da paleta. Solte JPGs em public/ambiente/<pais>/<enquadramento>/
// e rode o build: o prebuild regenera manifest.generated.ts. A ausência de
// pasta/arquivo NÃO pode quebrar o build.

import type { PaisKey } from "./paises"
import { MANIFESTO_AMBIENTE } from "./manifest.generated"

export type Enquadramento = "aerea" | "cidade" | "consulado" | "paisagem"
export const ENQUADRAMENTOS: Enquadramento[] = ["aerea", "cidade", "consulado", "paisagem"]

/** object-position por enquadramento — evita rostos/monumentos cortados. */
export const POSICAO_ENQUADRAMENTO: Record<Enquadramento, string> = {
  aerea: "50% 40%",
  cidade: "50% 55%",
  consulado: "50% 45%",
  paisagem: "50% 60%",
}

export function enquadramentoDaFase(fase: string | null | undefined): Enquadramento {
  const f = (fase ?? "").toLowerCase()
  if (!f) return "cidade"
  if (f.includes("genealog") || f.includes("arvore") || f.includes("árvore") || f.includes("pesquisa")) return "aerea"
  if (f.includes("consul") || f.includes("protocol") || f.includes("agendamento")) return "consulado"
  if (f.includes("entrega") || f.includes("final") || f.includes("conclu") || f.includes("cidadania")) return "paisagem"
  return "cidade"
}

/** Hash estável (FNV-1a). Mesmo processo → mesma imagem entre sessões. */
export function hashSeed(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

export interface ImagemAmbiente {
  url: string
  cidade: string
  posicao: string
}

/**
 * Lista ORDENADA de imagens do país (para rotação), começando pelo
 * enquadramento pedido e caindo nos demais. Vazia = usar céu procedural.
 */
export function imagensDoPais(pais: PaisKey, enquadramento: Enquadramento): ImagemAmbiente[] {
  const doPais = MANIFESTO_AMBIENTE[pais]
  if (!doPais) return []
  const ordem: Enquadramento[] = [enquadramento, ...ENQUADRAMENTOS.filter((e) => e !== enquadramento)]
  const out: ImagemAmbiente[] = []
  for (const enq of ordem) {
    const lista = doPais[enq]
    if (!lista) continue
    for (const arquivo of lista) {
      out.push({
        url: `/ambiente/${pais}/${enq}/${arquivo}`,
        cidade: arquivo.replace(/\.[^.]+$/, "").replace(/[-_]\d+$/, ""),
        posicao: POSICAO_ENQUADRAMENTO[enq],
      })
    }
  }
  return out
}

/** Imagem determinística por seed (mesmo processo → mesma cidade). null = vazio. */
export function resolverImagem(
  pais: PaisKey,
  enquadramento: Enquadramento,
  seed: string | number,
): ImagemAmbiente | null {
  const lista = imagensDoPais(pais, enquadramento)
  if (lista.length === 0) return null
  return lista[hashSeed(`${pais}:${enquadramento}:${seed}`) % lista.length]
}

const NOMES_BONITOS: Record<string, string> = {
  florenca: "Florença", vaticano: "Vaticano", veneza: "Veneza", roma: "Roma", toscana: "Toscana", alpes: "Alpes",
  barcelona: "Barcelona", madrid: "Madrid", sevilha: "Sevilha", toledo: "Toledo", valencia: "Valência",
  lisboa: "Lisboa", porto: "Porto", sintra: "Sintra", braga: "Braga", acores: "Açores",
  paris: "Paris", lyon: "Lyon", estrasburgo: "Estrasburgo", nice: "Nice", bordeaux: "Bordeaux",
  berlim: "Berlim", munique: "Munique", colonia: "Colônia", varsovia: "Varsóvia", cracovia: "Cracóvia", viena: "Viena",
}

export function nomeDaCidade(slug: string | null | undefined): string | null {
  if (!slug) return null
  return NOMES_BONITOS[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1)
}

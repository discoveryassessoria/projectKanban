// src/lib/genealogia/motor/parentesco.ts
//
// Nome do parentesco entre duas pessoas.
//
// Por que isto existe: numa árvore de cidadania o operador precisa responder
// "quem é essa pessoa em relação ao requerente?" dezenas de vezes por dia. Ler
// isso subindo o desenho com o olho é lento e erra. O cálculo é determinístico
// — distância até o ancestral comum mais próximo — e o rótulo é o vocabulário
// que o escritório já usa (bisavô, tio-avô, primo em 2º grau).
//
// Escopo: só relação de SANGUE derivada de filiação, mais cônjuge e afinidade
// de primeiro nível ("cônjuge do tio"). Não inventa grau que a genealogia
// brasileira não nomeia — acima do limite, devolve a forma descritiva.

import type { GrafoGenealogico } from "./grafo"

export interface Parentesco {
  /** Rótulo pronto para a tela ("bisavô", "prima em 2º grau"). */
  rotulo: string
  /** Gerações subindo de A até o ancestral comum. */
  acima: number
  /** Gerações descendo do ancestral comum até B. */
  abaixo: number
  /** true quando o vínculo passa por casamento, não por sangue. */
  porAfinidade: boolean
  /** Ancestral comum usado no cálculo (null para cônjuge/sem relação). */
  ancestralComumId: number | null
}

type Genero = "m" | "f" | "n"

function generoDe(g: GrafoGenealogico, id: number): Genero {
  const s = (g.pessoa(id)?.sexo || "").trim().toLowerCase()
  if (s.startsWith("m")) return "m"
  if (s.startsWith("f")) return "f"
  return "n"
}

/** Escolhe a forma conforme o gênero; "n" usa a forma neutra/composta. */
function flexionar(genero: Genero, masc: string, fem: string, neutro?: string): string {
  if (genero === "m") return masc
  if (genero === "f") return fem
  return neutro ?? `${masc}/${fem}`
}

const ASCENDENTES: Array<[string, string, string]> = [
  ["pai", "mãe", "pai/mãe"],
  ["avô", "avó", "avô/avó"],
  ["bisavô", "bisavó", "bisavô/bisavó"],
  ["trisavô", "trisavó", "trisavô/trisavó"],
  ["tetravô", "tetravó", "tetravô/tetravó"],
]

const DESCENDENTES: Array<[string, string, string]> = [
  ["filho", "filha", "filho(a)"],
  ["neto", "neta", "neto(a)"],
  ["bisneto", "bisneta", "bisneto(a)"],
  ["trineto", "trineta", "trineto(a)"],
  ["tetraneto", "tetraneta", "tetraneto(a)"],
]

function ordinal(n: number): string {
  return `${n}º`
}

function nomearAscendente(genero: Genero, grau: number): string {
  const t = ASCENDENTES[grau - 1]
  if (t) return flexionar(genero, t[0], t[1], t[2])
  // Acima do 5º grau a língua deixa de ter nome próprio: a forma honesta é a
  // descritiva, com a contagem explícita de "avôs".
  const avos = grau - 1
  return flexionar(genero, `ascendente (${avos}º avô)`, `ascendente (${avos}ª avó)`, `ascendente de ${grau}ª geração`)
}

function nomearDescendente(genero: Genero, grau: number): string {
  const t = DESCENDENTES[grau - 1]
  if (t) return flexionar(genero, t[0], t[1], t[2])
  const netos = grau - 1
  return flexionar(genero, `descendente (${netos}º neto)`, `descendente (${netos}ª neta)`, `descendente de ${grau}ª geração`)
}

/**
 * Ancestral comum mais próximo entre A e B, com as distâncias.
 * Percorre a ascendência de A guardando a distância, depois sobe a de B
 * procurando o primeiro encontro — o par (acima, abaixo) de menor soma.
 */
function ancestralComum(
  g: GrafoGenealogico,
  a: number,
  b: number,
): { id: number; acima: number; abaixo: number } | null {
  const distA = new Map<number, number>([[a, 0]])
  const fila: Array<[number, number]> = [[a, 0]]
  while (fila.length) {
    const [atual, d] = fila.shift()!
    if (d > 40) continue
    const p = g.pessoa(atual)
    if (!p) continue
    for (const pid of [p.paiId, p.maeId]) {
      if (pid == null || distA.has(pid) || !g.existe(pid)) continue
      distA.set(pid, d + 1)
      fila.push([pid, d + 1])
    }
  }

  let melhor: { id: number; acima: number; abaixo: number } | null = null
  const distB = new Map<number, number>([[b, 0]])
  const filaB: Array<[number, number]> = [[b, 0]]
  while (filaB.length) {
    const [atual, d] = filaB.shift()!
    if (d > 40) continue
    const acima = distA.get(atual)
    if (acima != null) {
      const candidato = { id: atual, acima, abaixo: d }
      if (!melhor || candidato.acima + candidato.abaixo < melhor.acima + melhor.abaixo) {
        melhor = candidato
      }
      // Não vale subir além do primeiro encontro nesse ramo.
      continue
    }
    const p = g.pessoa(atual)
    if (!p) continue
    for (const pid of [p.paiId, p.maeId]) {
      if (pid == null || distB.has(pid) || !g.existe(pid)) continue
      distB.set(pid, d + 1)
      filaB.push([pid, d + 1])
    }
  }
  return melhor
}

/**
 * Como B se relaciona com A. Lê-se "B é <rotulo> de A".
 * Ex.: calcular(g, requerente, bisavo).rotulo === "bisavô"
 */
export function calcularParentesco(
  g: GrafoGenealogico,
  de: number,
  para: number,
): Parentesco | null {
  if (de === para) {
    return { rotulo: "esta pessoa", acima: 0, abaixo: 0, porAfinidade: false, ancestralComumId: null }
  }
  if (!g.existe(de) || !g.existe(para)) return null

  const genero = generoDe(g, para)

  // 1. Cônjuge é vínculo direto, não passa por ancestral comum.
  if (g.conjugesIds(de).includes(para)) {
    return {
      rotulo: flexionar(genero, "marido", "esposa", "cônjuge"),
      acima: 0,
      abaixo: 0,
      porAfinidade: true,
      ancestralComumId: null,
    }
  }

  const sangue = ancestralComum(g, de, para)
  if (sangue) {
    const rotulo = nomearGrau(genero, sangue.acima, sangue.abaixo)
    if (rotulo) {
      return {
        rotulo,
        acima: sangue.acima,
        abaixo: sangue.abaixo,
        porAfinidade: false,
        ancestralComumId: sangue.id,
      }
    }
  }

  // 2. Afinidade de primeiro nível: cônjuge de alguém com parentesco de sangue.
  //    Sem isso, a esposa do tio aparece como "sem parentesco", que é falso
  //    para quem está montando a família.
  for (const conjugeId of g.conjugesIds(para)) {
    const viaConjuge = ancestralComum(g, de, conjugeId)
    if (!viaConjuge) continue
    const base = nomearGrau(generoDe(g, conjugeId), viaConjuge.acima, viaConjuge.abaixo)
    if (!base) continue
    return {
      rotulo: `cônjuge de ${base}`,
      acima: viaConjuge.acima,
      abaixo: viaConjuge.abaixo,
      porAfinidade: true,
      ancestralComumId: viaConjuge.id,
    }
  }

  return null
}

function nomearGrau(genero: Genero, acima: number, abaixo: number): string | null {
  if (acima === 0 && abaixo === 0) return null

  // linha reta ascendente
  if (abaixo === 0) return nomearAscendente(genero, acima)
  // linha reta descendente
  if (acima === 0) return nomearDescendente(genero, abaixo)

  // irmandade
  if (acima === 1 && abaixo === 1) return flexionar(genero, "irmão", "irmã", "irmão(ã)")

  // sobrinhos: sobe 1 (pais), desce N
  if (acima === 1) {
    const grau = abaixo - 1
    if (grau === 1) return flexionar(genero, "sobrinho", "sobrinha", "sobrinho(a)")
    if (grau === 2) return flexionar(genero, "sobrinho-neto", "sobrinha-neta", "sobrinho(a)-neto(a)")
    return flexionar(genero, `sobrinho de ${grau}º grau`, `sobrinha de ${grau}º grau`, `sobrinho(a) de ${grau}º grau`)
  }

  // tios: sobe N, desce 1
  if (abaixo === 1) {
    const grau = acima - 1
    if (grau === 1) return flexionar(genero, "tio", "tia", "tio(a)")
    if (grau === 2) return flexionar(genero, "tio-avô", "tia-avó", "tio(a)-avô(ó)")
    if (grau === 3) return flexionar(genero, "tio-bisavô", "tia-bisavó", "tio(a)-bisavô(ó)")
    return flexionar(genero, `tio de ${grau}º grau`, `tia de ${grau}º grau`, `tio(a) de ${grau}º grau`)
  }

  // primos: grau = menor distância - 1; "removido" = diferença entre as distâncias
  const grau = Math.min(acima, abaixo) - 1
  const removido = Math.abs(acima - abaixo)
  const base = flexionar(genero, "primo", "prima", "primo(a)")
  const comGrau = grau === 1 ? `${base} em 1º grau` : `${base} em ${ordinal(grau)} grau`
  if (removido === 0) return comGrau
  return `${comGrau} (${removido}ª geração de diferença)`
}

/**
 * Caminho genealógico entre duas pessoas, para a trilha de navegação.
 * Sobe de `de` até o ancestral comum e desce até `para`. Devolve os ids na
 * ordem de leitura, ou null quando não há relação de sangue.
 */
export function caminhoGenealogico(
  g: GrafoGenealogico,
  de: number,
  para: number,
): number[] | null {
  if (de === para) return [de]
  const comum = ancestralComum(g, de, para)
  if (!comum) return null

  const subida = g.caminhoAscendente(de, comum.id)
  const descida = g.caminhoAscendente(para, comum.id)
  if (!subida || !descida) return null

  // subida já vai de `de` até o comum; descida vai de `para` até o comum —
  // invertida (sem repetir o comum) completa o caminho.
  return [...subida, ...descida.slice(0, -1).reverse()]
}

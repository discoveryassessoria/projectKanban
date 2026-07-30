// src/components/arvore/motor/camada-conectores.tsx
//
// Conectores em SVG único, ortogonais, com barramento de irmãos.
//
// O desenho anterior usava uma aresta bezier por relação (pai→filho e mãe→filho
// separadas). Numa família de 5 filhos isso vira 10 curvas cruzando o mesmo
// espaço — o olho não consegue seguir nenhuma. A gramática correta, que
// genealogista já lê sem explicação, é:
//
//        [pai]══[mãe]        barra de união entre os cônjuges
//             ║
//        ╔════╬════╗          desce ao barramento e distribui
//     [f1]  [f2]  [f3]
//
// Uma linha por família, não uma por parentesco. Além de legível, é ~5× menos
// nós de SVG — o que importa quando há milhares de pessoas.

"use client"

import { memo } from "react"
import type { BarraUniao, LigacaoFilho } from "@/src/lib/genealogia/layout/layout-familiar"
import type { Orientacao } from "@/src/lib/genealogia/layout/layout-familiar"
import { TREE } from "./tokens"

export interface CamadaConectoresProps {
  barras: BarraUniao[]
  ligacoes: LigacaoFilho[]
  largura: number
  altura: number
  orientacao: Orientacao
  /** Pessoas em destaque — o conector acende junto. */
  destacados: Set<number>
  temDestaque: boolean
  corDestaque: string
}

const RAIO = 10

export const CamadaConectores = memo(function CamadaConectores({
  barras,
  ligacoes,
  largura,
  altura,
  orientacao,
  destacados,
  temDestaque,
  corDestaque,
}: CamadaConectoresProps) {
  const vertical = orientacao === "vertical"

  return (
    <svg
      width={largura}
      height={altura}
      viewBox={`0 0 ${largura} ${altura}`}
      className="pointer-events-none absolute left-0 top-0"
      data-conectores
      aria-hidden
      style={{ overflow: "visible" }}
    >
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {/* barras de união */}
        {barras.map((b) => {
          const aceso = temDestaque && (destacados.has(b.aId) || destacados.has(b.bId))
          const traco = {
            stroke: aceso ? corDestaque : TREE.conector,
            strokeWidth: aceso ? 2.4 : 1.6,
            opacity: temDestaque && !aceso ? 0.28 : 0.9,
            style: { transition: "stroke 220ms ease, opacity 220ms ease" },
          }
          // União de cônjuges não adjacentes (3ª união, cadeia longa): contorna
          // por fora em vez de riscar o card de quem está no meio.
          if (b.desviada) {
            return <path key={b.id} d={caminhoUniaoDesviada(b, vertical)} {...traco} />
          }
          return <line key={b.id} x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2} {...traco} />
        })}

        {/* ligações pais → filhos */}
        {ligacoes.map((l) => {
          const aceso =
            temDestaque &&
            (destacados.has(Number(l.filhoId)) || l.paiIds.some((p) => destacados.has(p)))
          return (
            <path
              key={l.id}
              d={vertical ? caminhoVertical(l) : caminhoHorizontal(l)}
              stroke={aceso ? corDestaque : TREE.conector}
              strokeWidth={aceso ? 2.4 : 1.6}
              opacity={temDestaque && !aceso ? 0.22 : 0.85}
              style={{ transition: "stroke 220ms ease, opacity 220ms ease" }}
            />
          )
        })}
      </g>
    </svg>
  )
})

/**
 * Barra de união entre cônjuges NÃO adjacentes.
 *
 * Desce (ou avança) até a linha da âncora, percorre por fora dos cards do meio
 * e sobe no outro cônjuge. O resultado se lê como um colchete ligando os dois —
 * o mesmo símbolo que a genealogia impressa usa para segunda e terceira união.
 */
function caminhoUniaoDesviada(b: BarraUniao, vertical: boolean): string {
  if (vertical) {
    const y = b.ancoraY
    const r = Math.min(RAIO, Math.abs(b.x2 - b.x1) / 2, Math.abs(y - b.y1) || RAIO)
    const sentido = b.x2 > b.x1 ? 1 : -1
    return [
      `M ${b.x1} ${b.y1}`,
      `L ${b.x1} ${y - r}`,
      `Q ${b.x1} ${y} ${b.x1 + r * sentido} ${y}`,
      `L ${b.x2 - r * sentido} ${y}`,
      `Q ${b.x2} ${y} ${b.x2} ${y - r}`,
      `L ${b.x2} ${b.y2}`,
    ].join(" ")
  }
  const x = b.ancoraX
  const r = Math.min(RAIO, Math.abs(b.y2 - b.y1) / 2, Math.abs(x - b.x1) || RAIO)
  const sentido = b.y2 > b.y1 ? 1 : -1
  return [
    `M ${b.x1} ${b.y1}`,
    `L ${x - r} ${b.y1}`,
    `Q ${x} ${b.y1} ${x} ${b.y1 + r * sentido}`,
    `L ${x} ${b.y2 - r * sentido}`,
    `Q ${x} ${b.y2} ${x - r} ${b.y2}`,
    `L ${b.x2} ${b.y2}`,
  ].join(" ")
}

/** Origem → barramento → destino, com cantos arredondados. */
function caminhoVertical(l: LigacaoFilho): string {
  const { ox, oy, dx, dy, barramento } = l
  const b = barramento
  if (Math.abs(dx - ox) < 1) return `M ${ox} ${oy} L ${dx} ${dy}`

  const sentido = dx > ox ? 1 : -1
  const r = Math.min(RAIO, Math.abs(dx - ox) / 2, Math.abs(b - oy), Math.abs(dy - b))
  return [
    `M ${ox} ${oy}`,
    `L ${ox} ${b - r}`,
    `Q ${ox} ${b} ${ox + r * sentido} ${b}`,
    `L ${dx - r * sentido} ${b}`,
    `Q ${dx} ${b} ${dx} ${b + r}`,
    `L ${dx} ${dy}`,
  ].join(" ")
}

function caminhoHorizontal(l: LigacaoFilho): string {
  const { ox, oy, dx, dy, barramento } = l
  const b = barramento
  if (Math.abs(dy - oy) < 1) return `M ${ox} ${oy} L ${dx} ${dy}`

  // O sentido em X importa: com os ascendentes à direita, a linha caminha da
  // direita para a esquerda. Um traçado que assumisse sempre "para a direita"
  // desenharia o cotovelo ao contrário e a curva voltaria sobre si mesma.
  const sy = dy > oy ? 1 : -1
  const sx = dx > ox ? 1 : -1
  const r = Math.min(RAIO, Math.abs(dy - oy) / 2, Math.abs(b - ox), Math.abs(dx - b))
  return [
    `M ${ox} ${oy}`,
    `L ${b - r * sx} ${oy}`,
    `Q ${b} ${oy} ${b} ${oy + r * sy}`,
    `L ${b} ${dy - r * sy}`,
    `Q ${b} ${dy} ${b + r * sx} ${dy}`,
    `L ${dx} ${dy}`,
  ].join(" ")
}

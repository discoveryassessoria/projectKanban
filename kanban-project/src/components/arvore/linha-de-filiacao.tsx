// src/components/arvore/linha-de-filiacao.tsx
// ============================================================================
// A LINHA PAI→FILHO da árvore (06/10/2026): desce do MEIO do casal, passa por uma barra horizontal e desce até o filho. Uma aresta por
// genitor (para continuar clicável/removível por vínculo): a aresta "tronco" desenha o caminho inteiro; a outra, só o toco do seu genitor
// até a âncora. A geometria vive em `arvore-camadas.ts` (pura, testada); aqui só se lê a posição VIVA dos cartões (acompanha o arrasto).
// ============================================================================
"use client"

import { BaseEdge, useStore, type EdgeProps, type ReactFlowState } from "reactflow"
import { caminhoDeFiliacao, saidaDoRetangulo, type Disposicao, type Retangulo } from "@/src/lib/genealogia/layout/arvore-camadas"

export interface DadosDeFiliacao {
  disposicao: Disposicao
  largura: number
  altura: number
  /** Id do nó do OUTRO genitor (quando os dois são conhecidos). */
  outroId: string | null
  /** Esta aresta desenha o caminho inteiro (a do pai, ou da mãe quando só ela existe). */
  tronco: boolean
}

const retanguloDe = (s: ReactFlowState, id: string, largura: number, altura: number): Retangulo | null => {
  const n = s.nodeInternals.get(id)
  if (!n) return null
  const p = n.positionAbsolute ?? n.position
  return { x: p.x, y: p.y, w: n.width ?? largura, h: n.height ?? altura }
}

const poligonalParaCaminho = (pts: Array<{ x: number; y: number }>): string => pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")

export function LinhaDeFiliacao({ id, source, target, data, style, interactionWidth }: EdgeProps<DadosDeFiliacao>) {
  const larg = data?.largura ?? 160, alt = data?.altura ?? 120
  const filho = useStore((s) => retanguloDe(s, source, larg, alt), igual)
  const genitor = useStore((s) => retanguloDe(s, target, larg, alt), igual)
  const outro = useStore((s) => (data?.outroId ? retanguloDe(s, data.outroId, larg, alt) : null), igual)
  if (!data || !filho || !genitor) return null

  const pais = outro ? [genitor, outro] : [genitor]
  const { ancora, poligonal } = caminhoDeFiliacao(data.disposicao, pais, filho)
  const toco = saidaDoRetangulo(genitor, ancora)
  const pontos = data.tronco ? [toco, ...poligonal] : [toco, ancora]
  return <BaseEdge id={id} path={poligonalParaCaminho(pontos)} style={{ ...style, fill: "none", strokeLinejoin: "round" }} interactionWidth={interactionWidth ?? 14} />
}

const igual = (a: Retangulo | null, b: Retangulo | null): boolean =>
  a === b || (a != null && b != null && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h)

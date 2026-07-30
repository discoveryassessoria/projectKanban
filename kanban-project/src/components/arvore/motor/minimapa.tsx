// src/components/arvore/motor/minimapa.tsx
//
// MINIMAPA — o mapa de bolso da árvore, no canto inferior esquerdo.
//
// Houve um momento em que este módulo o tratou como "mobília de editor de nós"
// e o proibiu por teste. Estava errado, e a referência mostra por quê: numa
// árvore que passa muito da largura da tela, o operador perde a noção de ONDE
// está — não existe barra de rolagem para dar essa pista, porque o gesto é pan
// livre. O minimapa é o único elemento que responde "estou nesta parte da
// família" sem obrigar a afastar o zoom e perder a leitura.
//
// O que ele NÃO é: um segundo canvas. Ele não desenha cards, não tem seleção
// própria, não tem hover por pessoa e não recalcula nada — recebe o retângulo
// de cada nó já pronto do layout e pinta blocos de 2 a 4 pixels. O custo por
// quadro é uma multiplicação por nó, e ele só repinta quando a câmera se move
// além do limiar que o canvas já publica.

"use client"

import { memo, useCallback, useMemo, useRef, useState } from "react"
import { Map as IconeMapa, X } from "lucide-react"
import type { ResultadoLayout } from "@/src/lib/genealogia/layout/layout-familiar"
import { corGenero, EASE, MINIMAPA, TREE } from "./tokens"

export interface AreaMundo {
  x: number
  y: number
  largura: number
  altura: number
}

export interface MinimapaProps {
  layout: ResultadoLayout
  /** Sexo por pessoa — o mapa distingue os blocos como a árvore distingue. */
  sexoPorId: Map<number, string | null | undefined>
  /** Retângulo visível, em coordenadas do mundo. */
  area: AreaMundo
  selecionadaId: number | null
  raizId: number | null
  aberto: boolean
  aoAlternar: (aberto: boolean) => void
  /** Leva a câmera ao ponto do mundo (centro). */
  aoNavegar: (x: number, y: number) => void
}

/** Bloco desenhado no mapa — pré-projetado, um por pessoa. */
interface Bloco {
  id: number
  x: number
  y: number
  w: number
  h: number
  cor: string
}

export const Minimapa = memo(function Minimapa({
  layout,
  sexoPorId,
  area,
  selecionadaId,
  raizId,
  aberto,
  aoAlternar,
  aoNavegar,
}: MinimapaProps) {
  const quadroRef = useRef<HTMLDivElement>(null)
  const [arrastando, setArrastando] = useState(false)

  // Interior útil: a moldura cinza da referência é uma borda larga, e o papel
  // do mapa fica dentro dela.
  const interior = {
    largura: MINIMAPA.largura - MINIMAPA.molduraLargura * 2,
    altura: MINIMAPA.altura - MINIMAPA.molduraLargura * 2,
  }

  // Escala: cabe a árvore inteira com um respiro. Uma escala só nos dois eixos
  // — esticar o mapa mentiria sobre a forma da família.
  const escala = useMemo(() => {
    const l = Math.max(1, layout.largura)
    const a = Math.max(1, layout.altura)
    return Math.min(interior.largura / l, interior.altura / a) * 0.94
  }, [layout.largura, layout.altura, interior.largura, interior.altura])

  const deslocamento = useMemo(
    () => ({
      x: (interior.largura - layout.largura * escala) / 2,
      y: (interior.altura - layout.altura * escala) / 2,
    }),
    [interior.largura, interior.altura, layout.largura, layout.altura, escala],
  )

  const blocos = useMemo<Bloco[]>(() => {
    const lista: Bloco[] = []
    layout.nos.forEach((n) => {
      lista.push({
        id: n.pessoaId,
        x: deslocamento.x + n.x * escala,
        y: deslocamento.y + n.y * escala,
        // Mínimo de 2px: abaixo disso o bloco some no antialiasing e a família
        // aparece com buracos que não existem.
        w: Math.max(2, n.largura * escala),
        h: Math.max(2, n.altura * escala),
        cor: corGenero(sexoPorId.get(n.pessoaId)).linha,
      })
    })
    return lista
  }, [layout.nos, escala, deslocamento, sexoPorId])

  // O retângulo é RECORTADO à moldura. Sem isso, uma câmera afastada produz um
  // viewport maior que o próprio mapa: a borda some para fora dos quatro lados
  // e o operador vê um traço atravessando o mapa em vez de "estou vendo tudo".
  const viewport = useMemo(() => {
    const x1 = Math.max(0, deslocamento.x + area.x * escala)
    const y1 = Math.max(0, deslocamento.y + area.y * escala)
    const x2 = Math.min(interior.largura, deslocamento.x + (area.x + area.largura) * escala)
    const y2 = Math.min(interior.altura, deslocamento.y + (area.y + area.altura) * escala)
    return {
      x: x1,
      y: y1,
      w: Math.max(6, x2 - x1),
      h: Math.max(6, y2 - y1),
    }
  }, [area, escala, deslocamento, interior.largura, interior.altura])

  /** Ponto do mapa → centro no mundo. */
  const navegarPara = useCallback(
    (clienteX: number, clienteY: number) => {
      const el = quadroRef.current
      if (!el || escala <= 0) return
      const r = el.getBoundingClientRect()
      const mx = clienteX - r.left - deslocamento.x
      const my = clienteY - r.top - deslocamento.y
      aoNavegar(mx / escala, my / escala)
    },
    [escala, deslocamento, aoNavegar],
  )

  const aoPressionar = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      setArrastando(true)
      navegarPara(e.clientX, e.clientY)
    },
    [navegarPara],
  )

  const aoMover = useCallback(
    (e: React.PointerEvent) => {
      if (!arrastando) return
      e.stopPropagation()
      navegarPara(e.clientX, e.clientY)
    },
    [arrastando, navegarPara],
  )

  const aoSoltar = useCallback((e: React.PointerEvent) => {
    setArrastando(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  // Recolhido: um alvo pequeno no mesmo canto, para não deixar a capacidade
  // sumir sem caminho de volta.
  if (!aberto) {
    return (
      <button
        data-no-pan
        data-minimapa="recolhido"
        type="button"
        title="Mostrar o minimapa (M)"
        aria-label="Mostrar o minimapa"
        onClick={() => aoAlternar(true)}
        className="absolute z-30 inline-flex items-center justify-center rounded-md arv-hover"
        style={{
          left: MINIMAPA.margem,
          bottom: MINIMAPA.margem,
          width: 32,
          height: 32,
          background: TREE.cartao,
          border: `1px solid ${TREE.cartaoBorda}`,
          boxShadow: TREE.sombra,
          color: TREE.textoFraco,
        }}
      >
        <IconeMapa className="h-4 w-4" />
      </button>
    )
  }

  return (
    <div
      data-no-pan
      data-minimapa="aberto"
      className="absolute z-30 select-none"
      style={{
        left: MINIMAPA.margem,
        bottom: MINIMAPA.margem,
        width: MINIMAPA.largura,
        height: MINIMAPA.altura,
        background: MINIMAPA.moldura,
        borderRadius: MINIMAPA.raio,
        boxShadow: TREE.sombraElevada,
        padding: MINIMAPA.molduraLargura,
        animation: `minimapaEntrada 200ms ${EASE.suave}`,
      }}
    >
      <style>{`
        @keyframes minimapaEntrada {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <button
        type="button"
        title="Esconder o minimapa (M)"
        aria-label="Esconder o minimapa"
        onClick={() => aoAlternar(false)}
        className="absolute right-0.5 top-0.5 z-[1] inline-flex h-5 w-5 items-center justify-center rounded"
        style={{ color: TREE.texto }}
      >
        <X className="h-4 w-4" />
      </button>

      <div
        ref={quadroRef}
        role="application"
        aria-label="Minimapa da árvore — clique ou arraste para navegar"
        onPointerDown={aoPressionar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={aoSoltar}
        className="relative h-full w-full overflow-hidden"
        style={{ background: MINIMAPA.papel, cursor: arrastando ? "grabbing" : "crosshair" }}
      >
        <svg
          width={interior.largura}
          height={interior.altura}
          viewBox={`0 0 ${interior.largura} ${interior.altura}`}
          aria-hidden
          className="pointer-events-none absolute left-0 top-0"
        >
          {blocos.map((b) => {
            const ehSelecionada = b.id === selecionadaId
            const ehRaiz = b.id === raizId
            return (
              <rect
                key={b.id}
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                rx={1}
                fill={ehSelecionada ? TREE.acentoTinta : b.cor}
                opacity={ehSelecionada || ehRaiz ? 1 : 0.7}
                // Forma além de cor: a raiz ganha contorno, e não só um tom
                // diferente — estado não pode depender de distinguir matiz.
                stroke={ehRaiz && !ehSelecionada ? TREE.texto : undefined}
                strokeWidth={ehRaiz && !ehSelecionada ? 1 : 0}
              />
            )
          })}

          {/* Área visível — o retângulo que responde "onde eu estou". */}
          <rect
            x={viewport.x}
            y={viewport.y}
            width={viewport.w}
            height={viewport.h}
            fill="none"
            stroke={MINIMAPA.viewport}
            strokeWidth={1.5}
            rx={2}
          />
        </svg>
      </div>
    </div>
  )
})

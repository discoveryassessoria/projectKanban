// src/components/arvore/motor/use-viewport.ts
//
// Câmera da árvore: zoom, pan, inércia e centralização animada.
//
// Por que não usar o pan/zoom pronto da lib de grafo: ela aplica o delta bruto
// do ponteiro direto na transformação. O resultado é um movimento que "para
// seco" ao soltar o mouse e um zoom que salta em degraus — a sensação é de
// planilha, não de mapa. Aqui há três coisas que mudam isso:
//
//   1. INÉRCIA — a velocidade do ponteiro é medida numa janela curta e continua
//      decaindo depois do soltar. É o que faz a árvore "deslizar".
//   2. ZOOM INTERPOLADO — a roda define um ALVO; a escala corrente persegue
//      esse alvo por interpolação a cada quadro. Nunca há salto.
//   3. ÂNCORA NO CURSOR — o ponto sob o cursor permanece sob o cursor durante
//      todo o zoom. Sem isso o operador perde a referência e precisa reenquadrar.
//
// A transformação é escrita direto no DOM a cada quadro (sem re-render). O
// React só é notificado quando o enquadramento muda o suficiente para afetar a
// virtualização — é isso que mantém 60fps com milhares de pessoas.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

export interface Viewport {
  x: number
  y: number
  k: number
}

export interface Retangulo {
  x: number
  y: number
  largura: number
  altura: number
}

export interface OpcoesCamera {
  duracao?: number
  /** Quando true, salta sem animar (usado em resize/troca de layout). */
  imediato?: boolean
}

export interface ApiViewport {
  obter: () => Viewport
  /** Zoom multiplicativo ancorado no centro da tela (ou num ponto de tela). */
  zoomPor: (fator: number, ancoraTela?: { x: number; y: number }) => void
  zoomPara: (k: number, opcoes?: OpcoesCamera) => void
  /** Centraliza um ponto do MUNDO na viewport. */
  centralizarEm: (x: number, y: number, k?: number, opcoes?: OpcoesCamera) => void
  /** Enquadra um retângulo do mundo com folga. */
  enquadrar: (r: Retangulo, folga?: number, opcoes?: OpcoesCamera) => void
  panPor: (dx: number, dy: number) => void
  parar: () => void
}

const K_MIN = 0.08
const K_MAX = 2.6

/**
 * Piso do ENQUADRAR.
 *
 * Afastar à mão pode ir até K_MIN — ali o operador pediu a visão de satélite e
 * sabe que vai perder o texto. "Enquadrar a árvore" é outra coisa: é um comando
 * de LEITURA, e devolver a árvore inteira a 0,35 de escala entrega uma tela de
 * retângulos com borrão dentro, que não responde nenhuma pergunta. O comando
 * cabe o quanto couber sem cruzar o limite de legibilidade; o resto fica para o
 * pan, que é barato.
 */
const K_MIN_ENQUADRAR = 0.55
const ATRITO = 0.925
const VELOCIDADE_MINIMA = 0.02
const LERP_ZOOM = 0.24
/** Deslocamento/zoom que obriga recálculo da virtualização. */
const LIMIAR_PUBLICACAO = 24
const LIMIAR_ZOOM = 0.02

// Movimento reduzido: inércia, tween de câmera e zoom interpolado são
// exatamente o tipo de movimento involuntário que dispara desconforto
// vestibular. Quem pediu ao sistema para reduzir animação recebe uma câmera que
// salta direto para o destino — a função continua inteira, só sem o percurso.
// O estado vive num ref (lido dentro do laço de rAF) e acompanha mudanças da
// preferência em tempo real.

interface Estado {
  x: number
  y: number
  k: number
  kAlvo: number
  vx: number
  vy: number
  /** Tween ativo de câmera (centralizar/enquadrar). */
  tween: {
    de: Viewport
    para: Viewport
    inicio: number
    duracao: number
  } | null
}

export function useViewport(opcoes: {
  alvoRef: React.RefObject<HTMLElement | null>
  containerRef: React.RefObject<HTMLElement | null>
  /** Notificado quando o enquadramento muda o bastante para revirtualizar. */
  aoMudar?: (v: Viewport) => void
  aoInteragir?: () => void
}) {
  const { alvoRef, containerRef, aoMudar, aoInteragir } = opcoes

  const estado = useRef<Estado>({ x: 0, y: 0, k: 1, kAlvo: 1, vx: 0, vy: 0, tween: null })
  const publicado = useRef<Viewport>({ x: 0, y: 0, k: 1 })
  const rafRef = useRef<number | null>(null)
  const arrastando = useRef(false)
  const ponteiro = useRef<{ x: number; y: number; t: number } | null>(null)
  const amostras = useRef<Array<{ dx: number; dy: number; dt: number }>>([])
  const aoMudarRef = useRef(aoMudar)
  const aoInteragirRef = useRef(aoInteragir)
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, k: 1 })
  const reduzido = useRef(false)

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    reduzido.current = mq.matches
    const aoTrocar = () => {
      reduzido.current = mq.matches
    }
    mq.addEventListener("change", aoTrocar)
    return () => mq.removeEventListener("change", aoTrocar)
  }, [])

  useEffect(() => {
    aoMudarRef.current = aoMudar
    aoInteragirRef.current = aoInteragir
  }, [aoMudar, aoInteragir])

  // ---------------- laço de animação ----------------
  const aplicar = useCallback(() => {
    const el = alvoRef.current
    if (!el) return
    const e = estado.current
    el.style.transform = `translate3d(${e.x}px, ${e.y}px, 0) scale(${e.k})`
  }, [alvoRef])

  const publicar = useCallback(() => {
    const e = estado.current
    const p = publicado.current
    const mudouMuito =
      Math.abs(e.x - p.x) > LIMIAR_PUBLICACAO ||
      Math.abs(e.y - p.y) > LIMIAR_PUBLICACAO ||
      Math.abs(e.k - p.k) > LIMIAR_ZOOM
    if (!mudouMuito) return
    publicado.current = { x: e.x, y: e.y, k: e.k }
    setViewport(publicado.current)
    aoMudarRef.current?.(publicado.current)
  }, [])

  const garantirLaco = useCallback(() => {
    if (rafRef.current != null) return
    const passo = () => {
      const e = estado.current
      let ativo = false

      // 1. tween de câmera tem prioridade sobre inércia
      if (e.tween) {
        const agora = performance.now()
        const t = Math.min(1, (agora - e.tween.inicio) / e.tween.duracao)
        // easeOutQuint — desacelera forte no fim, dá peso ao movimento
        const p = 1 - Math.pow(1 - t, 5)
        e.x = e.tween.de.x + (e.tween.para.x - e.tween.de.x) * p
        e.y = e.tween.de.y + (e.tween.para.y - e.tween.de.y) * p
        e.k = e.tween.de.k + (e.tween.para.k - e.tween.de.k) * p
        e.kAlvo = e.k
        if (t >= 1) e.tween = null
        else ativo = true
      } else {
        // 2. inércia do pan
        if (reduzido.current) {
          e.vx = 0
          e.vy = 0
        }
        if (!arrastando.current && (Math.abs(e.vx) > VELOCIDADE_MINIMA || Math.abs(e.vy) > VELOCIDADE_MINIMA)) {
          e.x += e.vx
          e.y += e.vy
          e.vx *= ATRITO
          e.vy *= ATRITO
          ativo = true
        } else if (!arrastando.current) {
          e.vx = 0
          e.vy = 0
        }

        // 3. zoom perseguindo o alvo, ancorado no centro do container
        if (Math.abs(e.kAlvo - e.k) > 0.0005) {
          if (reduzido.current) {
            e.k = e.kAlvo
            aplicar()
            publicar()
            rafRef.current = requestAnimationFrame(passo)
            return
          }
          const container = containerRef.current
          const cx = container ? container.clientWidth / 2 : 0
          const cy = container ? container.clientHeight / 2 : 0
          const kNovo = e.k + (e.kAlvo - e.k) * LERP_ZOOM
          const razao = kNovo / e.k
          e.x = cx - (cx - e.x) * razao
          e.y = cy - (cy - e.y) * razao
          e.k = kNovo
          ativo = true
        }
      }

      aplicar()
      publicar()

      if (ativo || arrastando.current) {
        rafRef.current = requestAnimationFrame(passo)
      } else {
        rafRef.current = null
        // publica o estado final mesmo se abaixo do limiar
        publicado.current = { x: e.x, y: e.y, k: e.k }
        setViewport(publicado.current)
        aoMudarRef.current?.(publicado.current)
      }
    }
    rafRef.current = requestAnimationFrame(passo)
  }, [aplicar, publicar, containerRef])

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  // ---------------- API ----------------
  const api: ApiViewport = {
    obter: () => ({ ...estado.current }),

    parar: () => {
      const e = estado.current
      e.vx = 0
      e.vy = 0
      e.tween = null
      e.kAlvo = e.k
    },

    panPor: (dx, dy) => {
      const e = estado.current
      e.tween = null
      e.x += dx
      e.y += dy
      garantirLaco()
    },

    zoomPor: (fator, ancoraTela) => {
      const e = estado.current
      e.tween = null
      const container = containerRef.current
      const ax = ancoraTela?.x ?? (container ? container.clientWidth / 2 : 0)
      const ay = ancoraTela?.y ?? (container ? container.clientHeight / 2 : 0)
      const kNovo = clamp(e.k * fator, K_MIN, K_MAX)
      const razao = kNovo / e.k
      // âncora: o ponto sob o cursor não se move
      e.x = ax - (ax - e.x) * razao
      e.y = ay - (ay - e.y) * razao
      e.k = kNovo
      e.kAlvo = kNovo
      garantirLaco()
    },

    zoomPara: (k, o) => {
      const e = estado.current
      const alvo = clamp(k, K_MIN, K_MAX)
      if (o?.imediato || reduzido.current) {
        e.k = alvo
        e.kAlvo = alvo
        e.tween = null
      } else {
        e.kAlvo = alvo
        e.tween = null
      }
      garantirLaco()
    },

    centralizarEm: (x, y, k, o) => {
      const container = containerRef.current
      if (!container) return
      const e = estado.current
      const kFinal = clamp(k ?? e.k, K_MIN, K_MAX)
      const destino: Viewport = {
        x: container.clientWidth / 2 - x * kFinal,
        y: container.clientHeight / 2 - y * kFinal,
        k: kFinal,
      }
      irPara(e, destino, reduzido.current ? { ...o, imediato: true } : o, garantirLaco)
    },

    enquadrar: (r, folga = 0.12, o) => {
      const container = containerRef.current
      if (!container || r.largura <= 0 || r.altura <= 0) return
      const e = estado.current
      const cw = container.clientWidth
      const ch = container.clientHeight
      const k = clamp(
        Math.min(cw / (r.largura * (1 + folga * 2)), ch / (r.altura * (1 + folga * 2))),
        K_MIN_ENQUADRAR,
        K_MAX,
      )
      const destino: Viewport = {
        x: cw / 2 - (r.x + r.largura / 2) * k,
        y: ch / 2 - (r.y + r.altura / 2) * k,
        k,
      }
      irPara(e, destino, reduzido.current ? { ...o, imediato: true } : o, garantirLaco)
    },
  }

  // ---------------- eventos ----------------
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const posicaoLocal = (ev: { clientX: number; clientY: number }) => {
      const r = container.getBoundingClientRect()
      return { x: ev.clientX - r.left, y: ev.clientY - r.top }
    }

    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault()
      aoInteragirRef.current?.()
      const e = estado.current
      e.tween = null

      // Convenção de ferramenta profissional (Figma/Miro):
      //  · trackpad de dois dedos → PAN
      //  · ctrl/⌘ + roda, ou pinça (o browser marca ctrlKey) → ZOOM
      //  · roda de mouse (deltaMode em linhas) → ZOOM, que é o esperado nela
      const ehZoom = ev.ctrlKey || ev.metaKey || ev.deltaMode !== 0
      if (ehZoom) {
        const intensidade = ev.deltaMode !== 0 ? 0.12 : 0.0032
        const fator = Math.exp(-ev.deltaY * intensidade)
        const ancora = posicaoLocal(ev)
        const kNovo = clamp(e.k * fator, K_MIN, K_MAX)
        const razao = kNovo / e.k
        e.x = ancora.x - (ancora.x - e.x) * razao
        e.y = ancora.y - (ancora.y - e.y) * razao
        e.k = kNovo
        e.kAlvo = kNovo
      } else {
        e.x -= ev.deltaX
        e.y -= ev.deltaY
        // pan por trackpad também ganha inércia: mantém a sensação contínua
        if (!reduzido.current) {
          e.vx = -ev.deltaX * 0.28
          e.vy = -ev.deltaY * 0.28
        }
      }
      garantirLaco()
    }

    const onPointerDown = (ev: PointerEvent) => {
      // Só arrasta a partir do fundo do canvas ou com botão do meio.
      const alvo = ev.target as HTMLElement
      const ehInterativo = alvo.closest("[data-no-pan]")
      if (ehInterativo && ev.button !== 1) return
      if (ev.button !== 0 && ev.button !== 1) return

      aoInteragirRef.current?.()
      arrastando.current = true
      amostras.current = []
      ponteiro.current = { x: ev.clientX, y: ev.clientY, t: performance.now() }
      const e = estado.current
      e.vx = 0
      e.vy = 0
      e.tween = null
      container.setPointerCapture?.(ev.pointerId)
      container.style.cursor = "grabbing"
      garantirLaco()
    }

    const onPointerMove = (ev: PointerEvent) => {
      if (!arrastando.current || !ponteiro.current) return
      const agora = performance.now()
      const dx = ev.clientX - ponteiro.current.x
      const dy = ev.clientY - ponteiro.current.y
      const dt = Math.max(1, agora - ponteiro.current.t)
      ponteiro.current = { x: ev.clientX, y: ev.clientY, t: agora }

      const e = estado.current
      e.x += dx
      e.y += dy

      // janela curta de amostras: a inércia segue o GESTO FINAL, não a média
      // do arrasto inteiro — é o que faz o "flick" responder ao pulso do dedo.
      amostras.current.push({ dx, dy, dt })
      if (amostras.current.length > 5) amostras.current.shift()
      aplicar()
    }

    const encerrarArrasto = (ev?: PointerEvent) => {
      if (!arrastando.current) return
      arrastando.current = false
      container.style.cursor = ""
      if (ev) container.releasePointerCapture?.(ev.pointerId)

      const e = estado.current
      const janela = amostras.current
      if (janela.length && !reduzido.current) {
        const somaDt = janela.reduce((a, s) => a + s.dt, 0)
        const somaDx = janela.reduce((a, s) => a + s.dx, 0)
        const somaDy = janela.reduce((a, s) => a + s.dy, 0)
        // px por quadro de 16ms
        e.vx = (somaDx / somaDt) * 16
        e.vy = (somaDy / somaDt) * 16
        const v = Math.hypot(e.vx, e.vy)
        const TETO = 60
        if (v > TETO) {
          e.vx = (e.vx / v) * TETO
          e.vy = (e.vy / v) * TETO
        }
      }
      amostras.current = []
      garantirLaco()
    }

    container.addEventListener("wheel", onWheel, { passive: false })
    container.addEventListener("pointerdown", onPointerDown)
    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", encerrarArrasto)
    window.addEventListener("pointercancel", encerrarArrasto)

    return () => {
      container.removeEventListener("wheel", onWheel)
      container.removeEventListener("pointerdown", onPointerDown)
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", encerrarArrasto)
      window.removeEventListener("pointercancel", encerrarArrasto)
    }
  }, [containerRef, aplicar, garantirLaco])

  // aplica a transformação inicial e a cada troca de alvo
  useLayoutEffect(() => {
    aplicar()
  }, [aplicar])

  return { viewport, api, arrastandoRef: arrastando }
}

function irPara(
  e: Estado,
  destino: Viewport,
  o: OpcoesCamera | undefined,
  garantirLaco: () => void,
) {
  if (o?.imediato) {
    e.x = destino.x
    e.y = destino.y
    e.k = destino.k
    e.kAlvo = destino.k
    e.tween = null
    e.vx = 0
    e.vy = 0
  } else {
    e.vx = 0
    e.vy = 0
    e.tween = {
      de: { x: e.x, y: e.y, k: e.k },
      para: destino,
      inicio: performance.now(),
      duracao: o?.duracao ?? 520,
    }
  }
  garantirLaco()
}

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max)
}

export const LIMITES_ZOOM = { min: K_MIN, max: K_MAX }

/** Converte um ponto de tela para coordenadas do mundo. */
export function telaParaMundo(v: Viewport, x: number, y: number) {
  return { x: (x - v.x) / v.k, y: (y - v.y) / v.k }
}

/** Retângulo do mundo atualmente visível, com margem em px de tela. */
export function areaVisivel(
  v: Viewport,
  largura: number,
  altura: number,
  margem = 400,
): Retangulo {
  const x = (-v.x - margem) / v.k
  const y = (-v.y - margem) / v.k
  return {
    x,
    y,
    largura: (largura + margem * 2) / v.k,
    altura: (altura + margem * 2) / v.k,
  }
}

"use client"

// src/components/ambiente/AmbienteFundo.tsx
//
// CAMADA VISUAL ISOLADA. Só decora o fundo — NÃO participa do fluxo do documento,
// não intercepta cliques, não altera tamanho/posição de nada. É fixa, cobre a
// viewport, fica ATRÁS do shell (z-0; o shell é z-10). Nunca fundo preto.
//
// Crossfade REAL com DUAS camadas (A/B): a próxima imagem é PRÉ-CARREGADA e só
// então uma sobe (opacity 0→1) enquanto a outra desce (1→0). Anima apenas opacity.
// Timers são cancelados na troca de país e callbacks obsoletos são ignorados por
// um contador de geração. Respeita prefers-reduced-motion e Page Visibility.

import { useEffect, useRef, useState, type CSSProperties } from "react"
import {
  useAmbiente, AMBIENTE_FADE_MS, AMBIENTE_FADE_PAIS_MS, AMBIENTE_ROTACAO_MS,
} from "@/src/contexts/ambiente-context"
import type { ImagemAmbiente } from "@/src/lib/ambiente/imagens"
import { proximoIndice, deveRotacionar, duracaoFade } from "@/src/lib/ambiente/transicao"

interface Slot { img: ImagemAmbiente | null; vars: CSSProperties }
type Frente = "a" | "b"

const GRAD_PROCEDURAL = [
  "radial-gradient(120% 90% at 12% 8%, var(--amb-ceu-2) 0%, transparent 55%)",
  "radial-gradient(100% 80% at 88% 22%, var(--amb-ceu-1) 0%, transparent 60%)",
  "radial-gradient(140% 110% at 50% 108%, var(--amb-ceu-3) 0%, transparent 70%)",
  "linear-gradient(160deg, var(--amb-ceu-1) 0%, var(--amb-ceu-3) 100%)",
].join(", ")

function precarregar(url: string): Promise<boolean> {
  return new Promise((res) => {
    if (typeof window === "undefined") return res(false)
    const im = new window.Image()
    im.onload = () => res(true)
    im.onerror = () => res(false)
    im.src = url
  })
}

function Camada({ slot, visivel, dur }: { slot: Slot; visivel: boolean; dur: number }) {
  const style: CSSProperties = {
    ...slot.vars,
    opacity: visivel ? 1 : 0,
    transition: `opacity ${dur}ms ease-in-out`,
    willChange: "opacity",
  }
  return (
    <div className="absolute inset-0" style={style} aria-hidden="true">
      {slot.img ? (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url('${slot.img.url}')`,
            backgroundSize: "cover",
            backgroundRepeat: "no-repeat",
            backgroundPosition: slot.img.posicao,
          }}
        />
      ) : (
        <div className="absolute inset-0" style={{ backgroundImage: GRAD_PROCEDURAL }} />
      )}
    </div>
  )
}

export function AmbienteFundo() {
  const { ambiente } = useAmbiente()

  const inicial: Slot = { img: null, vars: ambiente.cssVars }
  const [slotA, setSlotA] = useState<Slot>(inicial)
  const [slotB, setSlotB] = useState<Slot>(inicial)
  const [frente, setFrente] = useState<Frente>("a")
  const [dur, setDur] = useState<number>(AMBIENTE_FADE_PAIS_MS)

  const genRef = useRef(0)
  const frenteRef = useRef<Frente>("a")
  const idxRef = useRef(0)
  const rotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reducedRef = useRef(false)

  const setSlot = (lado: Frente, s: Slot) => (lado === "a" ? setSlotA(s) : setSlotB(s))

  // Troca de cena com crossfade. Resolve ao terminar. Ignora se a geração mudou.
  const transicionar = (img: ImagemAmbiente | null, vars: CSSProperties, durMs: number, meuGen: number) =>
    new Promise<void>((resolve) => {
      setDur(durMs)
      const back: Frente = frenteRef.current === "a" ? "b" : "a"
      setSlot(back, { img, vars })
      // dois frames garantem que a camada de trás pinte em opacity 0 antes do fade
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (meuGen !== genRef.current) return resolve()
          frenteRef.current = back
          setFrente(back)
          if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
          fadeTimerRef.current = setTimeout(resolve, Math.max(durMs, 0) + 40)
        }),
      )
    })

  const cancelarTimers = () => {
    if (rotTimerRef.current) clearTimeout(rotTimerRef.current)
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    rotTimerRef.current = null
    fadeTimerRef.current = null
  }

  // prefers-reduced-motion
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    reducedRef.current = mq.matches
    const on = () => { reducedRef.current = mq.matches }
    mq.addEventListener?.("change", on)
    return () => mq.removeEventListener?.("change", on)
  }, [])

  // Motor da cena: reage à troca de país/processo (ambiente.chave). Uma vez por cena.
  useEffect(() => {
    const meuGen = ++genRef.current
    cancelarTimers()
    const imagens = ambiente.imagens
    const durPais = duracaoFade(reducedRef.current, "pais", AMBIENTE_FADE_PAIS_MS, AMBIENTE_FADE_MS)

    const agendarRotacao = () => {
      if (rotTimerRef.current) clearTimeout(rotTimerRef.current)
      const visivel = typeof document === "undefined" || document.visibilityState === "visible"
      if (!deveRotacionar(imagens.length, visivel, false)) return
      rotTimerRef.current = setTimeout(async () => {
        if (meuGen !== genRef.current) return
        const prox = proximoIndice(imagens.length, idxRef.current)
        const ok = await precarregar(imagens[prox].url)
        if (meuGen !== genRef.current) return
        idxRef.current = prox // avança mesmo em falha para não travar
        if (ok) await transicionar(imagens[prox], ambiente.cssVars, duracaoFade(reducedRef.current, "rotacao", AMBIENTE_FADE_PAIS_MS, AMBIENTE_FADE_MS), meuGen)
        if (meuGen !== genRef.current) return
        agendarRotacao()
      }, AMBIENTE_ROTACAO_MS)
    }

    ;(async () => {
      let alvo: ImagemAmbiente | null = null
      if (imagens.length) {
        // primeira imagem VÁLIDA a partir do índice determinístico
        for (let k = 0; k < imagens.length; k++) {
          const i = (ambiente.indiceInicial + k) % imagens.length
          if (await precarregar(imagens[i].url)) { alvo = imagens[i]; idxRef.current = i; break }
          if (meuGen !== genRef.current) return
        }
      } else {
        idxRef.current = 0
      }
      if (meuGen !== genRef.current) return
      await transicionar(alvo, ambiente.cssVars, durPais, meuGen)
      if (meuGen !== genRef.current) return
      agendarRotacao()
    })()

    // pausa/retoma rotação com a visibilidade da aba
    const onVis = () => {
      if (meuGen !== genRef.current) return
      if (document.visibilityState === "visible") agendarRotacao()
      else if (rotTimerRef.current) clearTimeout(rotTimerRef.current)
    }
    document.addEventListener("visibilitychange", onVis)

    return () => {
      document.removeEventListener("visibilitychange", onVis)
      cancelarTimers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambiente])

  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      style={{ ...ambiente.cssVars, backgroundImage: GRAD_PROCEDURAL }}
      aria-hidden="true"
    >
      <Camada slot={slotA} visivel={frente === "a"} dur={dur} />
      <Camada slot={slotB} visivel={frente === "b"} dur={dur} />
      {/* Véu/overlay de contraste — moderado, na cor do país. */}
      <div
        className="absolute inset-0"
        // O DEGRADÊ DO VÉU. Antes ele escurecia 18% para baixo, porque o texto branco
        // do tema anterior precisava de fundo escuro. Agora CLAREIA para baixo: a
        // paisagem fica um pouco mais presente no alto — onde há respiro — e some sob
        // o conteúdo denso, que é onde ela atrapalharia a leitura.
        style={{ background: "linear-gradient(to bottom, var(--amb-scrim), color-mix(in oklab, var(--amb-scrim), white 55%))" }}
      />
    </div>
  )
}

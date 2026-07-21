"use client"

// src/components/ambiente/AmbienteFundo.tsx
//
// O fundo vivo. Montado UMA vez na raiz (SidebarWrapper), fixo atrás de tudo,
// para atravessar mudanças de rota sem remontar — é isso que faz o fundo
// permanecer parado enquanto se navega dentro do mesmo processo.
//
// A troca nunca é instantânea: a camada nova entra por cima em opacity 0 e
// dissolve a anterior em 800ms. As cores acompanham porque as --amb-* são
// registradas com @property e interpolam (ver globals.css).

import { useEffect, useRef, useState } from "react"
import { useAmbiente, AMBIENTE_FADE_MS, type AmbienteAtual } from "@/src/contexts/ambiente-context"

interface Camada {
  id: number
  ambiente: AmbienteAtual
}

let proximoId = 1

export function AmbienteFundo() {
  const { ambiente } = useAmbiente()
  const [camadas, setCamadas] = useState<Camada[]>([{ id: 0, ambiente }])
  const assinaturaRef = useRef<string>(assinatura(ambiente))

  useEffect(() => {
    const nova = assinatura(ambiente)
    if (nova === assinaturaRef.current) return
    assinaturaRef.current = nova

    const camada: Camada = { id: proximoId++, ambiente }
    setCamadas(prev => [...prev, camada])

    // Depois do fade, descarta tudo que ficou embaixo: uma sessão longa não
    // pode acumular dezenas de <div> de fundo.
    const t = setTimeout(() => {
      setCamadas(prev => {
        const i = prev.findIndex(c => c.id === camada.id)
        return i <= 0 ? prev : prev.slice(i)
      })
    }, AMBIENTE_FADE_MS + 60)
    return () => clearTimeout(t)
  }, [ambiente])

  return (
    <div
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-black"
      style={ambiente.cssVars}
      aria-hidden="true"
    >
      {camadas.map((c, i) => (
        <CamadaFundo key={c.id} ambiente={c.ambiente} entrando={i > 0} />
      ))}
      {/* Scrim: garante contraste do texto branco sobre qualquer foto. */}
      <div
        className="absolute inset-0 amb-transicao"
        style={{
          background:
            "linear-gradient(to bottom, var(--amb-scrim), color-mix(in oklab, var(--amb-scrim), black 25%))",
        }}
      />
    </div>
  )
}

/** O que define "outra cena". Módulo/aba não entram aqui — de propósito. */
function assinatura(a: AmbienteAtual): string {
  return `${a.pais ?? "neutro"}|${a.imagem?.url ?? "ceu"}`
}

function CamadaFundo({ ambiente, entrando }: { ambiente: AmbienteAtual; entrando: boolean }) {
  const [visivel, setVisivel] = useState(!entrando)

  useEffect(() => {
    if (!entrando) return
    // Dois frames: garante que o browser pinte opacity 0 antes de animar.
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setVisivel(true)))
    return () => cancelAnimationFrame(raf)
  }, [entrando])

  const estiloBase: React.CSSProperties = {
    ...ambiente.cssVars,
    opacity: visivel ? 1 : 0,
    transition: `opacity ${AMBIENTE_FADE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
  }

  if (ambiente.imagem) {
    return (
      <div className="absolute inset-0" style={estiloBase}>
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat amb-deriva"
          style={{ backgroundImage: `url('${ambiente.imagem.url}')` }}
        />
        {/* Véu na cor do país: é o que torna a foto "italiana" e não só uma foto. */}
        <div
          className="absolute inset-0 mix-blend-soft-light opacity-70"
          style={{ backgroundColor: "var(--amb-primaria)" }}
        />
      </div>
    )
  }

  // Céu procedural — enquanto a biblioteca de fotos daquele país estiver vazia.
  return (
    <div
      className="absolute inset-0 amb-deriva"
      style={{
        ...estiloBase,
        backgroundColor: "var(--amb-ceu-3)",
        backgroundImage: [
          "radial-gradient(120% 90% at 12% 8%, var(--amb-ceu-2) 0%, transparent 55%)",
          "radial-gradient(100% 80% at 88% 22%, var(--amb-ceu-1) 0%, transparent 60%)",
          "radial-gradient(140% 110% at 50% 108%, var(--amb-ceu-3) 0%, transparent 70%)",
          "linear-gradient(160deg, var(--amb-ceu-1) 0%, var(--amb-ceu-3) 100%)",
        ].join(", "),
      }}
    />
  )
}

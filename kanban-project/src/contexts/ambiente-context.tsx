"use client"

// src/contexts/ambiente-context.tsx
//
// FONTE DA VERDADE do ambiente (país/modo). NÃO desenha nada — só decide qual é
// a "cena" ativa. Montado UMA vez na raiz autenticada (SidebarWrapper), acima do
// router, para sobreviver às trocas de rota: navegar dentro do mesmo processo
// (Kanban → Financeiro → Documentos → Árvore → Central) não troca a cena.
//
// País vem de FONTES CONFIÁVEIS, nunca de leitura de DOM/texto:
//   1) processo aberto (entrarNoProcesso)  2) seletor de país do Kanban (focarPais)
//   3) rota com país explícito             4) neutro (áreas corporativas)

import { createContext, useContext, useCallback, useMemo, useState, useRef } from "react"
import {
  AMBIENTE_PAISES, AMBIENTE_NEUTRO, normalizarPais, paletaCss, type PaisKey,
} from "@/src/lib/ambiente/paises"
import {
  imagensDoPais, enquadramentoDaFase, hashSeed, nomeDaCidade,
  type Enquadramento, type ImagemAmbiente,
} from "@/src/lib/ambiente/imagens"

/** Duração do crossfade entre imagens (ms). Suave e perceptível (spec: 1200–1800). */
export const AMBIENTE_FADE_MS = 1400
/** Crossfade de TROCA DE PAÍS — um pouco mais rápido, mas nunca instantâneo. */
export const AMBIENTE_FADE_PAIS_MS = 1000
/** Intervalo da rotação automática por imagem (ms) — spec: 12–20s. */
export const AMBIENTE_ROTACAO_MS = 16000

export interface AmbienteAtual {
  /** null = neutro (corporativo). */
  pais: PaisKey | null
  modo: "neutro" | "contextual"
  processoId: number | null
  codigoProcesso: string | null
  familia: string | null
  enquadramento: Enquadramento
  label: string
  bandeira: string
  /** Lista ORDENADA de imagens da cena (vazia → céu procedural). */
  imagens: ImagemAmbiente[]
  /** Índice inicial determinístico (mesmo processo → mesma cidade). */
  indiceInicial: number
  cssVars: React.CSSProperties
  /** Identidade da cena: só muda quando o fundo deve reiniciar (troca de país/processo). */
  chave: string
}

interface EntrarNoProcessoInput {
  processoId: number
  pais: string | null | undefined
  codigo?: string | null
  familia?: string | null
  fase?: string | null
}

interface AmbienteContextValue {
  ambiente: AmbienteAtual
  entrarNoProcesso: (input: EntrarNoProcessoInput) => void
  focarPais: (pais: string | null | undefined) => void
  neutralizar: () => void
}

const AmbienteContext = createContext<AmbienteContextValue | null>(null)

function montar(
  pais: PaisKey | null, processoId: number | null, codigo: string | null,
  familia: string | null, fase: string | null,
): AmbienteAtual {
  const def = pais ? AMBIENTE_PAISES[pais] : null
  const enquadramento = enquadramentoDaFase(fase)
  const imagens = pais ? imagensDoPais(pais, enquadramento) : []
  const seed = processoId != null ? String(processoId) : codigo ?? "lista"
  const indiceInicial = imagens.length ? hashSeed(`${pais}:${enquadramento}:${seed}`) % imagens.length : 0
  return {
    pais,
    modo: pais ? "contextual" : "neutro",
    processoId, codigoProcesso: codigo, familia, enquadramento,
    label: def?.label ?? AMBIENTE_NEUTRO.label,
    bandeira: def?.bandeira ?? AMBIENTE_NEUTRO.bandeira,
    imagens, indiceInicial,
    cssVars: paletaCss(def?.tokens ?? AMBIENTE_NEUTRO.tokens),
    // A cena reinicia por país/processo/enquadramento — NÃO por aba/módulo.
    chave: pais ? `p:${processoId ?? "lista"}:${pais}:${enquadramento}` : "neutro",
  }
}

const NEUTRO = montar(null, null, null, null, null)

export function AmbienteProvider({ children }: { children: React.ReactNode }) {
  const [ambiente, setAmbiente] = useState<AmbienteAtual>(NEUTRO)
  const chaveRef = useRef<string>(NEUTRO.chave)

  const aplicar = useCallback((chave: string, proximo: () => AmbienteAtual) => {
    if (chaveRef.current === chave) return
    chaveRef.current = chave
    setAmbiente(proximo())
  }, [])

  const entrarNoProcesso = useCallback(({ processoId, pais, codigo, familia, fase }: EntrarNoProcessoInput) => {
    const key = normalizarPais(pais)
    const chave = key ? `p:${processoId}:${key}:${enquadramentoDaFase(fase)}` : "neutro"
    aplicar(chave, () => montar(key, processoId, codigo ?? null, familia ?? null, fase ?? null))
  }, [aplicar])

  const focarPais = useCallback((pais: string | null | undefined) => {
    const key = normalizarPais(pais)
    const chave = key ? `p:lista:${key}:cidade` : "neutro"
    aplicar(chave, () => montar(key, null, null, null, null))
  }, [aplicar])

  const neutralizar = useCallback(() => {
    aplicar("neutro", () => NEUTRO)
  }, [aplicar])

  const value = useMemo(
    () => ({ ambiente, entrarNoProcesso, focarPais, neutralizar }),
    [ambiente, entrarNoProcesso, focarPais, neutralizar],
  )
  return <AmbienteContext.Provider value={value}>{children}</AmbienteContext.Provider>
}

export function useAmbiente(): AmbienteContextValue {
  const ctx = useContext(AmbienteContext)
  if (!ctx) {
    // Fora do provider (testes/SSR): neutro e inerte — nada quebra.
    return { ambiente: NEUTRO, entrarNoProcesso: () => {}, focarPais: () => {}, neutralizar: () => {} }
  }
  return ctx
}

export const _ambienteInternals = { montar, NEUTRO, nomeDaCidade }

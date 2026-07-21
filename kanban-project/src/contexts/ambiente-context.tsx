"use client"

// src/contexts/ambiente-context.tsx
//
// A CÂMERA CINEMATOGRÁFICA.
//
// Regra única e inegociável: o fundo pertence ao PROCESSO, não à tela.
// Navegar entre módulos do mesmo processo (Kanban → Financeiro → Documentos →
// Árvore → Central Operacional) NÃO troca o fundo — a sensação é de continuar
// "dentro" daquele processo. Só a troca de processo faz a câmera cortar, e
// mesmo assim com fade de 800ms.
//
// O contexto vive na raiz (Providers), acima do router, justamente para
// sobreviver a mudanças de rota.

import { createContext, useContext, useCallback, useMemo, useState, useRef } from "react"
import {
  AMBIENTE_PAISES,
  AMBIENTE_NEUTRO,
  normalizarPais,
  paletaCss,
  type PaisKey,
} from "@/src/lib/ambiente/paises"
import {
  resolverImagem,
  enquadramentoDaFase,
  nomeDaCidade,
  type Enquadramento,
  type ImagemAmbiente,
} from "@/src/lib/ambiente/imagens"

export const AMBIENTE_FADE_MS = 800

export interface AmbienteAtual {
  /** null = ambiente neutro (corporativo / telas sem processo). */
  pais: PaisKey | null
  /** Identidade da câmera: só muda quando ESTE valor muda. */
  processoId: number | null
  codigoProcesso: string | null
  familia: string | null
  enquadramento: Enquadramento
  imagem: ImagemAmbiente | null
  label: string
  bandeira: string
  /** Legenda da foto ("Veneza"), null quando o fundo é o céu procedural. */
  cidade: string | null
  cssVars: React.CSSProperties
}

interface EntrarNoProcessoInput {
  processoId: number
  pais: string | null | undefined
  /** Código público — IT-154. Se ausente, o header cai no nome. */
  codigo?: string | null
  /** Sobrenome/família — "Família Rossi". */
  familia?: string | null
  /** Key ou label da fase atual: define o enquadramento. */
  fase?: string | null
}

interface AmbienteContextValue {
  ambiente: AmbienteAtual
  /** Entra (ou atualiza) o processo em foco. Idempotente. */
  entrarNoProcesso: (input: EntrarNoProcessoInput) => void
  /** Volta ao país sem processo — a lista do Kanban filtrada por país. */
  focarPais: (pais: string | null | undefined) => void
  /** Ambiente institucional: Financeiro Corporativo, Gerenciamento, Configurações. */
  neutralizar: () => void
}

const AmbienteContext = createContext<AmbienteContextValue | null>(null)

function montar(
  pais: PaisKey | null,
  processoId: number | null,
  codigo: string | null,
  familia: string | null,
  fase: string | null,
): AmbienteAtual {
  const def = pais ? AMBIENTE_PAISES[pais] : null
  const enquadramento = enquadramentoDaFase(fase)
  // A semente é o processo — não o horário, não um random. Reabrir o mesmo
  // processo amanhã traz a mesma cidade.
  const seed = processoId != null ? String(processoId) : codigo ?? "lista"
  const imagem = pais ? resolverImagem(pais, enquadramento, seed) : null

  return {
    pais,
    processoId,
    codigoProcesso: codigo,
    familia,
    enquadramento,
    imagem,
    label: def?.label ?? AMBIENTE_NEUTRO.label,
    bandeira: def?.bandeira ?? AMBIENTE_NEUTRO.bandeira,
    cidade: imagem ? nomeDaCidade(imagem.cidade) : null,
    cssVars: paletaCss(def?.tokens ?? AMBIENTE_NEUTRO.tokens),
  }
}

const NEUTRO = montar(null, null, null, null, null)

export function AmbienteProvider({ children }: { children: React.ReactNode }) {
  const [ambiente, setAmbiente] = useState<AmbienteAtual>(NEUTRO)
  // Chave de identidade da câmera. Evita recalcular/reanimar em re-render.
  const chaveRef = useRef<string>("neutro")

  const aplicar = useCallback((chave: string, proximo: () => AmbienteAtual) => {
    if (chaveRef.current === chave) return
    chaveRef.current = chave
    setAmbiente(proximo())
  }, [])

  const entrarNoProcesso = useCallback(
    ({ processoId, pais, codigo, familia, fase }: EntrarNoProcessoInput) => {
      const key = normalizarPais(pais)
      // A fase entra na chave: mudar de fase reenquadra (aérea → cidade →
      // consulado → paisagem) com o mesmo fade, sem trocar de país.
      const chave = `p:${processoId}:${key ?? "x"}:${enquadramentoDaFase(fase)}`
      aplicar(chave, () => montar(key, processoId, codigo ?? null, familia ?? null, fase ?? null))
    },
    [aplicar],
  )

  const focarPais = useCallback(
    (pais: string | null | undefined) => {
      const key = normalizarPais(pais)
      aplicar(`l:${key ?? "x"}`, () => montar(key, null, null, null, null))
    },
    [aplicar],
  )

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
    // Fora do provider (testes, storybook) o ambiente é neutro e inerte —
    // nenhum componente quebra por causa do tema.
    return {
      ambiente: NEUTRO,
      entrarNoProcesso: () => {},
      focarPais: () => {},
      neutralizar: () => {},
    }
  }
  return ctx
}

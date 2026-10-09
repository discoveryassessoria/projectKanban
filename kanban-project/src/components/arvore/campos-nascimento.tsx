"use client"

// src/components/arvore/campos-nascimento.tsx
//
// NACIONALIDADE E MAIORIDADE DA PESSOA — o estado compartilhado do nascimento (país → gentílico) e o selo de maioridade.
//
// País, Estado/Província e Cidade NÃO moram mais aqui (09/10/2026): a ferramenta de localidade é UMA só, a da Genealogia
// (`src/components/localidade/campos-de-localidade.tsx`), usada no nascimento, no casamento e no óbito da árvore.
//
//  • Nacionalidade: ao mudar o país, sugere o gentílico ("Brasil" → "Brasileira"),
//    a menos que o usuário já tenha mexido no campo (`tocada`). Nunca travada.

import { useCallback, useState } from "react"
import { classificarMaioridade, ROTULO_MAIORIDADE } from "@/src/lib/documentos/maioridade"
import { nacionalidadeDigitadaToca, nacionalidadeJaTocada, proximaNacionalidade } from "@/src/lib/genealogia/gentilico"

// ─────────────────────────────────────────────────────────────
// Estado compartilhado do nascimento (país → nacionalidade)
// ─────────────────────────────────────────────────────────────

export function useNascimentoPessoa(inicial: { pais: string; estado?: string; cidade: string; nacionalidade: string }) {
  const [pais, setPaisBruto] = useState(inicial.pais)
  const [estado, setEstado] = useState(inicial.estado ?? "")
  const [cidade, setCidade] = useState(inicial.cidade)
  const [nacionalidade, setNacionalidadeBruta] = useState(inicial.nacionalidade)
  // "Tocada": o usuário (ou o cadastro gravado) escolheu a nacionalidade à mão — o país não a sobrescreve mais.
  const [tocada, setTocada] = useState(() => nacionalidadeJaTocada(inicial.nacionalidade, inicial.pais))

  const setPais = useCallback((novo: string) => {
    setPaisBruto(novo)
    setNacionalidadeBruta((atual) => proximaNacionalidade({ atual, tocado: tocada, pais: novo }))
  }, [tocada])

  const setNacionalidade = useCallback((novo: string) => {
    setNacionalidadeBruta(novo)
    setTocada(nacionalidadeDigitadaToca(novo))
  }, [])

  return { pais, setPais, estado, setEstado, cidade, setCidade, nacionalidade, setNacionalidade }
}

// ─────────────────────────────────────────────────────────────
// Nacionalidade
// ─────────────────────────────────────────────────────────────

export function CampoNacionalidade({
  value, onChange, inputClass, placeholder = "Ex: Brasileira...",
}: { value: string; onChange: (v: string) => void; inputClass: string; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputClass}
      placeholder={placeholder}
    />
  )
}

// ─────────────────────────────────────────────────────────────
// Selo de maioridade (calculado — nunca escolhido quando há data)
// ─────────────────────────────────────────────────────────────

export function SeloMaioridade({
  nascimento, marcador, mostrarSemData = false,
}: { nascimento: string | null | undefined; marcador?: string | null; mostrarSemData?: boolean }) {
  const m = classificarMaioridade(nascimento, marcador, new Date())
  if (m.origem === "NENHUMA" && !mostrarSemData) return null
  const cor = m.estado === "MAIOR" ? "text-green-800" : m.estado === "MENOR" ? "text-amber-800" : "text-[var(--text-secondary)]"
  const detalhe = m.origem === "CALCULADA" ? `${m.idade} anos · calculado pela data de nascimento` : m.origem === "DECLARADA" ? "informado no cadastro" : "informe a data de nascimento"
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
      <span className={`inline-flex items-center rounded bg-[var(--surface-secondary)] px-1.5 py-0.5 font-semibold ${cor}`}>
        {ROTULO_MAIORIDADE[m.estado]}
      </span>
      {detalhe}
    </p>
  )
}

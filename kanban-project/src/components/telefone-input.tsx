"use client"

// src/components/telefone-input.tsx
// ============================================================================
// TELEFONE COM SELETOR DE PAÍS (DDI) — campo em duas partes: país ("+55 Brasil")
// e número. O valor que sobe por `onChange` é a mesma string de sempre
// ("+55 (19) 98441-2070", ≤ 20 caracteres), produzida pelo formatador ÚNICO de
// `src/lib/telefone/formatar.ts`; este componente só decide DDI e dígitos.
//
//  • Nomes dos países: base `Pais` (/api/geografia/paises). DDI: tabela estática
//    ISO → DDI (`src/lib/telefone/ddi.ts`). Se a base não responder (ex.: perfil
//    sem a permissão da rota), os nomes caem para o `Intl.DisplayNames` do
//    navegador — o campo nunca fica sem lista.
//  • Valor já gravado: o país vem do MAIOR prefixo de DDI que casar; sem "+" é
//    Brasil; DDI compartilhado abre no país principal e pode ser trocado; valor
//    sem DDI conhecido aparece como está (não se perde o que foi gravado).
//  • Nada é regravado ao abrir: o valor só muda quando o usuário edita.
//  • Visualização (`disabled`): um campo só, com o valor completo.
// ============================================================================

import { useMemo, useRef, useState } from "react"
import { ChevronDown } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useApi } from "@/src/lib/dados"
import { LAYER } from "@/src/lib/ui/layers"
import { DDI_DO_PAIS, PAIS_PADRAO, PAISES_COM_MASCARA } from "@/src/lib/telefone/ddi"
import { comporTelefone, descobrirPais, digitosNacionais, exibirParteNacional } from "@/src/lib/telefone/formatar"

interface Props {
  value: string
  onChange: (valor: string) => void
  disabled?: boolean
  className?: string
  /**
   * Buscar os nomes dos países na base (rota autenticada). `false` na página PÚBLICA de coleta:
   * sem login não há como chamar a rota, e os nomes vêm do navegador.
   */
  usarBase?: boolean
}

interface ItemPais { iso: string; nome: string; ddi: string }

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()

function nomeDoNavegador(iso: string): string {
  try {
    return new Intl.DisplayNames(["pt-BR"], { type: "region" }).of(iso) ?? iso
  } catch {
    return iso
  }
}

export function TelefoneInput({ value, onChange, disabled = false, className, usarBase = true }: Props) {
  const base = useApi<{ paises?: Array<{ codigo: string; nome: string }> }>(disabled || !usarBase ? null : "/api/geografia/paises")
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState("")
  const [escolhido, setEscolhido] = useState<string | null>(null)
  const raiz = useRef<HTMLDivElement>(null)

  // Todos os países com DDI: nome da base (ou do navegador, se a base não veio).
  const paises = useMemo<ItemPais[]>(() => {
    const daBase = base.dados?.paises ?? []
    const nomes = new Map(daBase.map((p) => [p.codigo.toUpperCase(), p.nome]))
    const origem = daBase.length > 0 ? daBase.map((p) => p.codigo.toUpperCase()) : Object.keys(DDI_DO_PAIS)
    return origem
      .filter((iso) => DDI_DO_PAIS[iso])
      .map((iso) => ({ iso, nome: nomes.get(iso) ?? nomeDoNavegador(iso), ddi: DDI_DO_PAIS[iso] }))
  }, [base.dados])

  // País em uso: o escolhido à mão enquanto o valor ainda é coerente com ele;
  // senão, o descoberto pelo valor gravado.
  const detectado = useMemo(() => descobrirPais(value), [value])
  const escolhidoValido = escolhido && (value === "" || descobrirPais(value)?.ddi === DDI_DO_PAIS[escolhido])
  const iso = escolhidoValido ? escolhido : (detectado?.iso ?? (value.trim() === "" ? PAIS_PADRAO : null))
  const ddi = iso ? DDI_DO_PAIS[iso] : null
  const nomeAtual = iso ? (paises.find((p) => p.iso === iso)?.nome ?? nomeDoNavegador(iso)) : "Outro"

  const lista = useMemo(() => {
    const t = semAcento(busca)
    const td = t.replace(/^\+/, "")
    const filtra = (p: ItemPais) => !t || semAcento(p.nome).includes(t) || (td !== "" && /^\d+$/.test(td) && p.ddi.startsWith(td))
    const topo = PAISES_COM_MASCARA.map((i) => paises.find((p) => p.iso === i)).filter((p): p is ItemPais => Boolean(p))
    const resto = paises.filter((p) => !PAISES_COM_MASCARA.includes(p.iso)).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    return { topo: topo.filter(filtra), resto: resto.filter(filtra) }
  }, [paises, busca])

  if (disabled) {
    return (
      <Input
        value={value}
        disabled
        readOnly
        className={className}
      />
    )
  }

  const trocarPais = (novoIso: string) => {
    const novoDdi = DDI_DO_PAIS[novoIso]
    // Reformata o número já digitado com o DDI novo.
    const nacional = ddi ? digitosNacionais(value, ddi) : value.replace(/\D/g, "")
    setEscolhido(novoIso)
    onChange(comporTelefone(novoDdi, nacional))
    setAberto(false)
    setBusca("")
  }

  const aoDigitar = (texto: string) => {
    if (!ddi) {
      // Sem DDI reconhecido: preserva o que foi digitado (só limita à coluna).
      onChange(texto.slice(0, 20))
      return
    }
    onChange(comporTelefone(ddi, texto))
  }

  const exibido = ddi ? exibirParteNacional(value, ddi) : value

  const itemLista = (p: ItemPais) => (
    <li
      key={p.iso}
      role="option"
      aria-selected={p.iso === iso}
      onMouseDown={(e) => { e.preventDefault(); trocarPais(p.iso) }}
      className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 hover:bg-[var(--surface-secondary)] ${p.iso === iso ? "bg-[var(--surface-secondary)]" : ""}`}
    >
      <span className="truncate">{p.nome}</span>
      <span className="shrink-0 text-xs text-[var(--text-muted)]">+{p.ddi}</span>
    </li>
  )

  return (
    <div
      ref={raiz}
      className={`relative flex gap-2 ${className ?? ""}`}
      onBlur={(e) => { if (!raiz.current?.contains(e.relatedTarget as Node | null)) { setAberto(false); setBusca("") } }}
    >
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        title={nomeAtual}
        className="flex h-[42px] w-[132px] shrink-0 items-center justify-between gap-1 rounded-lg border border-gray-300 bg-[var(--surface-primary)] px-2 text-sm text-gray-900 shadow-[var(--elev-1)]"
      >
        <span className="truncate">{ddi ? `+${ddi} ${nomeAtual}` : "Outro"}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden />
      </button>
      <Input
        value={exibido}
        onChange={(e) => aoDigitar(e.target.value)}
        placeholder={iso === "BR" ? "(11) 99999-9999" : "Número"}
        inputMode="tel"
        maxLength={25}
        className="bg-[var(--surface-primary)] border-gray-300 text-gray-900 placeholder:text-[var(--text-muted)]"
      />
      {aberto && (
        <div
          style={{ zIndex: LAYER.popover }}
          className="absolute left-0 top-full mt-1 w-72 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] text-sm text-gray-900 shadow-lg"
        >
          <input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar país ou DDI"
            className="w-full rounded-t-lg border-b border-[var(--border-default)] bg-transparent px-3 py-2 outline-none"
          />
          <ul role="listbox" className="max-h-60 overflow-y-auto py-1">
            {lista.topo.map(itemLista)}
            {lista.topo.length > 0 && lista.resto.length > 0 && <li role="separator" className="my-1 border-t border-[var(--border-default)]" />}
            {lista.resto.map(itemLista)}
            {lista.topo.length === 0 && lista.resto.length === 0 && (
              <li className="px-3 py-2 text-[var(--text-secondary)]">Nenhum país encontrado.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

"use client"

// src/components/arvore/campos-nascimento.tsx
//
// CAMPOS DE NASCIMENTO DA PESSOA — País → Cidade (autocomplete) → Nacionalidade
// (gentílico automático). Um só conjunto para todos os formulários de pessoa da
// árvore (adicionar, editar, onboarding), para que a regra não divirja entre telas.
//
//  • País: sugere a base mundial (`/api/geografia/paises`, a MESMA do restante do
//    sistema), carregada só quando o campo ganha foco. Texto livre sempre vale.
//  • Cidade: só no Brasil sugere os municípios do IBGE (JSON estático versionado,
//    importado sob demanda — não entra no bundle inicial). Fora do Brasil é texto
//    livre. "Cidade (complemento)" é aceito e preservado.
//  • Nacionalidade: ao mudar o país, sugere o gentílico ("Brasil" → "Brasileira"),
//    a menos que o usuário já tenha mexido no campo (`tocada`). Nunca travada.

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { useApi } from "@/src/lib/dados"
import { registrarEscape } from "@/src/lib/ui/escape-stack"
import { LAYER } from "@/src/lib/ui/layers"
import {
  achatarMunicipios,
  baseDaCidade,
  normalizarBusca,
  paisEhBrasil,
  sugerirMunicipios,
  trocarBase,
  type MunicipiosPorUf,
} from "@/src/lib/geografia/cidade-nascimento"
import { classificarMaioridade, ROTULO_MAIORIDADE } from "@/src/lib/documentos/maioridade"
import { nacionalidadeDigitadaToca, nacionalidadeJaTocada, proximaNacionalidade } from "@/src/lib/genealogia/gentilico"

// ─────────────────────────────────────────────────────────────
// Estado compartilhado dos três campos
// ─────────────────────────────────────────────────────────────

export function useNascimentoPessoa(inicial: { pais: string; cidade: string; nacionalidade: string }) {
  const [pais, setPaisBruto] = useState(inicial.pais)
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

  return { pais, setPais, cidade, setCidade, nacionalidade, setNacionalidade }
}

// ─────────────────────────────────────────────────────────────
// Campo com sugestões (texto livre sempre permitido)
// ─────────────────────────────────────────────────────────────

interface ItemSugestao {
  valor: string
  detalhe?: string
}

function CampoSugestao({
  value, onChange, itens, onFocoPrimeiraVez, inputClass, placeholder, rotuloTextoLivre,
}: {
  value: string
  onChange: (v: string) => void
  /** Já filtradas por quem chama. */
  itens: ItemSugestao[]
  onFocoPrimeiraVez?: () => void
  inputClass: string
  placeholder?: string
  /** Quando há texto sem correspondência exata, a última linha confirma "usar o que digitei". */
  rotuloTextoLivre?: boolean
}) {
  const listaId = useId()
  const [aberto, setAberto] = useState(false)
  const [ativo, setAtivo] = useState(-1)
  const jaFocou = useRef(false)
  const raiz = useRef<HTMLDivElement>(null)

  const texto = value.trim()
  const temExata = itens.some((i) => normalizarBusca(i.valor) === normalizarBusca(value))
  const mostrarLivre = Boolean(rotuloTextoLivre) && texto.length > 0 && !temExata
  // Sem sugestões não há lista: o campo é só texto livre.
  const visivel = aberto && itens.length > 0

  // Esc fecha só a lista (não o modal que a contém) enquanto ela está aberta.
  useEffect(() => {
    if (!visivel) return
    return registrarEscape(() => setAberto(false))
  }, [visivel])

  const escolher = (valor: string) => {
    onChange(valor)
    setAberto(false)
    setAtivo(-1)
  }

  const aoTecla = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!visivel) {
      if (e.key === "ArrowDown" && itens.length > 0) { setAberto(true); e.preventDefault() }
      return
    }
    if (e.key === "ArrowDown") { setAtivo((a) => Math.min(a + 1, itens.length - 1)); e.preventDefault() }
    else if (e.key === "ArrowUp") { setAtivo((a) => Math.max(a - 1, -1)); e.preventDefault() }
    else if (e.key === "Enter" && ativo >= 0 && itens[ativo]) { escolher(itens[ativo].valor); e.preventDefault() }
  }

  return (
    <div
      ref={raiz}
      className="relative"
      onBlur={(e) => { if (!raiz.current?.contains(e.relatedTarget as Node | null)) setAberto(false) }}
    >
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        className={inputClass}
        autoComplete="off"
        role="combobox"
        aria-expanded={visivel}
        aria-controls={listaId}
        aria-autocomplete="list"
        onFocus={() => {
          setAberto(true)
          if (!jaFocou.current) { jaFocou.current = true; onFocoPrimeiraVez?.() }
        }}
        onChange={(e) => { onChange(e.target.value); setAberto(true); setAtivo(-1) }}
        onKeyDown={aoTecla}
      />
      {visivel && (
        <ul
          id={listaId}
          role="listbox"
          style={{ zIndex: LAYER.popover }}
          className="absolute left-0 right-0 top-full mt-1 max-h-56 overflow-y-auto rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] py-1 text-sm text-gray-900 shadow-lg"
        >
          {itens.map((item, i) => (
            <li
              key={`${item.valor}-${item.detalhe ?? ""}`}
              role="option"
              aria-selected={i === ativo}
              // mouseDown (não click): escolhe antes de o input perder o foco e fechar a lista.
              onMouseDown={(e) => { e.preventDefault(); escolher(item.valor) }}
              onMouseEnter={() => setAtivo(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 ${i === ativo ? "bg-[var(--surface-secondary)]" : ""}`}
            >
              <span className="truncate">{item.valor}</span>
              {item.detalhe && <span className="shrink-0 text-xs text-[var(--text-muted)]">{item.detalhe}</span>}
            </li>
          ))}
          {mostrarLivre && (
            <li
              role="option"
              aria-selected={false}
              onMouseDown={(e) => { e.preventDefault(); setAberto(false) }}
              className="cursor-pointer border-t border-[var(--border-default)] px-3 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]"
            >
              Usar o que digitei: <span className="font-medium text-gray-900">“{texto}”</span>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// País de nascimento
// ─────────────────────────────────────────────────────────────

export function CampoPaisNascimento({
  value, onChange, inputClass, placeholder = "Ex: Brasil, Itália...",
}: { value: string; onChange: (v: string) => void; inputClass: string; placeholder?: string }) {
  const [pedir, setPedir] = useState(false)
  const base = useApi<{ paises?: Array<{ codigo: string; nome: string }> }>(pedir ? "/api/geografia/paises" : null)
  const itens = useMemo<ItemSugestao[]>(() => {
    const t = normalizarBusca(value)
    const todos = base.dados?.paises ?? []
    if (!t) return todos.slice(0, 12).map((p) => ({ valor: p.nome }))
    const comeca = todos.filter((p) => normalizarBusca(p.nome).startsWith(t))
    const contem = todos.filter((p) => !normalizarBusca(p.nome).startsWith(t) && normalizarBusca(p.nome).includes(t))
    return [...comeca, ...contem].slice(0, 12).map((p) => ({ valor: p.nome }))
  }, [base.dados, value])
  return (
    <CampoSugestao
      value={value}
      onChange={onChange}
      itens={itens}
      onFocoPrimeiraVez={() => setPedir(true)}
      inputClass={inputClass}
      placeholder={placeholder}
      rotuloTextoLivre
    />
  )
}

// ─────────────────────────────────────────────────────────────
// Cidade de nascimento (municípios do IBGE só no Brasil)
// ─────────────────────────────────────────────────────────────

type MunicipioIndexado = ReturnType<typeof achatarMunicipios>
let promessaMunicipios: Promise<MunicipioIndexado> | null = null
// Import dinâmico: os ~5.570 nomes (~80 KB) só são baixados quando alguém foca a cidade de um brasileiro.
function carregarMunicipios(): Promise<MunicipioIndexado> {
  promessaMunicipios ??= import("@/src/lib/geografia/municipios-br.json").then((m) =>
    achatarMunicipios((m.default ?? m) as MunicipiosPorUf),
  )
  return promessaMunicipios
}

export function CampoCidadeNascimento({
  value, onChange, pais, inputClass, placeholder,
}: { value: string; onChange: (v: string) => void; pais: string; inputClass: string; placeholder?: string }) {
  const brasil = paisEhBrasil(pais)
  const [lista, setLista] = useState<MunicipioIndexado | null>(null)
  const [pedir, setPedir] = useState(false)
  useEffect(() => {
    if (!pedir || !brasil) return
    let vivo = true
    carregarMunicipios().then((l) => { if (vivo) setLista(l) }).catch(() => { /* sem lista: segue texto livre */ })
    return () => { vivo = false }
  }, [pedir, brasil])

  const itens = useMemo<ItemSugestao[]>(() => {
    if (!brasil || !lista) return []
    return sugerirMunicipios(lista, baseDaCidade(value)).map((m) => ({ valor: m.nome, detalhe: m.uf }))
  }, [brasil, lista, value])

  return (
    <div>
      <CampoSugestao
        value={value}
        // Escolher um município troca só a cidade e mantém "(complemento)" já digitado.
        onChange={(v) => onChange(itens.some((i) => i.valor === v) ? trocarBase(value, v) : v)}
        itens={itens}
        onFocoPrimeiraVez={() => setPedir(true)}
        inputClass={inputClass}
        placeholder={placeholder}
        rotuloTextoLivre
      />
      <p className="mt-1 text-[11px] text-[var(--text-muted)]">
        {brasil ? "Municípios do IBGE; vale texto livre. " : ""}Distrito ou subdistrito entre parênteses: São Paulo (Santo Amaro).
      </p>
    </div>
  )
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

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
// Estado de nascimento (UF no Brasil; texto livre fora dele)
// ─────────────────────────────────────────────────────────────

export const UFS_BR: ReadonlyArray<{ uf: string; nome: string }> = [
  { uf: "AC", nome: "Acre" }, { uf: "AL", nome: "Alagoas" }, { uf: "AP", nome: "Amapá" }, { uf: "AM", nome: "Amazonas" },
  { uf: "BA", nome: "Bahia" }, { uf: "CE", nome: "Ceará" }, { uf: "DF", nome: "Distrito Federal" }, { uf: "ES", nome: "Espírito Santo" },
  { uf: "GO", nome: "Goiás" }, { uf: "MA", nome: "Maranhão" }, { uf: "MT", nome: "Mato Grosso" }, { uf: "MS", nome: "Mato Grosso do Sul" },
  { uf: "MG", nome: "Minas Gerais" }, { uf: "PA", nome: "Pará" }, { uf: "PB", nome: "Paraíba" }, { uf: "PR", nome: "Paraná" },
  { uf: "PE", nome: "Pernambuco" }, { uf: "PI", nome: "Piauí" }, { uf: "RJ", nome: "Rio de Janeiro" }, { uf: "RN", nome: "Rio Grande do Norte" },
  { uf: "RS", nome: "Rio Grande do Sul" }, { uf: "RO", nome: "Rondônia" }, { uf: "RR", nome: "Roraima" }, { uf: "SC", nome: "Santa Catarina" },
  { uf: "SP", nome: "São Paulo" }, { uf: "SE", nome: "Sergipe" }, { uf: "TO", nome: "Tocantins" },
]

/** O código ISO do país pelo NOME digitado/escolhido (a base mundial `/api/geografia/paises`). `null` = país desconhecido → campos de texto livre. */
function useCodigoDoPais(nome: string, ativo: boolean): string | null {
  const base = useApi<{ paises?: Array<{ codigo: string; nome: string }> }>(ativo ? "/api/geografia/paises" : null)
  const n = normalizarBusca(nome)
  return base.dados?.paises?.find((p) => normalizarBusca(p.nome) === n)?.codigo ?? null
}

export function CampoEstadoNascimento({
  value, onChange, pais, inputClass, placeholder = "Ex: Veneto, Catalunha...",
}: { value: string; onChange: (v: string) => void; pais: string; inputClass: string; placeholder?: string }) {
  const brasil = paisEhBrasil(pais)
  // FORA DO BRASIL é PROVÍNCIA (regra única da Localidade): a lista carrega sozinha da base do servidor; texto livre sempre vale.
  const codigo = useCodigoDoPais(pais, !brasil && pais.trim() !== "")
  const provReq = useApi<{ provincias?: Array<{ nome: string }> }>(!brasil && codigo ? `/api/localidades/provincias?pais=${codigo}` : null)
  const itens = useMemo<ItemSugestao[]>(() => {
    const t = normalizarBusca(value)
    return (provReq.dados?.provincias ?? []).filter((p) => !t || normalizarBusca(p.nome).includes(t)).slice(0, 60).map((p) => ({ valor: p.nome }))
  }, [provReq.dados, value])
  if (!brasil) {
    return <CampoSugestao value={value} onChange={onChange} itens={itens} inputClass={inputClass} placeholder={placeholder} rotuloTextoLivre />
  }
  const atual = value.trim()
  // Valor já gravado que não é uma UF (ex.: texto livre de antes) atravessa intacto como opção própria.
  const estranho = atual !== "" && !UFS_BR.some((u) => u.uf === atual.toUpperCase())
  return (
    <select value={estranho ? atual : atual.toUpperCase()} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      <option value="">Selecione o estado</option>
      {estranho && <option value={atual}>{atual}</option>}
      {UFS_BR.map((u) => <option key={u.uf} value={u.uf}>{u.nome} ({u.uf})</option>)}
    </select>
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
  value, onChange, pais, uf, inputClass, placeholder,
}: { value: string; onChange: (v: string) => void; pais: string; /** UF escolhida: restringe as sugestões ao estado. */ uf?: string; inputClass: string; placeholder?: string }) {
  const brasil = paisEhBrasil(pais)
  const [lista, setLista] = useState<MunicipioIndexado | null>(null)
  const [pedir, setPedir] = useState(false)
  useEffect(() => {
    if (!pedir || !brasil) return
    let vivo = true
    carregarMunicipios().then((l) => { if (vivo) setLista(l) }).catch(() => { /* sem lista: segue texto livre */ })
    return () => { vivo = false }
  }, [pedir, brasil])

  // FORA DO BRASIL: cidades da base geográfica do servidor (por país e província); cidade que a base não conhece é texto livre.
  const codigoPais = useCodigoDoPais(pais, !brasil && pais.trim() !== "")
  const cidadesReq = useApi<{ cidades?: Array<{ nome: string; provincia: string | null }> }>(
    !brasil && codigoPais && pedir ? `/api/localidades/cidades?pais=${codigoPais}${uf ? `&provincia=${encodeURIComponent(uf)}` : ""}&q=${encodeURIComponent(baseDaCidade(value))}` : null,
  )
  const itens = useMemo<ItemSugestao[]>(() => {
    if (!brasil) return (cidadesReq.dados?.cidades ?? []).slice(0, 40).map((c) => ({ valor: c.nome, detalhe: uf ? undefined : c.provincia ?? undefined }))
    if (!lista) return []
    const ufEscolhida = (uf ?? "").trim().toUpperCase()
    const base = ufEscolhida ? lista.filter((m) => m.uf === ufEscolhida) : lista
    return sugerirMunicipios(base, baseDaCidade(value)).map((m) => ({ valor: m.nome, detalhe: ufEscolhida ? undefined : m.uf }))
  }, [brasil, lista, value, uf, cidadesReq.dados])

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

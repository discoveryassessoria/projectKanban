// src/lib/genealogia/navegacao/filtros.ts
//
// Filtros avançados da árvore — predicados puros.
//
// O filtro NÃO esconde ninguém do layout: ele marca quem CASA. Esconder muda a
// topologia (um pai filtrado deixaria o filho órfão na tela) e destrói a
// referência espacial que o operador acabou de construir. Quem casa fica em
// evidência; quem não casa recua. O layout permanece o mesmo.
//
// Todos os critérios saem de fonte oficial: Pessoa (Cadastro Mestre), a análise
// do motor genealógico e o indicador do Sistema Documental. Nenhum estado novo.

import type { GrafoGenealogico } from "../motor/grafo"
import type { AnaliseArvore } from "../motor/tipos"
import { normalizar } from "../motor/texto"
import type { ProjecaoDocumental, SituacaoDocumental } from "../documental/indicadores"
import { indicadorDaPessoa } from "../documental/indicadores"

export type ChaveFiltro =
  | "requerentes"
  | "ascendentes"
  | "descendentes"
  | "incompletas"
  | "inconsistencia"
  | "pendencia_documental"
  | "vivas"
  | "falecidas"
  | "casadas"

export interface EstadoFiltros {
  /** Filtros ligados. Vários somam (E lógico entre grupos distintos). */
  chaves: Set<ChaveFiltro>
  geracao: number | null
  /** Raiz do ramo; casa a pessoa e toda a descendência dela. */
  ramoId: number | null
  papel: string | null
  localidade: string | null
  anoDe: number | null
  anoAte: number | null
  /** Referência para ascendentes/descendentes (normalmente o requerente). */
  referenciaId: number | null
}

export function filtrosVazios(): EstadoFiltros {
  return {
    chaves: new Set(),
    geracao: null,
    ramoId: null,
    papel: null,
    localidade: null,
    anoDe: null,
    anoAte: null,
    referenciaId: null,
  }
}

export function temFiltroAtivo(f: EstadoFiltros): boolean {
  return (
    f.chaves.size > 0 ||
    f.geracao != null ||
    f.ramoId != null ||
    f.papel != null ||
    !!f.localidade ||
    f.anoDe != null ||
    f.anoAte != null
  )
}

export function contarAtivos(f: EstadoFiltros): number {
  let n = f.chaves.size
  if (f.geracao != null) n++
  if (f.ramoId != null) n++
  if (f.papel != null) n++
  if (f.localidade) n++
  if (f.anoDe != null || f.anoAte != null) n++
  return n
}

const SITUACOES_PENDENTES: SituacaoDocumental[] = ["pendente", "bloqueado", "em_andamento"]

export interface ContextoFiltro {
  grafo: GrafoGenealogico
  analise: AnaliseArvore
  documental: ProjecaoDocumental
}

/**
 * Aplica os filtros e devolve os ids que CASAM. Conjuntos derivados
 * (ascendentes, descendentes, ramo) são calculados uma vez, não por pessoa —
 * é o que mantém o filtro instantâneo numa árvore grande.
 */
export function aplicarFiltros(ctx: ContextoFiltro, f: EstadoFiltros): Set<number> {
  const { grafo, analise, documental } = ctx
  const todos = grafo.pessoas

  if (!temFiltroAtivo(f)) return new Set(todos.map((p) => p.id))

  const referencia = f.referenciaId
  const ascendentes = f.chaves.has("ascendentes") && referencia != null ? grafo.ancestrais(referencia) : null
  const descendentes = f.chaves.has("descendentes") && referencia != null ? grafo.descendentes(referencia) : null
  const ramo = f.ramoId != null ? new Set<number>([f.ramoId, ...grafo.descendentes(f.ramoId)]) : null
  const localidadeAlvo = f.localidade ? normalizar(f.localidade) : null

  const casa = new Set<number>()

  for (const p of todos) {
    const a = analise.porPessoa.get(p.id)

    if (f.chaves.has("requerentes")) {
      const r = String(p.requerente || "").toLowerCase()
      if (r !== "sim" && r !== "maior" && r !== "menor") continue
    }
    if (ascendentes && !ascendentes.has(p.id)) continue
    if (descendentes && !descendentes.has(p.id)) continue
    if (ramo && !ramo.has(p.id)) continue

    if (f.chaves.has("incompletas") && (a?.completude ?? 100) >= 100) continue
    if (f.chaves.has("inconsistencia") && !a?.severidadeMax) continue

    if (f.chaves.has("pendencia_documental")) {
      const ind = indicadorDaPessoa(
        documental,
        p.id,
        grafo.unioesDe(p.id).map((u) => u.id),
      )
      if (!SITUACOES_PENDENTES.includes(ind.situacao)) continue
    }

    const falecida = p.vivo === false || !!p.data_obito
    if (f.chaves.has("vivas") && falecida) continue
    if (f.chaves.has("falecidas") && !falecida) continue

    // "Casada" é ter UNIÃO cadastrada, não o campo `casado` do cadastro: o campo
    // é declaração, a união é o fato de onde nasce a exigência da certidão de
    // casamento. Quem filtra por casadas está procurando essa exigência.
    if (f.chaves.has("casadas") && grafo.unioesDe(p.id).length === 0) continue

    if (f.geracao != null && a?.geracao !== f.geracao) continue
    if (f.papel != null && a?.papel !== f.papel) continue

    if (localidadeAlvo) {
      const locais = [p.local_nasc, p.estado_nasc, p.pais_nasc, p.local_emigracao, p.porto_chegada]
        .map((v) => normalizar(v))
        .filter(Boolean)
      const uniao = grafo.unioesDe(p.id).map((u) => normalizar(u.local)).filter(Boolean)
      if (![...locais, ...uniao].some((l) => l.includes(localidadeAlvo))) continue
    }

    if (f.anoDe != null || f.anoAte != null) {
      const ano = anoDeVida(p.data_nasc) ?? anoDeVida(p.data_obito)
      if (ano == null) continue
      if (f.anoDe != null && ano < f.anoDe) continue
      if (f.anoAte != null && ano > f.anoAte) continue
    }

    casa.add(p.id)
  }

  return casa
}

function anoDeVida(v: Date | string | null | undefined): number | null {
  if (!v) return null
  if (typeof v === "string") {
    const m = v.match(/^(\d{4})/)
    if (m) return Number(m[1])
  }
  const d = v instanceof Date ? v : new Date(v)
  return isNaN(d.getTime()) ? null : d.getUTCFullYear()
}

export const ROTULO_FILTRO: Record<ChaveFiltro, string> = {
  requerentes: "Requerentes",
  ascendentes: "Ascendentes do requerente",
  descendentes: "Descendentes do requerente",
  incompletas: "Cadastro incompleto",
  inconsistencia: "Com inconsistência",
  pendencia_documental: "Com pendência documental",
  vivas: "Vivas",
  falecidas: "Falecidas",
  casadas: "Casadas",
}

/** Filtros que se anulam entre si — a UI desliga o oposto ao ligar um. */
export const OPOSTOS: Partial<Record<ChaveFiltro, ChaveFiltro>> = {
  vivas: "falecidas",
  falecidas: "vivas",
  ascendentes: "descendentes",
  descendentes: "ascendentes",
}

export function alternarFiltro(f: EstadoFiltros, chave: ChaveFiltro): EstadoFiltros {
  const chaves = new Set(f.chaves)
  if (chaves.has(chave)) {
    chaves.delete(chave)
  } else {
    chaves.add(chave)
    const oposto = OPOSTOS[chave]
    if (oposto) chaves.delete(oposto)
  }
  return { ...f, chaves }
}

// src/lib/genealogia/motor/facetas.ts
//
// ÍNDICE DE SOBRENOMES E LOCALIDADES — as duas portas de entrada reais.
//
// Buscar por nome só funciona quando o operador sabe o nome. Na prática ele
// chega pelo outro lado: "quem é dessa comune?", "quantas grafias de Bianchi
// existem aqui?", "onde estão os Rossi de Vêneto?". É assim que se trabalha um
// dossiê antes de pedir certidão, e é o que o FamilySearch resolve com índices
// navegáveis em vez de uma caixa de busca só.
//
// A entrega aqui é diferente de uma contagem: sobrenomes são agrupados pela
// CHAVE FONÉTICA, então Bianchi/Bianqui/Bianchy caem no mesmo grupo com as
// variantes visíveis. É exatamente onde mora a duplicidade que ninguém enxerga
// numa lista alfabética — porque numa lista alfabética elas ficam a três telas
// de distância uma da outra.
//
// Projeção pura sobre o grafo. Nada persistido, nada inventado.

import type { GrafoGenealogico } from "./grafo"
import { chaveFonetica, normalizar } from "./texto"

export interface FacetaSobrenome {
  /** Grafia mais frequente — o rótulo que o operador reconhece. */
  rotulo: string
  chave: string
  total: number
  /** Todas as grafias encontradas, da mais para a menos frequente. */
  variantes: Array<{ grafia: string; total: number }>
  pessoaIds: number[]
  /** Intervalo de anos de nascimento conhecidos. */
  anoDe: number | null
  anoAte: number | null
  /** Quantos desse sobrenome estão na linha de cidadania. */
  naLinha: number
}

export interface FacetaLocalidade {
  rotulo: string
  chave: string
  total: number
  pessoaIds: number[]
  /** Papel do lugar na história da família — um lugar pode ter vários. */
  papeis: Array<"nascimento" | "casamento" | "emigracao" | "chegada" | "batismo">
  pais: string | null
}

export interface Facetas {
  sobrenomes: FacetaSobrenome[]
  localidades: FacetaLocalidade[]
  /** Sobrenomes com mais de uma grafia — candidatos diretos a conferência. */
  sobrenomesComVariacao: FacetaSobrenome[]
}

interface AcumuladorSobrenome {
  chave: string
  grafias: Map<string, number>
  pessoaIds: number[]
  anoDe: number | null
  anoAte: number | null
  naLinha: number
}

interface AcumuladorLocal {
  chave: string
  grafias: Map<string, number>
  pessoaIds: Set<number>
  papeis: Set<FacetaLocalidade["papeis"][number]>
  pais: string | null
}

export interface OpcoesFacetas {
  /** Ids na linha de cidadania — só para contabilizar relevância. */
  linhaCidadania?: Iterable<number>
  /** Corte de itens por faceta. 0 = sem corte. */
  limite?: number
}

export function montarFacetas(g: GrafoGenealogico, opcoes: OpcoesFacetas = {}): Facetas {
  const naLinha = new Set(opcoes.linhaCidadania ?? [])
  const limite = opcoes.limite ?? 0

  const porSobrenome = new Map<string, AcumuladorSobrenome>()
  const porLocal = new Map<string, AcumuladorLocal>()

  const registrarLocal = (
    valor: string | null | undefined,
    pessoaId: number,
    papel: FacetaLocalidade["papeis"][number],
    pais: string | null | undefined,
  ) => {
    const bruto = (valor ?? "").trim()
    if (!bruto) return
    const chave = normalizar(bruto)
    if (!chave) return
    let acc = porLocal.get(chave)
    if (!acc) {
      acc = { chave, grafias: new Map(), pessoaIds: new Set(), papeis: new Set(), pais: null }
      porLocal.set(chave, acc)
    }
    acc.grafias.set(bruto, (acc.grafias.get(bruto) ?? 0) + 1)
    acc.pessoaIds.add(pessoaId)
    acc.papeis.add(papel)
    if (!acc.pais && pais) acc.pais = pais
  }

  for (const p of g.pessoas) {
    // ---- sobrenome ----
    const bruto = (p.sobrenome ?? "").trim()
    if (bruto) {
      const chave = chaveFonetica(bruto) || normalizar(bruto)
      let acc = porSobrenome.get(chave)
      if (!acc) {
        acc = { chave, grafias: new Map(), pessoaIds: [], anoDe: null, anoAte: null, naLinha: 0 }
        porSobrenome.set(chave, acc)
      }
      acc.grafias.set(bruto, (acc.grafias.get(bruto) ?? 0) + 1)
      acc.pessoaIds.push(p.id)
      if (naLinha.has(p.id)) acc.naLinha++

      const ano = anoNascimento(p.data_nasc)
      if (ano != null) {
        acc.anoDe = acc.anoDe == null ? ano : Math.min(acc.anoDe, ano)
        acc.anoAte = acc.anoAte == null ? ano : Math.max(acc.anoAte, ano)
      }
    }

    // ---- localidades ----
    registrarLocal(p.local_nasc, p.id, "nascimento", p.pais_nasc)
    registrarLocal(p.local_batismo, p.id, "batismo", p.pais_nasc)
    registrarLocal(p.local_emigracao, p.id, "emigracao", p.pais_nasc)
    registrarLocal(p.porto_embarque, p.id, "emigracao", p.pais_nasc)
    registrarLocal(p.porto_chegada, p.id, "chegada", p.pais_destino)
  }

  for (const u of g.unioes) {
    if (u.pessoa1Id != null) registrarLocal(u.local, u.pessoa1Id, "casamento", u.pais)
    if (u.pessoa2Id != null) registrarLocal(u.local, u.pessoa2Id, "casamento", u.pais)
  }

  const sobrenomes: FacetaSobrenome[] = [...porSobrenome.values()]
    .map((acc) => {
      const variantes = [...acc.grafias.entries()]
        .map(([grafia, total]) => ({ grafia, total }))
        .sort((a, b) => b.total - a.total || a.grafia.localeCompare(b.grafia))
      return {
        rotulo: variantes[0]?.grafia ?? acc.chave,
        chave: acc.chave,
        total: acc.pessoaIds.length,
        variantes,
        pessoaIds: acc.pessoaIds,
        anoDe: acc.anoDe,
        anoAte: acc.anoAte,
        naLinha: acc.naLinha,
      }
    })
    // Relevância antes de alfabeto: quem tem mais gente (e mais linha) primeiro.
    .sort((a, b) => b.naLinha - a.naLinha || b.total - a.total || a.rotulo.localeCompare(b.rotulo))

  const localidades: FacetaLocalidade[] = [...porLocal.values()]
    .map((acc) => {
      const melhor = [...acc.grafias.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )[0]
      return {
        rotulo: melhor?.[0] ?? acc.chave,
        chave: acc.chave,
        total: acc.pessoaIds.size,
        pessoaIds: [...acc.pessoaIds],
        papeis: [...acc.papeis],
        pais: acc.pais,
      }
    })
    .sort((a, b) => b.total - a.total || a.rotulo.localeCompare(b.rotulo))

  return {
    sobrenomes: limite > 0 ? sobrenomes.slice(0, limite) : sobrenomes,
    localidades: limite > 0 ? localidades.slice(0, limite) : localidades,
    sobrenomesComVariacao: sobrenomes.filter((s) => s.variantes.length > 1),
  }
}

function anoNascimento(v: Date | string | null | undefined): number | null {
  if (!v) return null
  if (typeof v === "string") {
    const m = v.match(/^(\d{4})/)
    return m ? Number(m[1]) : null
  }
  const d = v instanceof Date ? v : new Date(v)
  return isNaN(d.getTime()) ? null : d.getUTCFullYear()
}

/** Filtro incremental sobre as facetas — a lista responde enquanto se digita. */
export function filtrarFacetas<T extends { rotulo: string; chave: string }>(
  itens: T[],
  termo: string,
): T[] {
  const t = normalizar(termo)
  if (!t) return itens
  const fon = chaveFonetica(termo)
  return itens.filter(
    (i) => normalizar(i.rotulo).includes(t) || (!!fon && i.chave.includes(fon)),
  )
}

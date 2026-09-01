// src/lib/relatorios/motor/dominios/_comuns.ts
//
// O que se repete entre domínios — e SÓ isso.
//
// Cuidado deliberado: aqui não entra nada de negócio. Formatar data e montar um
// intervalo é mecânica; "quais são os status" ou "quais são os países" é
// cadastro, e cada domínio busca na fonte canônica dele.

import { fimDoDia, inicioDoDia } from "../datas"
import type { FonteDeOpcoes, ValorDeFiltro } from "../tipos"

export const dataBR = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("pt-BR") : null

/** Intervalo de datas → cláusula Prisma, com `ate` inclusivo (23:59:59.999). */
export function periodo(campo: string, v: ValorDeFiltro) {
  if (v.tipo !== "intervalo_data" || (!v.de && !v.ate)) return null
  return { [campo]: { ...(v.de ? { gte: inicioDoDia(v.de) } : {}), ...(v.ate ? { lte: fimDoDia(v.ate) } : {}) } }
}

/** Catálogo FECHADO de negócio (enum canônico). Não é cadastro editável. */
export const catalogo = (valores: readonly string[]): FonteDeOpcoes => ({
  tipo: "catalogo",
  valores: valores.map((v) => ({
    valor: v,
    rotulo: v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " "),
  })),
})

export const cadastro = (chave: string): FonteDeOpcoes => ({ tipo: "cadastro", chave })

/** multi_selecao → `{ campo: { in: [...] } }`. */
export const emLista = (campo: string) => (v: ValorDeFiltro) =>
  v.tipo === "multi_selecao" && v.valores.length ? { [campo]: { in: v.valores } } : null

/** multi_selecao de IDs → `{ campo: { in: [1,2] } }`. */
export const emListaId = (campo: string) => (v: ValorDeFiltro) =>
  v.tipo === "multi_selecao" && v.valores.length
    ? { [campo]: { in: v.valores.map(Number).filter(Number.isInteger) } }
    : null

/** entidade → `{ campo: id }`. */
export const igualId = (campo: string) => (v: ValorDeFiltro) =>
  v.tipo === "entidade" ? { [campo]: v.id } : null

/** texto → `contains`, sem diferenciar maiúscula. */
export const contem = (campo: string) => (v: ValorDeFiltro) =>
  v.tipo === "texto" && v.texto.trim() ? { [campo]: { contains: v.texto.trim(), mode: "insensitive" } } : null

export const ehBooleano = (campo: string) => (v: ValorDeFiltro) =>
  v.tipo === "booleano" ? { [campo]: v.valor } : null

/** "Há mais de N dias sem" → o campo é ANTERIOR ao limite. */
export function antesDeNDias(campo: string, v: ValorDeFiltro) {
  if (v.tipo !== "numero" || !Number.isFinite(v.numero)) return null
  const limite = new Date()
  limite.setDate(limite.getDate() - v.numero)
  return { [campo]: { lt: limite } }
}

/** Dias corridos entre duas datas (ou até hoje). Derivado, nunca persistido. */
export function diasEntre(de: Date | string | null | undefined, ate?: Date | string | null): number | null {
  if (!de) return null
  const a = new Date(de).getTime()
  const b = ate ? new Date(ate).getTime() : Date.now()
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.floor((b - a) / 86_400_000)
}

/** Idade em anos completos NA LEITURA. Nunca gravada. */
export function idade(nascimento: Date | string | null | undefined): number | null {
  if (!nascimento) return null
  const n = new Date(nascimento)
  if (Number.isNaN(n.getTime())) return null
  const hoje = new Date()
  let i = hoje.getFullYear() - n.getFullYear()
  const m = hoje.getMonth() - n.getMonth()
  if (m < 0 || (m === 0 && hoje.getDate() < n.getDate())) i--
  return i
}

/** Agrupamento por mês de um campo de data. */
export const porMes = (campo: string, rotulo: string) => ({
  key: `mes_${campo}`,
  rotulo,
  de: (l: any) => {
    const v = l[campo]
    if (!v) return { chave: "sem-data", rotulo: "— sem data —" }
    const d = new Date(v)
    return {
      chave: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      rotulo: d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
    }
  },
})

/** Agrupamento por um campo simples de texto. */
export const porCampo = (key: string, rotulo: string, extrair: (l: any) => string | null | undefined) => ({
  key,
  rotulo,
  de: (l: any) => {
    const v = extrair(l)
    return { chave: v ?? "sem", rotulo: v ?? `— sem ${rotulo.toLowerCase()} —` }
  },
})

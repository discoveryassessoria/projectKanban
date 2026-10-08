// src/services/genealogia/titular-uniao.ts
//
// TITULAR OPERACIONAL de uma necessidade cujo sujeito é uma UNIÃO (certidão de
// casamento): a Necessidade/Documento exige um dono pessoa, e a União tem dois
// cônjuges — mas só um deles está na linha de transmissão do processo.
//
// Regra do usuário (24/09/2026, achado real: Itiberê Barreto Cibils tinha
// casamento na árvore e nenhuma necessidade de certidão de casamento apareceu
// na Central Operacional): "no casamento, sempre ele vai ver a linha de
// transmissão... isso é o importante, e não quem é a pessoa 1 ou pessoa 2."
// `pessoa1Id`/`pessoa2Id` são só como a União foi gravada no banco — não têm
// nenhum significado de negócio. Antes, todo lugar que precisava de um titular
// escolhia sempre `pessoa1Id`; quando o cônjuge de fora da linha reta caía
// nesse lado, o titular virava alguém que nem está no roster da fase, e o
// bloco de trabalho inteiro sumia da tela (ia para "sem dono").
import type { Pessoa } from "@prisma/client"

type DadosDoConjuge = Pick<Pessoa, "linhaReta"> & Partial<Pick<Pessoa, "documentacao" | "documentosExigidos">>

export interface UniaoParaTitular {
  pessoa1Id: number
  pessoa2Id: number
  pessoa1?: DadosDoConjuge | null
  pessoa2?: DadosDoConjuge | null
}

/** Seleção Prisma mínima para alimentar {@link titularDaUniao}. */
export const SELECT_UNIAO_PARA_TITULAR = {
  pessoa1Id: true,
  pessoa2Id: true,
  pessoa1: { select: { linhaReta: true, documentacao: true, documentosExigidos: true } },
  pessoa2: { select: { linhaReta: true, documentacao: true, documentosExigidos: true } },
} as const

/** A lista gravada em `Pessoa.documentosExigidos` inclui casamento? `null`/ausente = os três marcados. */
function listaMantemCasamento(v: unknown): boolean {
  if (v == null) return true
  return Array.isArray(v) && v.includes("CAS")
}

/** O cônjuge MANTÉM a certidão de casamento? Dispensado (fora da linha reta e sem documentação) nunca; senão, vale a lista gravada. */
function mantemCasamento(c: DadosDoConjuge | null | undefined): boolean {
  if (!c) return false
  if (!c.linhaReta && c.documentacao !== true) return false
  return listaMantemCasamento(c.documentosExigidos)
}

/**
 * O DONO DA CERTIDÃO DE CASAMENTO (regra única, 08/10/2026): o cônjuge da LINHA RETA que MANTÉM o casamento. Pessoa dispensada (sem necessidade de documento)
 * nunca é dono — e por isso não herda a necessidade da união. Se nenhum cônjuge da linha reta o mantém, o dono é o outro que o mantém; se ninguém o mantém
 * (necessidade sem causa) ou os dados dos cônjuges não vieram na leitura, cai no comportamento anterior (linha reta primeiro, depois pessoa1).
 * Todo lugar que precisa do «titular» do casamento chama esta função; nenhum escolhe lado por conta própria.
 */
export function titularDaUniao(uniao: UniaoParaTitular | null | undefined): number | null {
  if (!uniao) return null
  const completo = uniao.pessoa1?.documentacao !== undefined && uniao.pessoa2?.documentacao !== undefined
  if (completo) {
    const candidatos = [
      { id: uniao.pessoa1Id, c: uniao.pessoa1 },
      { id: uniao.pessoa2Id, c: uniao.pessoa2 },
    ].filter((x) => mantemCasamento(x.c))
    const dono = candidatos.find((x) => x.c?.linhaReta) ?? candidatos[0]
    if (dono) return dono.id
  }
  if (uniao.pessoa1?.linhaReta) return uniao.pessoa1Id
  if (uniao.pessoa2?.linhaReta) return uniao.pessoa2Id
  // Nenhum dos dois marcado linha reta — mantém o determinismo anterior em vez de falhar.
  return uniao.pessoa1Id
}

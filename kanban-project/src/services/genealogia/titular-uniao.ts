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

export interface UniaoParaTitular {
  pessoa1Id: number
  pessoa2Id: number
  pessoa1?: Pick<Pessoa, "linhaReta"> | null
  pessoa2?: Pick<Pessoa, "linhaReta"> | null
}

/** Seleção Prisma mínima para alimentar {@link titularDaUniao}. */
export const SELECT_UNIAO_PARA_TITULAR = {
  pessoa1Id: true,
  pessoa2Id: true,
  pessoa1: { select: { linhaReta: true } },
  pessoa2: { select: { linhaReta: true } },
} as const

export function titularDaUniao(uniao: UniaoParaTitular | null | undefined): number | null {
  if (!uniao) return null
  if (uniao.pessoa1?.linhaReta) return uniao.pessoa1Id
  if (uniao.pessoa2?.linhaReta) return uniao.pessoa2Id
  // Nenhum dos dois marcado linha reta — não deveria ocorrer numa união com
  // necessidade documental aberta (a Genealogia só materializa a partir da
  // linha reta). Mantém o determinismo anterior em vez de falhar.
  return uniao.pessoa1Id
}

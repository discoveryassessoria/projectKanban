// src/lib/busca-sem-acento.ts
// ============================================================================
// BUSCA QUE NÃO DEPENDE DE ACENTO NEM DE MAIÚSCULA — "antao" acha "Antão", "sanchez" acha "Sánchez", "SANCHES" acha "Sanches".
// O Postgres `mode: insensitive` ignora só a caixa; o acento exige a extensão `unaccent`, que não está garantida. Aqui o texto e a coluna
// passam pelo MESMO `translate` (sem extensão): a coluna é lida no banco, o termo é normalizado em JS com a mesma tabela.
// A tabela e as colunas vêm de uma LISTA FIXA (nunca do usuário): só o termo é parâmetro, e ele nunca vira SQL.
// ============================================================================
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

const COM_ACENTO = 'áàâãäåéèêëíìîïóòôõöúùûüçñ'
const SEM_ACENTO = 'aaaaaaeeeeiiiiooooouuuucn'

/** minúsculas, sem acento, sem espaços nas pontas — a forma comparada. */
export function normalizarBusca(t: string): string {
  let s = t.toLowerCase().trim()
  for (let i = 0; i < COM_ACENTO.length; i++) s = s.split(COM_ACENTO[i]).join(SEM_ACENTO[i])
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export const COLUNAS_DA_BUSCA = {
  Processo: ['nome', 'codigo'],
  Familia: ['nome'],
  Requerente: ['nome', 'publicCode'],
  Contratante: ['nome', 'publicCode'],
} as const
export type TabelaDaBusca = keyof typeof COLUNAS_DA_BUSCA

/** Os ids cujas colunas de busca CONTÊM o termo (sem acento, sem caixa). */
export async function idsQueContem(tabela: TabelaDaBusca, termo: string, limite = 500): Promise<number[]> {
  const t = normalizarBusca(termo)
  if (!t) return []
  const padrao = `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const condicoes = COLUNAS_DA_BUSCA[tabela].map(
    (c) => Prisma.sql`translate(lower(${Prisma.raw(`"${c}"`)}), ${COM_ACENTO}, ${SEM_ACENTO}) LIKE ${padrao} ESCAPE '\\'`,
  )
  const linhas = await prisma.$queryRaw<Array<{ id: number }>>(
    Prisma.sql`SELECT "id" FROM ${Prisma.raw(`"${tabela}"`)} WHERE ${Prisma.join(condicoes, ' OR ')} ORDER BY "id" DESC LIMIT ${limite}`,
  )
  return linhas.map((l) => l.id)
}

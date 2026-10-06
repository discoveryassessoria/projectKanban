// src/services/genealogia/geracoes-da-arvore.ts
// ============================================================================
// A GERAÇÃO de verdade de TODAS as pessoas de uma ou mais árvores (G1 = o ancestral que origina o direito, filhos G2…, cônjuge na geração do
// parceiro), calculada AGORA pela filiação — `calcularGeracoes` (puro). SÓ LEITURA: nada é gravado, `numeroLinhagem` não é tocado.
// Usado pelas listas de tarefa (Operação/Torre), pela página do processo e pelo Relatório de controle: uma conta só para o "G" e para a ordem das certidões.
// ============================================================================
import type { Prisma, PrismaClient } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { calcularGeracoes } from "@/src/lib/genealogia/geracao"
import { PESSOA_ATIVA } from "@/src/lib/genealogia/vinculo-ativo"

type Leitor = PrismaClient | Prisma.TransactionClient

/** `arvoreId → (pessoaId → geração | null)`. Uma leitura de pessoas e uma de uniões para o conjunto de árvores. */
export async function geracoesDasArvores(arvoreIds: Array<number | null | undefined>, db: Leitor = prisma): Promise<Map<number, Map<number, number | null>>> {
  const ids = [...new Set(arvoreIds.filter((x): x is number => x != null))]
  const r = new Map<number, Map<number, number | null>>()
  if (ids.length === 0) return r
  const todas = await db.pessoa.findMany({
    where: { arvoreId: { in: ids }, ...PESSOA_ATIVA },
    select: { id: true, arvoreId: true, paiId: true, maeId: true, linhaReta: true, requerente: true },
  })
  const idsPessoas = todas.map((p) => p.id)
  const unioes = idsPessoas.length
    ? await db.uniao.findMany({ where: { OR: [{ pessoa1Id: { in: idsPessoas } }, { pessoa2Id: { in: idsPessoas } }] }, select: { pessoa1Id: true, pessoa2Id: true } })
    : []
  for (const a of ids) {
    const daArvore = todas.filter((p) => p.arvoreId === a)
    const idsA = new Set(daArvore.map((p) => p.id))
    r.set(a, calcularGeracoes(daArvore, unioes.filter((u) => idsA.has(u.pessoa1Id) && idsA.has(u.pessoa2Id))))
  }
  return r
}

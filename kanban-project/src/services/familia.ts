// src/services/familia.ts
//
// FAMÍLIA — leitura, e a EXCLUSÃO do resíduo.
//
// ─── O QUE ESTE ARQUIVO DEIXOU DE FAZER, E POR QUÊ ──────────────────────────
// Havia aqui um `garantirFamiliaParaArvore`, do backfill CP-1, que criava uma
// Família sempre que uma árvore era criada, copiando o NOME DA ÁRVORE. Como a
// tela manda `Árvore do Processo 458` como nome da árvore, nasciam famílias
// chamadas assim — uma por tentativa de criar árvore.
//
// Resultado em produção: 63 famílias, das quais 61 órfãs (sem processo e sem
// árvore), com nomes como "Árvore do Processo 464", "]'[;plokijnb" e "teste"
// repetido dezesseis vezes. O relatório dizia "63 famílias" e estava certo — que
// é pior que estar errado, porque ninguém desconfia.
//
// Isso violava a Regra 1 em três pontos: cadastro nascendo pela porta da
// operação, nome fabricado por código e serviço que GARANTE em vez de RECUSAR.
// Era código de migração que ficou ligado no caminho normal.
//
// Agora: família é escolhida ou cadastrada por gente. Árvore e processo nascem
// sem ela — `familiaId` é opcional — e ninguém inventa nome de família.

import { prisma } from "@/lib/prisma"

/**
 * HERDA a família da árvore para o processo, quando ela JÁ EXISTE.
 *
 * Só propaga vínculo — nunca cria. Se a árvore não tem família, o processo
 * também fica sem, e alguém escolhe uma depois. Devolve o id herdado ou `null`.
 */
export async function herdarFamiliaDaArvore(processoId: number): Promise<number | null> {
  const p = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true, familiaId: true, arvoreId: true },
  })
  if (!p) return null
  if (p.familiaId) return p.familiaId
  if (!p.arvoreId) return null

  const arvore = await prisma.arvore.findUnique({
    where: { id: p.arvoreId },
    select: { familiaId: true },
  })
  if (!arvore?.familiaId) return null

  await prisma.processo.update({ where: { id: p.id }, data: { familiaId: arvore.familiaId } })
  return arvore.familiaId
}

/**
 * APAGA A FAMÍLIA QUE FICOU INALCANÇÁVEL.
 *
 * Chamada DEPOIS de excluir um processo ou uma árvore, com a família que estava
 * vinculada a ele. Se sobrou algum processo ou alguma árvore apontando para ela,
 * não faz nada: a família continua sendo de alguém. Se não sobrou ninguém, ela
 * não é mais alcançável por porta nenhuma do sistema — é resíduo, e sai.
 *
 * O recorte é estreito de propósito: só toca na família DAQUILO que acabou de
 * ser excluído. Varrer o cadastro atrás de órfãs aqui apagaria a família que
 * alguém cadastrou hoje para usar amanhã.
 */
export async function removerFamiliaSeOrfa(familiaId: number | null | undefined): Promise<boolean> {
  if (familiaId == null) return false
  const [processos, arvores] = await Promise.all([
    prisma.processo.count({ where: { familiaId } }),
    prisma.arvore.count({ where: { familiaId } }),
  ])
  if (processos > 0 || arvores > 0) return false
  await prisma.familia.delete({ where: { id: familiaId } })
  return true
}

/**
 * Resolve a Família de um Processo (DUAL-READ):
 *  1) familiaId direto no processo;
 *  2) senão, a família da árvore vinculada;
 *  3) senão, null (ainda não backfillado).
 */
export async function resolverFamiliaIdDoProcesso(
  processoId: number
): Promise<number | null> {
  const p = await prisma.processo.findUnique({
    where: { id: processoId },
    select: {
      familiaId: true,
      arvore: { select: { familiaId: true } },
    },
  })
  if (!p) return null
  return p.familiaId ?? p.arvore?.familiaId ?? null
}

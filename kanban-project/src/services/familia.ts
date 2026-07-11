// src/services/familia.ts
// CP-1 — camada de leitura/forward-fill de Família (Regras 10/11/12).
//
// Regra de negócio aprovada: 1 Família por Árvore (singleton por processo/árvore).
// Backend-first + dual-read: quando o vínculo novo (familiaId) existe, ele manda;
// senão derivamos da árvore. NUNCA há dual-write — família é um fato NOVO,
// gravado só nos campos novos.

import { prisma } from "@/lib/prisma"

/**
 * Garante uma Família para uma Árvore (1:1 do CP-1).
 * Se a árvore já tem família, retorna-a; senão cria e vincula (atômico).
 */
export async function garantirFamiliaParaArvore(arvoreId: number): Promise<number> {
  const arvore = await prisma.arvore.findUnique({
    where: { id: arvoreId },
    select: { id: true, nome: true, familiaId: true },
  })
  if (!arvore) throw new Error(`Árvore ${arvoreId} não encontrada`)
  if (arvore.familiaId) return arvore.familiaId

  return await prisma.$transaction(async (tx) => {
    // Recheca dentro da transação (evita corrida criando duas famílias).
    const atual = await tx.arvore.findUnique({
      where: { id: arvoreId },
      select: { familiaId: true, nome: true },
    })
    if (atual?.familiaId) return atual.familiaId

    const familia = await tx.familia.create({
      data: { nome: atual?.nome?.trim() || `Família (árvore ${arvoreId})` },
    })
    await tx.arvore.update({
      where: { id: arvoreId },
      data: { familiaId: familia.id },
    })
    return familia.id
  })
}

/**
 * Garante uma Família para um Processo (forward-fill do CP-1, Regra 11).
 * Precedência: familiaId existente → família da árvore → família singleton
 * (processo sem árvore). Sempre grava só no campo novo (sem dual-write).
 */
export async function garantirFamiliaParaProcesso(processoId: number): Promise<number> {
  const p = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true, nome: true, familiaId: true, arvoreId: true },
  })
  if (!p) throw new Error(`Processo ${processoId} não encontrado`)
  if (p.familiaId) return p.familiaId

  if (p.arvoreId) {
    const fid = await garantirFamiliaParaArvore(p.arvoreId)
    await prisma.processo.update({ where: { id: p.id }, data: { familiaId: fid } })
    return fid
  }

  // Processo sem árvore → família singleton própria.
  return await prisma.$transaction(async (tx) => {
    const atual = await tx.processo.findUnique({
      where: { id: processoId },
      select: { familiaId: true, nome: true },
    })
    if (atual?.familiaId) return atual.familiaId
    const familia = await tx.familia.create({
      data: { nome: atual?.nome?.trim() || `Família (processo ${processoId})` },
    })
    await tx.processo.update({ where: { id: processoId }, data: { familiaId: familia.id } })
    return familia.id
  })
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

// src/app/api/gerenciamento/taxas-pagamento/identidade-server.ts
// ============================================================================
// Resolução SERVER-SIDE da identidade da Taxa (nome/código automáticos) e da
// UNICIDADE lógica. O frontend nunca é autoridade sobre nome/código: eles são
// gerados aqui a partir dos cadastros reais (Forma/Bandeira) e da finalidade.
// ============================================================================
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { nomeTaxaAuto, chaveUnicidade, formaPrincipalId } from '@/lib/financeiro/taxa-identidade'

export interface IdentidadeResolvida {
  name: string
  formaId: number | null
  adquirenteId: number | null
  bandeiraId: number | null
  finalidade: string | null
}

/**
 * Gera o NOME canônico da taxa a partir dos cadastros (Forma/Bandeira) e da
 * finalidade — nunca do texto que o cliente mandou. `atual` (no PUT) preserva o
 * nome quando o body não permite recomputar (sem forma resolvível).
 */
export async function resolverIdentidade(
  b: Record<string, unknown>,
  atual?: { name: string; formasAplicaveis?: number[]; formaPagamentoId?: number | null; adquirenteId?: number | null; bandeiraId?: number | null; finalidade?: string | null } | null,
): Promise<IdentidadeResolvida> {
  const int = (v: unknown): number | null => {
    if (v === undefined || v === null || v === '') return null
    const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null
  }
  const listaInt = (v: unknown): number[] =>
    Array.isArray(v) ? v.map((x) => Math.trunc(Number(x))).filter((n) => Number.isFinite(n)) : []

  const formasAplicaveis = 'formasAplicaveis' in b ? listaInt(b.formasAplicaveis) : (atual?.formasAplicaveis ?? [])
  const formaPagamentoId = 'formaPagamentoId' in b ? int(b.formaPagamentoId) : (atual?.formaPagamentoId ?? null)
  const formaId = formaPrincipalId({ formasAplicaveis, formaPagamentoId })
  const adquirenteId = 'adquirenteId' in b ? int(b.adquirenteId) : (atual?.adquirenteId ?? null)
  const bandeiraId = 'bandeiraId' in b ? int(b.bandeiraId) : (atual?.bandeiraId ?? null)
  const finalidade = 'finalidade' in b
    ? (b.finalidade ? String(b.finalidade).toUpperCase() : null)
    : (atual?.finalidade ?? null)

  // Forma e bandeira reais (nome + tipo) vêm do cadastro — id inválido é ignorado.
  const [forma, bandeira] = await Promise.all([
    formaId != null ? prisma.formaPagamentoCadastro.findUnique({ where: { id: formaId }, select: { name: true, type: true } }) : Promise.resolve(null),
    bandeiraId != null ? prisma.bandeira.findUnique({ where: { id: bandeiraId }, select: { nome: true } }) : Promise.resolve(null),
  ])

  const name = forma
    ? nomeTaxaAuto({ formaType: forma.type, formaNome: forma.name, bandeiraNome: bandeira?.nome ?? null, finalidade })
    : (atual?.name ?? '').trim()

  return { name: name || (atual?.name ?? '').trim(), formaId, adquirenteId, bandeiraId, finalidade }
}

/**
 * Rejeita duplicidade LÓGICA: duas tabelas ATIVAS com a mesma combinação de
 * forma × adquirente × bandeira × finalidade × vigência. `exceto` ignora o
 * próprio registro (no PUT). Retorna a taxa conflitante ou null.
 */
export async function acharDuplicata(
  ident: { formaId: number | null; adquirenteId: number | null; bandeiraId: number | null; finalidade: string | null },
  exceto?: number,
): Promise<{ id: number; name: string } | null> {
  const chave = chaveUnicidade(ident)
  // Só compara taxas ativas da mesma forma (filtro barato) e confere a chave completa.
  const candidatas = await prisma.taxaPagamento.findMany({
    where: {
      ativo: true,
      ...(exceto != null ? { id: { not: exceto } } : {}),
      ...(ident.formaId != null ? { formasAplicaveis: { has: ident.formaId } } : {}),
    },
    select: { id: true, name: true, formasAplicaveis: true, formaPagamentoId: true, adquirenteId: true, bandeiraId: true, finalidade: true },
  })
  for (const c of candidatas) {
    const chaveC = chaveUnicidade({
      formaId: formaPrincipalId(c), adquirenteId: c.adquirenteId, bandeiraId: c.bandeiraId,
      finalidade: c.finalidade,
    })
    if (chaveC === chave) return { id: c.id, name: c.name }
  }
  return null
}

/** Próximo código TXP (dentro da transação; sequência atômica). */
export async function proximoCodigoTaxa(tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRawUnsafe<{ ultimo: bigint }[]>(`
    INSERT INTO "CodeSequence" ("scope", "ultimo", "atualizadoEm") VALUES ('TXP', 1, now())
    ON CONFLICT ("scope") DO UPDATE SET "ultimo" = "CodeSequence"."ultimo" + 1, "atualizadoEm" = now()
    RETURNING "ultimo"`)
  return `TXP-${Number(rows[0].ultimo)}`
}

// prisma/consolidar-itemcatalogo-duplicatas.ts
// ============================================================================
// ITEM 2 — Consolidação de duplicatas do ItemCatalogo. SEM PERDA DE DADOS.
//
// Pares duplicados (nome equivalente, diferença só de grafia/typo):
//   • Retificação: manter id 7 "Retificação de Registro"; desativar id 15.
//   • Tradução:    manter id 4 "Tradução Juramentada";   desativar id 11 ("...00...").
//
// Estratégia (não-destrutiva, reversível, idempotente):
//   1. Reponta QUALQUER referência do duplicado → canônico (6 tabelas com FK).
//   2. Marca o duplicado como ativo=false (NÃO deleta) e registra no metadata
//      que foi consolidado no canônico, para auditoria e reversão.
//
// Guarda de identidade: só roda contra um banco com a assinatura de produção.
// Uso:  DIRECT_DATABASE_URL=<prod> npx tsx prisma/consolidar-itemcatalogo-duplicatas.ts [--dry-run]
// ============================================================================
import { PrismaClient } from '@prisma/client'

const url = process.env.DIRECT_DATABASE_URL || process.env.PRISMA_DATABASE_URL
const DRY = process.argv.includes('--dry-run')
const prisma = new PrismaClient({ datasources: { db: { url } } })

/** Pares: [canônico a manter, duplicado a desativar]. */
const PARES: Array<{ manter: number; desativar: number; motivo: string }> = [
  { manter: 7, desativar: 15, motivo: 'Retificação de registros → Retificação de Registro' },
  { manter: 4, desativar: 11, motivo: 'Tradução00Juramentada → Tradução Juramentada' },
]

async function main() {
  // ── identidade ──
  const q = (s: string) => prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(s)
  const tabelas = Number((await q(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`))[0].n)
  const requerentes = Number((await q(`SELECT count(*)::int n FROM "Requerente"`))[0].n).valueOf?.() ?? 0
  if (tabelas < 100 || requerentes < 700) {
    console.error(`[consolidar] ABORTADO: banco sem assinatura de produção (${tabelas} tabelas, ${requerentes} requerentes).`)
    process.exit(1)
  }
  console.log(`[consolidar] alvo confirmado: ${tabelas} tabelas · ${requerentes} requerentes${DRY ? ' · DRY-RUN' : ''}`)

  for (const { manter, desativar, motivo } of PARES) {
    const dup = await prisma.itemCatalogo.findUnique({ where: { id: desativar } })
    if (!dup) { console.log(`[consolidar] id ${desativar} não existe — nada a fazer.`); continue }
    if (dup.ativo === false) { console.log(`[consolidar] id ${desativar} já consolidado — idempotente.`); continue }

    // 1) reponta referências (defensivo — hoje são 0)
    let repontadas = 0
    const repontar = async (fn: () => Promise<{ count: number }>) => { if (!DRY) repontadas += (await fn()).count }
    await repontar(() => prisma.produtoFinanceiro.updateMany({ where: { itemCatalogoId: desativar }, data: { itemCatalogoId: manter } }))
    await repontar(() => prisma.tabelaValor.updateMany({ where: { itemCatalogoId: desativar }, data: { itemCatalogoId: manter } }))
    await repontar(() => prisma.servicoProduto.updateMany({ where: { itemCatalogoId: desativar }, data: { itemCatalogoId: manter } }))
    await repontar(() => prisma.tipoDocumentoCadastro.updateMany({ where: { itemCatalogoId: desativar }, data: { itemCatalogoId: manter } }))
    await repontar(() => prisma.categoriaFinanceira.updateMany({ where: { itemCatalogoId: desativar }, data: { itemCatalogoId: manter } }))
    await repontar(() => prisma.necessidadeDocumental.updateMany({ where: { itemCatalogoId: desativar }, data: { itemCatalogoId: manter } }))

    // 2) desativa o duplicado (preserva o registro — sem DELETE)
    const meta = { ...(typeof dup.metadata === 'object' && dup.metadata ? dup.metadata : {}), consolidadoEm: '2026-07', consolidadoNo: manter, motivoConsolidacao: motivo }
    if (!DRY) {
      await prisma.itemCatalogo.update({ where: { id: desativar }, data: { ativo: false, metadata: meta } })
    }
    console.log(`[consolidar] ${DRY ? '(dry) ' : ''}id ${desativar} desativado → consolidado no id ${manter}; ${repontadas} referência(s) repontada(s). ${motivo}`)
  }

  console.log('[consolidar] OK.')
}

main().catch((e) => { console.error('[consolidar] ERRO:', e); process.exit(1) }).finally(() => prisma.$disconnect())

// LOTE B — RUNNER CLI do backfill: vincula ServicoProduto/ProdutoFinanceiro (ilhas
// legadas) ao ItemCatalogo (mestre) via `code` canônico. ADITIVO: cria itens mestre
// e preenche itemCatalogoId; NÃO apaga nem altera outros campos das ilhas.
//
// Dupla trava: dry-run por padrão; escrita real exige --execute + BACKFILL_EXECUTE=1.
// Idempotente: pula ilhas que já têm itemCatalogoId. main() só roda como script.
//
//   npm run backfill:lote-b:dry
//   BACKFILL_EXECUTE=1 npm run backfill:lote-b

import { PrismaClient, NaturezaItem } from '@prisma/client'
import { planejarServicos, planejarProdutos } from './backfill-lote-b-catalogo.core'

async function main() {
  const prisma = new PrismaClient()
  try {
    const execute = process.argv.includes('--execute') && process.env.BACKFILL_EXECUTE === '1'
    console.log(`[backfill:lote-b] ${execute ? 'EXECUÇÃO REAL' : 'DRY-RUN'}`)

    const [servicos, produtos] = await Promise.all([
      prisma.servicoProduto.findMany({ select: { id: true, code: true, name: true, category: true, itemCatalogoId: true } }),
      prisma.produtoFinanceiro.findMany({ select: { id: true, codigo: true, nome: true, itemCatalogoId: true } }),
    ])

    const planoS = planejarServicos(servicos)
    const planoP = planejarProdutos(produtos)

    console.log('── relatório ──────────────────────────────')
    console.log(`serviços:  ${servicos.length} total · ${servicos.length - planoS.length} já vinculados · ${planoS.length} a vincular`)
    console.log(`produtos:  ${produtos.length} total · ${produtos.length - planoP.length} já vinculados · ${planoP.length} a vincular`)
    console.log('───────────────────────────────────────────')

    if (!execute) {
      console.log('DRY-RUN concluído: nada foi escrito. Para aplicar: BACKFILL_EXECUTE=1 + --execute.')
      return
    }

    let okS = 0
    for (const u of planoS) {
      await prisma.$transaction(async (tx) => {
        const item = await tx.itemCatalogo.upsert({
          where: { code: u.code },
          create: { code: u.code, name: u.name, natureza: NaturezaItem.SERVICO, categoria: u.categoria },
          update: {},
          select: { id: true },
        })
        await tx.servicoProduto.update({ where: { id: u.id }, data: { itemCatalogoId: item.id } })
      })
      okS++
    }
    let okP = 0
    for (const u of planoP) {
      await prisma.$transaction(async (tx) => {
        const item = await tx.itemCatalogo.upsert({
          where: { code: u.code },
          create: { code: u.code, name: u.name, natureza: NaturezaItem.PRODUTO },
          update: {},
          select: { id: true },
        })
        await tx.produtoFinanceiro.update({ where: { id: u.id }, data: { itemCatalogoId: item.id } })
      })
      okP++
    }
    console.log(`OK: ${okS} serviço(s) e ${okP} produto(s) vinculados ao mestre. Campos legados intactos.`)
  } finally {
    await prisma.$disconnect()
  }
}

const invocadoDireto = process.argv[1] ? /backfill-lote-b-catalogo\.ts$/.test(process.argv[1]) : false
if (invocadoDireto) {
  main().catch((e) => { console.error(e); process.exit(1) })
}

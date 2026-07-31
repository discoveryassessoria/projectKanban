// prisma/backfill-config-servicos.ts
// RECONCILIAÇÃO idempotente: cria a Configuração Financeira AUSENTE de Serviços ativos
// (vínculo estrutural itemCatalogoId). NÃO duplica, NÃO apaga, NÃO altera preços nem
// configs já vinculadas. Reexecução segura (só cria o que falta).
//
//   Dry-run (padrão):  npx tsx prisma/backfill-config-servicos.ts
//   Aplicar:           npx tsx prisma/backfill-config-servicos.ts --execute

import { PrismaClient } from '@prisma/client'
import { garantirConfigFinanceiraDeItem } from '../src/services/config-financeira-auto'

const prisma = new PrismaClient()
const EXECUTE = process.argv.includes('--execute')

async function main() {
  const servicos = await prisma.servicoProduto.findMany({
    where: { ativo: true },
    select: { id: true, name: true, itemCatalogoId: true },
    orderBy: { id: 'asc' },
  })

  let criados = 0, jaTinham = 0, semItem = 0
  for (const s of servicos) {
    if (s.itemCatalogoId == null) {
      console.log(`  ⚠️  #${s.id} "${s.name}" sem itemCatalogo — pulado (sincronize o mestre primeiro).`)
      semItem++
      continue
    }
    const existe = await prisma.produtoFinanceiro.findUnique({ where: { itemCatalogoId: s.itemCatalogoId }, select: { id: true } })
    if (existe) { console.log(`  =  #${s.id} "${s.name}" já tem config #${existe.id}`); jaTinham++; continue }

    if (!EXECUTE) {
      console.log(`  +  #${s.id} "${s.name}" CRIARIA config (item ${s.itemCatalogoId})`)
      criados++
      continue
    }
    const r = await prisma.$transaction((tx) => garantirConfigFinanceiraDeItem(tx, { itemCatalogoId: s.itemCatalogoId!, nome: s.name }))
    console.log(`  +  #${s.id} "${s.name}" → config #${r.id} ${r.criado ? 'CRIADA' : '(já existia)'}`)
    if (r.criado) criados++; else jaTinham++
  }

  console.log(`\n${EXECUTE ? 'APLICADO' : 'DRY-RUN'} — serviços ativos: ${servicos.length} | ${EXECUTE ? 'criadas' : 'a criar'}: ${criados} | já tinham: ${jaTinham} | sem item: ${semItem}`)
  if (!EXECUTE) console.log('Rode com --execute para aplicar.')
}

main().catch((e) => { console.error('ERRO:', e); process.exit(1) }).finally(() => prisma.$disconnect())

// prisma/seed-precos-teste.ts
// Cria os 2 preços de teste da fatia Emissão (custo e receita SEPARADOS).
// Roda:  npx tsx prisma/seed-precos-teste.ts
import { prisma } from '@/lib/prisma'

async function main() {
  // limpa versões antigas (o CIT único de 150 EUR, se ainda existir)
  await prisma.produtoFinanceiro.deleteMany({
    where: { codigo: { in: ['CIT', 'CIT_CUSTO', 'CIT_RECEITA'] } },
  })

  const custo = await prisma.produtoFinanceiro.create({
    data: {
      codigo: 'CIT_CUSTO',
      nome: '[TESTE] Certidão Inteiro Teor — Custo',
      naturezaFinanceira: 'cost',
      valorPadrao: 150,
      moedaPadrao: 'BRL',
      ativo: true,
    },
  })
  const receita = await prisma.produtoFinanceiro.create({
    data: {
      codigo: 'CIT_RECEITA',
      nome: '[TESTE] Certidão Inteiro Teor — Receita',
      naturezaFinanceira: 'revenue',
      valorPadrao: 90,
      moedaPadrao: 'EUR',
      ativo: true,
    },
  })

  console.log('✅ Preços de teste criados:')
  console.log(`  CUSTO   #${custo.id}: ${custo.codigo} · ${custo.valorPadrao} ${custo.moedaPadrao} (${custo.naturezaFinanceira})`)
  console.log(`  RECEITA #${receita.id}: ${receita.codigo} · ${receita.valorPadrao} ${receita.moedaPadrao} (${receita.naturezaFinanceira})`)
}

main().catch((e) => console.error(e)).finally(() => prisma.$disconnect())
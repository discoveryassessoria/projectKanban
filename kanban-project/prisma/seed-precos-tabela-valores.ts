// prisma/seed-precos-tabela-valores.ts
// LOTE A · B3 — Cria linhas de PREÇO na TabelaValor ligadas ao Catálogo Mestre.
// Valores = PLACEHOLDER [AJUSTAR] (Marco troca na tela). custo≠receita, moedas independentes.
// Idempotente (não duplica). Rodar DEPOIS do db push: npx tsx prisma/seed-precos-tabela-valores.ts
import { prisma } from '@/lib/prisma'
import { NaturezaPreco, Moeda } from '@prisma/client'

// Cada item do Catálogo Mestre ganha 1 preço de CUSTO e 1 de RECEITA (global, [AJUSTAR]).
const ITENS = ['CERT_NASCIMENTO_IT', 'CERT_CASAMENTO_IT', 'CERT_OBITO_IT']

async function upsertPreco(itemCatalogoId: number, natureza: NaturezaPreco, moeda: Moeda) {
  const name = `[AJUSTAR] ${natureza === 'CUSTO' ? 'Custo' : 'Receita'} padrão global`
  // idempotência: 1 linha global por item+natureza
  const existe = await prisma.tabelaValor.findFirst({
    where: { itemCatalogoId, natureza, processoTipoId: null, regiao: null, fornecedorId: null, arquivado: false },
  })
  if (existe) return existe
  return prisma.tabelaValor.create({
    data: { name, itemCatalogoId, natureza, moeda, valor: 0, modoCalculo: 'fixed' }, // valor 0 = [AJUSTAR]
  })
}

async function main() {
  console.log('💰 Preços [AJUSTAR] na TabelaValor (global) — custo e receita independentes\n')
  for (const code of ITENS) {
    const item = await prisma.itemCatalogo.findUnique({ where: { code } })
    if (!item) { console.log(`⚠ item ${code} não existe (rode o seed do Catálogo Mestre antes)`); continue }
    // custo em BRL, receita em EUR = SÓ EXEMPLO de moedas independentes; Marco ajusta.
    const c = await upsertPreco(item.id, NaturezaPreco.CUSTO, Moeda.BRL)
    const r = await upsertPreco(item.id, NaturezaPreco.RECEITA, Moeda.EUR)
    console.log(`• ${code}: custo #${c.id} (BRL, [AJUSTAR]) · receita #${r.id} (EUR, [AJUSTAR])`)
  }
  console.log('\n✅ Preços placeholder criados (valor 0 = AJUSTAR na tela). custo≠receita, moedas independentes.')
}
main().catch(console.error).finally(() => prisma.$disconnect())
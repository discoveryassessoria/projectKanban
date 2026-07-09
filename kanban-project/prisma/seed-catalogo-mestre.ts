// prisma/seed-catalogo-mestre.ts
// BLOCO 1 — Migração idempotente para o CATÁLOGO MESTRE.
// - Cria/atualiza os itens mestres (documentos canônicos + itens de teste existentes).
// - LIGA (não apaga) cada registro-ilha ao seu item mestre via itemCatalogoId.
// Rodar DEPOIS do `npx prisma db push`:  npx tsx prisma/seed-catalogo-mestre.ts
// Pode rodar várias vezes — é idempotente (upsert por code).

import { prisma } from '@/lib/prisma'
import { NaturezaItem, UnidadeItem } from '@prisma/client'

// --- Itens canônicos mínimos do domínio (identidade única) --------------------
// code estável = chave de idempotência. Marco pode renomear name/categoria depois.
const ITENS_CANONICOS = [
  { code: 'CERT_NASCIMENTO_IT', name: 'Certidão de Nascimento - Inteiro Teor', natureza: NaturezaItem.DOCUMENTO, categoria: 'Registro civil', unidade: UnidadeItem.DOCUMENTO, docCodes: ['IT - NAS', 'IT-NAS'] },
  { code: 'CERT_CASAMENTO_IT',  name: 'Certidão de Casamento - Inteiro Teor',  natureza: NaturezaItem.DOCUMENTO, categoria: 'Registro civil', unidade: UnidadeItem.DOCUMENTO, docCodes: ['IT - CAS', 'IT-CAS'] },
  { code: 'CERT_OBITO_IT',      name: 'Certidão de Óbito - Inteiro Teor',      natureza: NaturezaItem.DOCUMENTO, categoria: 'Registro civil', unidade: UnidadeItem.DOCUMENTO, docCodes: ['IT - OBI', 'IT-OBI'] },
]

async function upsertItem(i: typeof ITENS_CANONICOS[number]) {
  return prisma.itemCatalogo.upsert({
    where: { code: i.code },
    update: { name: i.name, natureza: i.natureza, categoria: i.categoria, unidade: i.unidade, ativo: true },
    create: { code: i.code, name: i.name, natureza: i.natureza, categoria: i.categoria, unidade: i.unidade, ativo: true },
  })
}

async function main() {
  console.log('🗂️  Catálogo Mestre — migração idempotente\n')
  let ligTipos = 0, ligProdutos = 0, ligServicos = 0

  for (const i of ITENS_CANONICOS) {
    const item = await upsertItem(i)
    console.log(`• item #${item.id} ${item.code} — ${item.name}`)

    // LIGA TipoDocumentoCadastro (por code, tolerando com/sem espaços)
    const r1 = await prisma.tipoDocumentoCadastro.updateMany({
      where: { code: { in: i.docCodes }, itemCatalogoId: null },
      data: { itemCatalogoId: item.id },
    })
    ligTipos += r1.count
  }

  // LIGA os itens financeiros de TESTE do nascimento (CIT_CUSTO / CIT_RECEITA)
  // ao item CERT_NASCIMENTO_IT — custo e receita são PREÇOS do mesmo item (Bloco 3).
  const nasc = await prisma.itemCatalogo.findUnique({ where: { code: 'CERT_NASCIMENTO_IT' } })
  if (nasc) {
    const r2 = await prisma.produtoFinanceiro.updateMany({
      where: { codigo: { in: ['CIT_CUSTO', 'CIT_RECEITA', 'CIT'] }, itemCatalogoId: null },
      data: { itemCatalogoId: nasc.id },
    })
    ligProdutos += r2.count
  }

  // Relatório: o que ainda ficou SEM item mestre (pro Marco cadastrar depois)
  const tiposSoltos    = await prisma.tipoDocumentoCadastro.count({ where: { itemCatalogoId: null } })
  const produtosSoltos = await prisma.produtoFinanceiro.count({ where: { itemCatalogoId: null } })
  const servicosSoltos = await prisma.servicoProduto.count({ where: { itemCatalogoId: null } })

  console.log('\n─── ligações feitas ───')
  console.log(`  TipoDocumentoCadastro ligados: ${ligTipos}`)
  console.log(`  ProdutoFinanceiro ligados:     ${ligProdutos}`)
  console.log(`  ServicoProduto ligados:        ${ligServicos}`)
  console.log('\n─── ainda SEM item mestre (revisar no Gerenciamento) ───')
  console.log(`  Tipos de documento soltos: ${tiposSoltos}`)
  console.log(`  Produtos financeiros soltos: ${produtosSoltos}`)
  console.log(`  Serviços soltos: ${servicosSoltos}`)
  console.log('\n✅ Nada foi apagado. As tabelas antigas seguem funcionando; agora apontam pro Catálogo Mestre.')
}

main().catch((e) => console.error(e)).finally(() => prisma.$disconnect())
// scripts/catalogo-certidoes-vinculo.ts
// ============================================================================
// DIAGNÓSTICO — as certidões do Catálogo são REFERÊNCIA ao Documento Mestre?
//
// Regra de arquitetura: a fonte oficial da certidão é
//   Gerenciamento › Documentos e Protocolos › Documentos (TipoDocumentoCadastro).
// O que aparece no Catálogo de Serviços é apenas o item mestre (ItemCatalogo)
// referenciado por essa fonte, para efeito comercial/financeiro. Um ItemCatalogo
// de natureza DOCUMENTO SEM nenhum TipoDocumentoCadastro apontando para ele é um
// cadastro documental solto — o que a arquitetura não admite.
//
// PADRÃO: só LÊ e RELATA. Nada é criado, alterado ou apagado.
//   npx tsx scripts/catalogo-certidoes-vinculo.ts
//
// Com `--aplicar`, consolida APENAS o caso seguro e retrocompatível:
// vincular um TipoDocumentoCadastro que hoje está SEM item mestre
// (`itemCatalogoId IS NULL`) ao item documental órfão de mesmo nome normalizado.
//   npx tsx scripts/catalogo-certidoes-vinculo.ts --aplicar
//
// O que o modo --aplicar NUNCA faz:
//   • apagar item, documento, preço ou configuração financeira;
//   • sobrescrever um `itemCatalogoId` já preenchido;
//   • mexer em preço, configuração financeira ou qualquer vínculo existente.
// Ou seja: só PREENCHE vínculo ausente. Todo o resto é relatado para decisão
// humana — consolidar itens que já têm vínculos financeiros distintos é decisão
// de arquitetura, não de script.
// ============================================================================
import { prisma } from '@/lib/prisma'

const APLICAR = process.argv.includes('--aplicar')

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

async function main() {
  console.log(`\nCertidões no Catálogo × Documento Mestre — modo ${APLICAR ? 'APLICAR' : 'somente leitura'}\n`)

  // Todos os itens mestre de natureza DOCUMENTO, com quem aponta para eles.
  const itens = await prisma.itemCatalogo.findMany({
    where: { natureza: 'DOCUMENTO' },
    select: {
      id: true, code: true, name: true, ativo: true,
      _count: { select: { tiposDocumento: true, produtos: true, precos: true } },
      tiposDocumento: { select: { id: true, name: true, ativo: true } },
    },
    orderBy: { name: 'asc' },
  })

  console.log(`Itens de natureza DOCUMENTO no cadastro mestre: ${itens.length}\n`)

  const vinculados = itens.filter((i) => i._count.tiposDocumento > 0)
  const orfaos = itens.filter((i) => i._count.tiposDocumento === 0)

  console.log(`✔ COM vínculo ao Documento Mestre: ${vinculados.length}`)
  for (const i of vinculados) {
    const docs = i.tiposDocumento.map((d) => `${d.name}${d.ativo ? '' : ' (inativo)'}`).join(' · ')
    console.log(`   #${i.id} ${i.name} — ${i.code}`)
    console.log(`        documento oficial: ${docs}`)
    console.log(`        config financeira: ${i._count.produtos} · preços: ${i._count.precos}`)
  }

  console.log(`\n✖ SEM vínculo ao Documento Mestre: ${orfaos.length}`)
  if (orfaos.length === 0) {
    console.log('   (nenhum — todas as certidões do catálogo são referência a um documento oficial)')
  }

  // Documentos oficiais que ainda não apontam para item mestre: são o destino
  // natural de um item órfão de mesmo nome.
  const docsSemItem = await prisma.tipoDocumentoCadastro.findMany({
    where: { itemCatalogoId: null },
    select: { id: true, name: true, ativo: true },
    orderBy: { name: 'asc' },
  })

  const propostas: { itemId: number; itemNome: string; docId: number; docNome: string }[] = []
  for (const i of orfaos) {
    const alvo = docsSemItem.find((d) => norm(d.name) === norm(i.name))
    console.log(`   #${i.id} ${i.name} — ${i.code}`)
    console.log(`        config financeira: ${i._count.produtos} · preços: ${i._count.precos}`)
    if (alvo) {
      console.log(`        → documento oficial SEM item mestre e de mesmo nome: #${alvo.id} ${alvo.name}`)
      propostas.push({ itemId: i.id, itemNome: i.name, docId: alvo.id, docNome: alvo.name })
    } else {
      console.log('        → nenhum documento oficial de mesmo nome sem vínculo.')
      console.log('          DECISÃO HUMANA: cadastrar o documento em Documentos e Protocolos e vincular,')
      console.log('          ou manter o item apenas como referência financeira (sem cadastro documental).')
    }
  }

  console.log(`\n${'─'.repeat(64)}`)
  console.log(`Consolidações seguras possíveis (preencher vínculo AUSENTE): ${propostas.length}`)
  for (const p of propostas) {
    console.log(`   documento #${p.docId} "${p.docNome}"  →  item mestre #${p.itemId} "${p.itemNome}"`)
  }

  if (!APLICAR) {
    console.log('\nNada foi alterado. Para aplicar só as consolidações acima:')
    console.log('   npx tsx scripts/catalogo-certidoes-vinculo.ts --aplicar')
    await prisma.$disconnect()
    return
  }

  if (propostas.length === 0) {
    console.log('\nNada a aplicar.')
    await prisma.$disconnect()
    return
  }

  console.log('\nAplicando (idempotente; só preenche vínculo nulo)…')
  for (const p of propostas) {
    // Condição no WHERE: se outra sessão já preencheu, o update não acha o
    // registro e nada é sobrescrito.
    const r = await prisma.tipoDocumentoCadastro.updateMany({
      where: { id: p.docId, itemCatalogoId: null },
      data: { itemCatalogoId: p.itemId },
    })
    console.log(`   documento #${p.docId} → item #${p.itemId}: ${r.count === 1 ? 'vinculado' : 'já estava vinculado (nada a fazer)'}`)
  }

  console.log('\n✅ Consolidação concluída. Nenhum dado apagado; preço e configuração financeira intocados.')
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('ERRO:', e)
  await prisma.$disconnect()
  process.exit(1)
})

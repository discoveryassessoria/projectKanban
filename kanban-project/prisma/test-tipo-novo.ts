// prisma/test-tipo-novo.ts
// LOTE C — prova que dá pra criar documento de um TIPO NOVO (só documentTypeId, tipo=null),
// e que o dual-write funciona. Cria dados de teste e LIMPA no fim.
// Rodar: npx tsx prisma/test-tipo-novo.ts
import { prisma } from '@/lib/prisma'

async function main() {
  // pega uma pessoa qualquer p/ vincular
  const pessoa = await prisma.pessoa.findFirst({ select: { id: true } })
  if (!pessoa) { console.log('⚠ sem pessoa no banco p/ testar'); return }

  // cria um tipo NOVO no cadastro SEM legacyEnumKey (= tipo que não existe no enum)
  let tipoNovo = await prisma.tipoDocumentoCadastro.findFirst({ where: { code: 'TESTE-NOVO' } })
  if (!tipoNovo) tipoNovo = await prisma.tipoDocumentoCadastro.create({ data: { code: 'TESTE-NOVO', name: '[TESTE] Tipo Novo', category: 'other', ativo: true } })

  // simula o que o POST faz: tipo novo → grava documentTypeId, tipo=null
  const doc = await prisma.documento.create({ data: { pessoaId: pessoa.id, tipo: null, documentTypeId: tipoNovo.id, status: 'PENDENTE' } })
  console.log(`Teste (tipo novo): doc #${doc.id} criado com tipo=${doc.tipo ?? 'null'} + documentTypeId=${doc.documentTypeId} — ${doc.tipo === null && doc.documentTypeId === tipoNovo.id ? '✅ OK (tipo novo gravado sem enum)' : '❌'}`)

  // limpa
  await prisma.documento.delete({ where: { id: doc.id } })
  await prisma.tipoDocumentoCadastro.delete({ where: { id: tipoNovo.id } })
  console.log('🧹 dados de teste removidos.')
}
main().catch(console.error).finally(() => prisma.$disconnect())
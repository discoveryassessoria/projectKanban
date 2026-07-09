// prisma/test-document-type-resolver.ts
// LOTE C · Fase 7 — prova o compat layer nos 3 caminhos. Rodar: npx tsx prisma/test-document-type-resolver.ts
import { prisma } from '@/lib/prisma'
import { resolveDocumentType } from '@/src/lib/document-type-resolver'

async function main() {
  // pega um documento real já migrado (tem documentTypeId + tipo)
  const doc = await prisma.documento.findFirst({ where: { documentTypeId: { not: null } }, select: { documentTypeId: true, tipo: true } })
  if (!doc) { console.log('⚠ nenhum documento com documentTypeId — rode o backfill do Lote C antes'); return }

  // 1) pela NOVA fonte (documentTypeId)
  const a = await resolveDocumentType({ documentTypeId: doc.documentTypeId, tipo: doc.tipo })
  console.log(`Teste 1 (nova fonte): fonte=${a.fonte} · ${a.name} · cat=${a.category} — ${a.fonte === 'documentType' ? '✅' : '❌'}`)

  // 2) só pelo legado (simula doc antigo sem documentTypeId)
  const b = await resolveDocumentType({ documentTypeId: null, tipo: doc.tipo })
  console.log(`Teste 2 (legado):     fonte=${b.fonte} · ${b.name} · legacyKey=${b.legacyEnumKey} — ${b.fonte === 'legacy' && b.name ? '✅' : '❌'}`)

  // 3) nada
  const c = await resolveDocumentType({ documentTypeId: null, tipo: null })
  console.log(`Teste 3 (vazio):      fonte=${c.fonte} — ${c.fonte === 'none' ? '✅' : '❌'}`)

  console.log('\n✅ Compat layer resolve pelos 3 caminhos. Os 9 arquivos podem migrar p/ resolveDocumentType (Fase 8).')
}
main().catch(console.error).finally(() => prisma.$disconnect())
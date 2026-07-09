// prisma/backfill-lote-c-documentos.ts
// LOTE C · FASE 6 — Liga cada Documento existente ao TipoDocumentoCadastro
// correspondente (via legacyEnumKey), preenchendo documentTypeId.
// Idempotente (pula os que já têm documentTypeId). NÃO apaga o legado `tipo`.
// NÃO inventa mapping: o que não casar entra em NEEDS_REVIEW.
// Rodar DEPOIS do seed dos tipos: npx tsx prisma/backfill-lote-c-documentos.ts
import { prisma } from '@/lib/prisma'

async function main() {
  console.log('🔗 LOTE C · Fase 6 — backfill Documento.tipo → documentTypeId\n')

  // mapa legacyEnumKey → id (uma query)
  const tipos = await prisma.tipoDocumentoCadastro.findMany({
    where: { legacyEnumKey: { not: null } },
    select: { id: true, legacyEnumKey: true },
  })
  const mapa = new Map(tipos.map((t) => [t.legacyEnumKey as string, t.id]))

  const docs = await prisma.documento.findMany({ select: { id: true, tipo: true, documentTypeId: true } })

  let migrated = 0, skipped = 0, failed = 0
  const unmapped: Record<string, number> = {}

  for (const d of docs) {
    if (d.documentTypeId != null) { skipped++; continue }          // já ligado
    const alvo = mapa.get(String(d.tipo))
    if (!alvo) { unmapped[String(d.tipo)] = (unmapped[String(d.tipo)] || 0) + 1; continue }  // NEEDS_REVIEW
    try {
      await prisma.documento.update({ where: { id: d.id }, data: { documentTypeId: alvo } })
      migrated++
    } catch { failed++ }
  }

  const totalUnmapped = Object.values(unmapped).reduce((a, b) => a + b, 0)
  console.log('─── RELATÓRIO DE MIGRAÇÃO ───')
  console.log(`  total de documentos:   ${docs.length}`)
  console.log(`  migrated (ligados):    ${migrated}`)
  console.log(`  skipped (já ligados):  ${skipped}`)
  console.log(`  failed:                ${failed}`)
  console.log(`  unmapped (NEEDS_REVIEW):${totalUnmapped}`)
  if (totalUnmapped > 0) {
    console.log('\n  ⚠ tipos SEM correspondência (revisar — NÃO foram tocados):')
    for (const [tipo, n] of Object.entries(unmapped)) console.log(`     ${tipo}: ${n} doc(s)`)
    console.log('  (rode o seed-lote-c-tipos.ts se algum valor do enum ficou sem cadastro)')
  }
  // verificação final: órfãos silenciosos?
  const orfaos = await prisma.documento.count({ where: { documentTypeId: null } })
  console.log(`\n  documentos ainda SEM documentTypeId: ${orfaos} ${orfaos === 0 ? '✅' : '(= unmapped acima)'}`)
  console.log('\n✅ Backfill idempotente concluído. Legado `tipo` intacto (removido só na Fase 17).')
}
main().catch(console.error).finally(() => prisma.$disconnect())
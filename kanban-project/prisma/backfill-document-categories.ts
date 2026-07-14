// LOTE A — RUNNER CLI do backfill: TipoDocumentoCadastro.category (legado) -> categoriaDocumentalId (FK).
//
// SEGURO: dry-run por padrão; escrita real exige DUPLA TRAVA (--execute + BACKFILL_EXECUTE=1).
// A LÓGICA é do núcleo puro (backfill-document-categories.core), que usa a ponte
// compartilhada (src/lib/document-category-map). Este arquivo só faz I/O (Prisma).
// main() roda SOMENTE quando executado como script (guardado abaixo) — importar
// este arquivo não abre conexão nem executa nada.
//
//   npm run backfill:document-categories:dry     # dry-run (relatório, sem escrita)
//   BACKFILL_EXECUTE=1 npm run backfill:document-categories   # execução real
//
// Não rodar contra produção sem autorização.

import { PrismaClient } from '@prisma/client'
import { planejarBackfill } from './backfill-document-categories.core'

async function main() {
  const prisma = new PrismaClient()
  try {
    const execute = process.argv.includes('--execute') && process.env.BACKFILL_EXECUTE === '1'
    console.log(`[backfill:document-categories] ${execute ? 'EXECUÇÃO REAL' : 'DRY-RUN'}`)

    const categorias = await prisma.categoriaDocumental.findMany({ select: { id: true, code: true } })
    if (categorias.length === 0) {
      console.error('ABORTAR: nenhuma CategoriaDocumental encontrada — aplique a migration (com seed) antes.')
      process.exit(1)
    }
    const tipos = await prisma.tipoDocumentoCadastro.findMany({
      select: { id: true, name: true, category: true, categoriaDocumentalId: true },
    })

    const { updates, relatorio, abortar } = planejarBackfill(tipos, categorias)
    console.log('── relatório ──────────────────────────────')
    console.log(`total analisado:            ${relatorio.total}`)
    console.log(`já vinculados (skip):       ${relatorio.jaVinculados}`)
    console.log(`a vincular:                 ${relatorio.aVincular}`)
    console.log(`sem categoria (category=∅): ${relatorio.semCategoria}`)
    console.log(`valores desconhecidos:      ${relatorio.totalDesconhecidos} ${JSON.stringify(relatorio.desconhecidos)}`)
    console.log(`conflitos (code sem seed):  ${relatorio.conflitos.length}`)
    console.log('───────────────────────────────────────────')

    if (abortar) {
      console.error('ABORTAR: há categoria(s) impossível(is) de mapear. Nada foi escrito.')
      console.error('Ajuste a ponte (document-category-map) e/ou o seed da migration e reexecute.')
      process.exit(1)
    }
    if (!execute) {
      console.log('DRY-RUN concluído: nada foi escrito. Para aplicar: BACKFILL_EXECUTE=1 + --execute.')
      return
    }

    let ok = 0
    for (const u of updates) {
      await prisma.tipoDocumentoCadastro.update({
        where: { id: u.id },
        data: { categoriaDocumentalId: u.categoriaDocumentalId }, // SOMENTE a FK
      })
      ok++
    }
    console.log(`OK: ${ok} tipo(s) vinculado(s). Coluna legada 'category' intacta.`)
  } finally {
    await prisma.$disconnect()
  }
}

// Guard: só executa quando rodado diretamente (tsx prisma/backfill-...ts), nunca no import.
const invocadoDireto = process.argv[1] ? /backfill-document-categories\.ts$/.test(process.argv[1]) : false
if (invocadoDireto) {
  main().catch((e) => { console.error(e); process.exit(1) })
}

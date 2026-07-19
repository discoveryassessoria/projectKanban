// prisma/backfill-codigos-publicos.ts
// Preenche o CÓDIGO PÚBLICO dos registros ANTIGOS via CodeGeneratorService, preservando
// UUIDs/ids, relações e referências. Idempotente (só toca em quem está sem código) e
// não destrutivo. Ordena por id (ordem de criação) → o mais antigo do país recebe -1.
//
//   Dry-run:  npx tsx prisma/backfill-codigos-publicos.ts
//   Aplicar:  npx tsx prisma/backfill-codigos-publicos.ts --execute

import { PrismaClient } from '@prisma/client'
import { gerarCodigoPublico } from '../lib/codigos/code-generator'

const prisma = new PrismaClient()
const EXECUTE = process.argv.includes('--execute')

async function main() {
  const semCodigo = await prisma.processo.findMany({
    where: { codigo: null },
    select: { id: true, pais: true },
    orderBy: { id: 'asc' },
  })
  console.log(`Processos sem código: ${semCodigo.length}`)

  let n = 0
  for (const p of semCodigo) {
    if (!EXECUTE) { console.log(`  [dry] #${p.id} (${p.pais})`); continue }
    // gera dentro de uma transação curta (código + update atômicos por registro)
    await prisma.$transaction(async (tx) => {
      const codigo = await gerarCodigoPublico(tx, 'PROCESS', { pais: p.pais })
      await tx.processo.update({ where: { id: p.id }, data: { codigo } })
      console.log(`  #${p.id} (${p.pais}) → ${codigo}`)
    })
    n++
  }
  console.log(`\n${EXECUTE ? `APLICADO — códigos atribuídos: ${n}` : 'DRY-RUN — rode com --execute'}`)
}

main().catch((e) => { console.error('ERRO:', e); process.exit(1) }).finally(() => prisma.$disconnect())

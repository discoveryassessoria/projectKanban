// ============================================================
// LIMPEZA — Fase 3B: apaga TODOS os workflows internos das fases
// (e seus passos) para reparar os dados duplicados. Rodar ANTES
// de recriar o índice único e re-semear.
//   npx tsx prisma/reset-workflows-fase.ts
// ⚠ Só remova assim neste momento (ainda não há workflows
//   específicos de processo criados à mão — só os padrão do seed).
// ============================================================
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const passos = await prisma.phaseInternalWorkflowStep.deleteMany({})
  const wfs = await prisma.phaseInternalWorkflow.deleteMany({})
  console.log(`🧹 Limpeza 3B: ${wfs.count} workflows e ${passos.count} passos removidos.`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
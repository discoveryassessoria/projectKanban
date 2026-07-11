// prisma/backfill-cp1-familias.ts
// CP-1 — backfill de Família (Regras 10/11/12). IDEMPOTENTE e não-destrutivo.
//
// Regra aprovada: 1 Família por Árvore (singleton por processo sem árvore).
//   1) toda Árvore sem familiaId ganha uma Família e é vinculada;
//   2) todo Processo sem familiaId recebe a família da sua árvore, ou uma
//      família singleton se não tiver árvore.
// Escreve SOMENTE nos campos novos (sem dual-write). Não remove nada.
//
// Rodar: npm run backfill:cp1:familias   (exige env de banco)

import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  console.log("🌱 CP-1 backfill — Famílias")

  let familiasCriadas = 0
  let arvoresVinculadas = 0
  let processosVinculados = 0

  // 1) Árvores sem família
  const arvores = await prisma.arvore.findMany({
    where: { familiaId: null },
    select: { id: true, nome: true },
  })
  for (const a of arvores) {
    await prisma.$transaction(async (tx) => {
      const atual = await tx.arvore.findUnique({
        where: { id: a.id },
        select: { familiaId: true },
      })
      if (atual?.familiaId) return
      const familia = await tx.familia.create({
        data: { nome: a.nome?.trim() || `Família (árvore ${a.id})` },
      })
      await tx.arvore.update({ where: { id: a.id }, data: { familiaId: familia.id } })
      familiasCriadas++
      arvoresVinculadas++
    })
  }

  // 2) Processos sem família
  const processos = await prisma.processo.findMany({
    where: { familiaId: null },
    select: { id: true, nome: true, arvoreId: true, arvore: { select: { familiaId: true } } },
  })
  for (const p of processos) {
    let familiaId = p.arvore?.familiaId ?? null
    if (!familiaId) {
      // Processo sem árvore (ou árvore sem família) → singleton.
      const familia = await prisma.familia.create({
        data: { nome: p.nome?.trim() || `Família (processo ${p.id})` },
      })
      familiaId = familia.id
      familiasCriadas++
    }
    await prisma.processo.update({ where: { id: p.id }, data: { familiaId } })
    processosVinculados++
  }

  // Reconciliação
  const unresolvedCount = await prisma.processo.count({ where: { familiaId: null } })

  console.log(`   Famílias criadas:      ${familiasCriadas}`)
  console.log(`   Árvores vinculadas:    ${arvoresVinculadas}`)
  console.log(`   Processos vinculados:  ${processosVinculados}`)
  console.log(`   unresolvedCount:       ${unresolvedCount}`)
  if (unresolvedCount !== 0) {
    throw new Error(`Backfill incompleto: ${unresolvedCount} processos ainda sem família.`)
  }
  console.log("✅ Backfill de Famílias concluído (unresolvedCount = 0).")
}

main()
  .catch((e) => {
    console.error("❌ Erro no backfill de Famílias:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

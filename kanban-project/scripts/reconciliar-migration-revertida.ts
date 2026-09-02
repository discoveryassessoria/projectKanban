// scripts/reconciliar-migration-revertida.ts
//
// LINHA DE TENTATIVA FRACASSADA NO LEDGER DE MIGRATIONS.
//
// `_prisma_migrations` guarda UMA LINHA POR TENTATIVA. Quando uma migration
// falha e é reexecutada, ficam duas: a primeira com `rolled_back_at` e zero
// passos aplicados, a segunda com `finished_at` e o passo aplicado de verdade.
//
// A verificação DB-002 conta linhas com `rolled_back_at` — e por isso acusava
// CRÍTICO por uma tentativa que já tinha sido superada no minuto seguinte, com
// a migration aplicada e as tabelas no banco. Alarme que não corresponde a
// defeito é pior que alarme nenhum: ele ensina a ignorar o painel.
//
// Este script remove a linha da TENTATIVA FRACASSADA — e só ela: exige que
// exista, para a MESMA migration, uma linha concluída e com passo aplicado.
// Sem isso, não toca em nada.
//
//   Ver:      npx tsx scripts/reconciliar-migration-revertida.ts
//   Aplicar:  EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/reconciliar-migration-revertida.ts --aplicar

import { prisma } from "@/lib/prisma"

const APLICAR = process.argv.includes("--aplicar")

async function r<T>(f: () => Promise<T>, n = 20): Promise<T> {
  for (let i = 0; i < n; i++) {
    try { return await f() } catch (e) {
      if (i === n - 1) throw e
      await new Promise((x) => setTimeout(x, Math.min(15000, 1500 * (i + 1))))
    }
  }
  throw new Error("sem conexão")
}

async function main() {
  const revertidas = await r(() => prisma.$queryRawUnsafe<any[]>(`
    SELECT id, migration_name, started_at, applied_steps_count
    FROM _prisma_migrations WHERE rolled_back_at IS NOT NULL ORDER BY started_at`))

  console.log(`LEDGER DE MIGRATIONS — ${revertidas.length} linha(s) revertida(s)\n`)
  if (!revertidas.length) { console.log("✅ Nada a reconciliar."); return }

  const removiveis: any[] = []
  for (const rev of revertidas) {
    const boas = await r(() => prisma.$queryRawUnsafe<any[]>(`
      SELECT id, finished_at, applied_steps_count FROM _prisma_migrations
      WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL
        AND applied_steps_count > 0`, rev.migration_name))
    const ok = boas.length > 0
    console.log(`  ${ok ? "→ removível" : "⚠ MANTER  "} ${rev.migration_name}`)
    console.log(`      tentativa revertida: ${rev.started_at?.toISOString?.() ?? rev.started_at} · ${rev.applied_steps_count} passo(s)`)
    console.log(`      ${ok
      ? `tentativa boa: concluída em ${boas[0].finished_at?.toISOString?.() ?? boas[0].finished_at} com ${boas[0].applied_steps_count} passo(s)`
      : "NÃO existe tentativa concluída — a migration realmente não foi aplicada, e isso é problema de verdade"}`)
    if (ok) removiveis.push(rev)
  }

  if (!removiveis.length) {
    console.log("\n⚠ Nenhuma linha é removível: as reversões não têm tentativa bem-sucedida correspondente.")
    process.exit(1)
  }

  if (!APLICAR) {
    console.log(`\nDRY-RUN: nada foi escrito. ${removiveis.length} linha(s) de tentativa fracassada seriam removidas.`)
    return
  }
  if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "1") {
    console.error("\n❌ Escrita não confirmada. Defina EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1.")
    process.exit(1)
  }

  for (const rev of removiveis) {
    await r(() => prisma.$executeRawUnsafe(`DELETE FROM _prisma_migrations WHERE id = $1`, rev.id))
    console.log(`  ✅ removida a tentativa fracassada de ${rev.migration_name}`)
  }
  const restam = await r(() => prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*)::int n FROM _prisma_migrations WHERE rolled_back_at IS NOT NULL OR finished_at IS NULL`))
  console.log(`\n   Linhas anômalas restantes: ${restam[0].n}`)
}

main().finally(() => prisma.$disconnect())

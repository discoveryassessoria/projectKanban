// scripts/reconciliar-ledger-baseline.ts
// ============================================================================
// RECONCILIAÇÃO DO LEDGER DE MIGRATIONS — checksum de `0000_baseline`.
//
// ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
// `prisma/baseline/baseline.sql` é o retrato do schema para restore de desastre.
// Toda mudança de schema o regenera, e o conteúdo novo tem checksum novo.
//
// Produção, porém, registra `0000_baseline` pelo checksum ANTIGO em
// `_prisma_migrations`. Com o arquivo diferente, `prisma migrate deploy` acusa
// "migration modificada depois de aplicada" e PARA — no meio do deploy.
//
// A reconciliação é um procedimento, não um ajuste de constante: entender por
// que mudou, guardar o valor anterior, trocar de forma auditada, e só então
// atualizar `CHECKSUM_LEDGER` no teste, no mesmo commit.
//
// ─── O QUE ESTE SCRIPT NÃO FAZ ──────────────────────────────────────────────
// Não toca em schema, não toca em dado, não aplica migration. Ele atualiza UMA
// coluna de UMA linha do ledger, imprime o antes e o depois, e registra o ato
// no LogAuditoria. Recusa-se a rodar sem confirmação explícita.
//
//   Dry-run:  npx tsx scripts/reconciliar-ledger-baseline.ts
//   Aplicar:  EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/reconciliar-ledger-baseline.ts --execute
// ============================================================================
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { prisma } from "@/lib/prisma"
import { exigirConfirmacaoDeEscritaEmProducao } from "./_banco-de-teste"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const EXECUTAR = process.argv.includes("--execute")

async function main() {
  // O checksum é do arquivo que o Prisma realmente lê no deploy.
  const arquivo = join(RAIZ, "prisma/migrations/0000_baseline/migration.sql")
  const conteudo = readFileSync(arquivo)
  const novo = createHash("sha256").update(conteudo).digest("hex")

  const [linha] = await prisma.$queryRaw<Array<{ checksum: string; finished_at: Date | null }>>`
    SELECT checksum, finished_at FROM _prisma_migrations WHERE migration_name = '0000_baseline'
  `
  if (!linha) {
    console.error("\n⛔ Não há linha `0000_baseline` no ledger deste banco. Nada a reconciliar.\n")
    process.exit(1)
  }

  console.log(`\nRECONCILIAÇÃO DO LEDGER — 0000_baseline`)
  console.log(`  no ledger hoje : ${linha.checksum}`)
  console.log(`  arquivo atual  : ${novo}`)
  console.log(`  aplicado em    : ${linha.finished_at?.toISOString() ?? "—"}`)

  if (linha.checksum === novo) {
    console.log(`\n✅ Já estão iguais. Nada a fazer.\n`)
    return
  }
  if (!EXECUTAR) {
    console.log(`\nDRY-RUN: nada foi escrito.`)
    console.log(`Para aplicar:`)
    console.log(`  EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/reconciliar-ledger-baseline.ts --execute\n`)
    return
  }

  exigirConfirmacaoDeEscritaEmProducao(
    `reconcilia o checksum de 0000_baseline no ledger de migrations (${linha.checksum.slice(0, 12)}… → ${novo.slice(0, 12)}…)`,
    "reconciliar-ledger-baseline",
  )

  // BACKUP antes da escrita: o valor anterior fica no LogAuditoria, que é onde
  // alguém vai procurar se precisar voltar.
  await prisma.logAuditoria.create({
    data: {
      acao: "LEDGER_BASELINE_RECONCILIADO",
      entidade: "_prisma_migrations",
      entidadeId: 0,
      descricao: `Checksum de 0000_baseline reconciliado após regeneração do baseline (schema novo).`,
      detalhes: { anterior: linha.checksum, novo, arquivo: "prisma/migrations/0000_baseline/migration.sql" },
    },
  })

  const n = await prisma.$executeRaw`
    UPDATE _prisma_migrations SET checksum = ${novo} WHERE migration_name = '0000_baseline'
  `
  console.log(`\n✅ ${n} linha atualizada. Anterior preservado no LogAuditoria.`)
  console.log(`   Atualize CHECKSUM_LEDGER em scripts/baseline-verificar.test.ts para:`)
  console.log(`   ${novo}\n`)
}

main().catch((e) => { console.error("falhou:", e); process.exitCode = 1 }).finally(() => prisma.$disconnect())

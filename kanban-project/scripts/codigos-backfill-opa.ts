// scripts/codigos-backfill-opa.ts
// BACKFILL idempotente do código público (OPA-n) da Operação Antecipada. Usa o gerador CENTRAL
// (nunca monta código à mão). Preserva códigos existentes; gera só onde está vazio; processa em
// lotes; pode rodar de novo sem duplicar nem trocar. Execução:
//   PRISMA_DATABASE_URL=... npx tsx scripts/codigos-backfill-opa.ts
import { prisma } from "@/lib/prisma"
import { gerarCodigoPublico } from "@/lib/codigos/code-generator"
import { CLASSE, classificar, retratar } from "../lib/db/identidade-banco.mjs"

const LOTE = 200

async function main() {
  const classe = classificar(await retratar(prisma))
  if (classe === CLASSE.PRODUCAO) {
    console.error('[guard] ABORTADO: este script não pode rodar contra produção. Rode só em ambiente não-produtivo.')
    process.exit(1)
  }

  let feitos = 0, erros = 0
  for (;;) {
    const pendentes = await prisma.operacaoAntecipada.findMany({
      where: { publicCode: null }, orderBy: { id: "asc" }, take: LOTE, select: { id: true },
    })
    if (pendentes.length === 0) break
    for (const op of pendentes) {
      try {
        // Reserva+grava na MESMA transação: sequência atômica + update. Gap aceitável, nunca duplica.
        await prisma.$transaction(async (tx) => {
          const code = await gerarCodigoPublico(tx, "ANTICIPATED_OPERATION")
          // updateMany com guarda publicCode:null → idempotente (0 linhas se já preenchido).
          await tx.operacaoAntecipada.updateMany({ where: { id: op.id, publicCode: null }, data: { publicCode: code } })
        })
        feitos++
      } catch (e) {
        erros++
        console.error(`  ERRO op ${op.id}:`, (e as Error).message)
      }
    }
    console.log(`lote: +${pendentes.length} (total feitos ${feitos}, erros ${erros})`)
  }
  // Validação final: nenhum duplicado.
  const dups = await prisma.$queryRawUnsafe<{ publicCode: string; n: number }[]>(
    `SELECT "publicCode", COUNT(*)::int AS n FROM "OperacaoAntecipada" WHERE "publicCode" IS NOT NULL GROUP BY "publicCode" HAVING COUNT(*) > 1`,
  )
  console.log(`\nRESULTADO: gerados ${feitos}, erros ${erros}, duplicados ${dups.length}`)
  if (dups.length) { console.error("DUPLICADOS:", JSON.stringify(dups)); process.exit(1) }
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })

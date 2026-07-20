// scripts/codigos-backfill-all.ts
// BACKFILL GENÉRICO e idempotente de publicCode p/ TODAS as entidades do CODE_REGISTRY, usando o
// CodeGeneratorService central. Preserva códigos existentes; gera só onde vazio; lotes; re-execução
// não duplica nem troca; registra a sequência ao maior código existente (importação); relata.
//   PRISMA_DATABASE_URL=... npx tsx scripts/codigos-backfill-all.ts
import { prisma } from "@/lib/prisma"
import { gerarCodigoPublico, semearSequencia } from "@/lib/codigos/code-generator"
import { escopoDe } from "@/lib/codigos/code-patterns"
import { CODE_REGISTRY } from "@/lib/codigos/entity-registry"

const LOTE = 300
const camel = (s: string) => s[0].toLowerCase() + s.slice(1)

interface Linha { entidade: string; prefixo: string; migrados: number; preservados: number; erros: number }

async function main() {
  const tabela: Linha[] = []
  for (const [modelName, cfg] of Object.entries(CODE_REGISTRY)) {
    const scope = escopoDe(cfg.entidade)
    const m = (prisma as unknown as Record<string, {
      count: (a: unknown) => Promise<number>; findMany: (a: unknown) => Promise<{ id: number }[]>; updateMany: (a: unknown) => Promise<{ count: number }>
    }>)[camel(modelName)]
    const preservados = await m.count({ where: { [cfg.campo]: { not: null } } })

    // IMPORTAÇÃO: avança a sequência ao maior número já existente com este prefixo (idempotente).
    const maxRow = await prisma.$queryRawUnsafe<{ maxn: number }[]>(
      `SELECT COALESCE(MAX(CAST(split_part("${cfg.campo}", '-', 2) AS INT)), 0) AS maxn FROM "${modelName}" WHERE "${cfg.campo}" ~ '^${scope}-[0-9]+$'`)
    const maxn = maxRow[0]?.maxn ?? 0
    if (maxn > 0) await semearSequencia(prisma, scope, maxn)

    let migrados = 0, erros = 0
    for (;;) {
      const pend = await m.findMany({ where: { [cfg.campo]: null }, orderBy: { id: "asc" }, take: LOTE, select: { id: true } })
      if (pend.length === 0) break
      for (const row of pend) {
        try {
          await prisma.$transaction(async (tx) => {
            const code = await gerarCodigoPublico(tx, cfg.entidade)
            await (tx as unknown as Record<string, { updateMany: (a: unknown) => Promise<unknown> }>)[camel(modelName)]
              .updateMany({ where: { id: row.id, [cfg.campo]: null }, data: { [cfg.campo]: code } })
          })
          migrados++
        } catch (e) { erros++; console.error(`  ERRO ${modelName} ${row.id}:`, (e as Error).message) }
      }
    }
    // validação de duplicidade
    const dups = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM (SELECT "${cfg.campo}" FROM "${modelName}" WHERE "${cfg.campo}" IS NOT NULL GROUP BY "${cfg.campo}" HAVING COUNT(*) > 1) x`)
    const nDup = dups[0]?.n ?? 0
    tabela.push({ entidade: modelName, prefixo: scope, migrados, preservados, erros })
    console.log(`${modelName} (${scope}): +${migrados} gerados, ${preservados} preservados, ${erros} erros, ${nDup} duplicados`)
    if (nDup > 0) { console.error("DUPLICADO em", modelName); process.exit(1) }
  }
  console.log("\n=== TABELA ===")
  console.log("entidade | prefixo | migrados | preservados | erros")
  for (const l of tabela) console.log(`${l.entidade} | ${l.prefixo} | ${l.migrados} | ${l.preservados} | ${l.erros}`)
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })

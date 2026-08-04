/**
 * APLICAR UMA MIGRATION ADITIVA — caminho controlado, com prova antes da escrita.
 *
 * Rodar:
 *   npx tsx scripts/aplicar-migration-aditiva.ts <nome-da-migration>            # plano
 *   npx tsx scripts/aplicar-migration-aditiva.ts <nome-da-migration> --execute  # aplica
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * O banco de produção NÃO tem a tabela `_prisma_migrations`: o ledger não existe.
 * `prisma migrate deploy` nesse estado tentaria aplicar `0000_baseline` inteiro —
 * CREATE TABLE de 170 tabelas que já existem — e morreria no meio. As migrations
 * de 03/08 estão no schema e não estão em ledger nenhum: o caminho realmente
 * usado é a aplicação direta de SQL aditivo e idempotente.
 *
 * TRAVAS (qualquer falha aborta ANTES de escrever):
 *   1. o SQL não pode conter DDL destrutivo;
 *   2. o alvo tem de ter assinatura de produção (contagem de tabelas + sentinelas);
 *   3. sem `--execute`, nada é executado — só o plano é impresso;
 *   4. tudo numa transação: ou a migration inteira entra, ou nada entra.
 */
import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { prisma } from "@/lib/prisma"

const nome = process.argv[2]
const EXECUTAR = process.argv.includes("--execute")

const DESTRUTIVO = /\b(DROP\s+TABLE|DROP\s+COLUMN|DROP\s+DATABASE|DROP\s+SCHEMA|TRUNCATE|DELETE\s+FROM|UPDATE\s+"?\w+"?\s+SET)\b/i
const SENTINELAS = ["Processo", "Documento", "Usuario", "PhaseWorkflowStepInstance"]

/** Divide o arquivo em statements respeitando blocos $$ … $$. */
function statements(sql: string): string[] {
  const semComentarios = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n")
  const out: string[] = []
  let atual = ""
  let dentroDeBloco = false
  for (let i = 0; i < semComentarios.length; i++) {
    const c = semComentarios[i]
    if (c === "$" && semComentarios[i + 1] === "$") {
      dentroDeBloco = !dentroDeBloco
      atual += "$$"
      i++
      continue
    }
    if (c === ";" && !dentroDeBloco) {
      const t = atual.trim()
      if (t) out.push(t)
      atual = ""
      continue
    }
    atual += c
  }
  const resto = atual.trim()
  if (resto) out.push(resto)
  return out
}

async function main() {
  if (!nome) {
    console.error("uso: aplicar-migration-aditiva.ts <nome-da-migration> [--execute]")
    process.exit(1)
  }
  const caminho = join(process.cwd(), "prisma", "migrations", nome, "migration.sql")
  if (!existsSync(caminho)) {
    console.error(`migration não encontrada: ${caminho}`)
    process.exit(1)
  }
  const sql = readFileSync(caminho, "utf8")

  console.log(`APLICAR MIGRATION ADITIVA — ${nome}`)
  console.log(`  modo: ${EXECUTAR ? "EXECUTANDO" : "PLANO (nada é escrito)"}\n`)

  // ── 1. o SQL é aditivo? ───────────────────────────────────────────────────
  const corpo = sql.replace(/^--.*$/gm, "")
  if (DESTRUTIVO.test(corpo)) {
    console.error("ABORTADO: a migration contém DDL destrutivo. Este caminho só aplica SQL ADITIVO.")
    process.exit(1)
  }
  console.log("  ✅ SQL aditivo (sem DROP/TRUNCATE/DELETE/UPDATE)")

  // ── 2. o alvo é produção? ────────────────────────────────────────────────
  const [{ c }] = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
    `SELECT count(*)::bigint AS c FROM information_schema.tables WHERE table_schema='public'`,
  )
  const tabelas = Number(c)
  const presentes = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1::text[])`,
    SENTINELAS,
  )
  const faltando = SENTINELAS.filter((s) => !presentes.some((p) => p.table_name === s))
  console.log(`  alvo: ${tabelas} tabelas · sentinelas ausentes: ${faltando.length ? faltando.join(", ") : "nenhuma"}`)
  if (tabelas < 100 || faltando.length > 0) {
    console.error("ABORTADO: o banco não tem assinatura de produção.")
    process.exit(1)
  }
  console.log("  ✅ assinatura de produção confirmada")

  // ── 3. plano ─────────────────────────────────────────────────────────────
  const cmds = statements(sql)
  console.log(`\n  ${cmds.length} statements:`)
  for (const s of cmds) console.log(`    · ${s.replace(/\s+/g, " ").slice(0, 110)}`)

  if (!EXECUTAR) {
    console.log("\n  (plano — nada foi escrito. Use --execute para aplicar.)")
    return
  }

  // ── 4. aplicação: tudo ou nada ───────────────────────────────────────────
  console.log("\n  aplicando…")
  // Timeout generoso: DDL em banco grande passa dos 5s padrão do Prisma, e um
  // timeout no meio deixaria a transação abortada — não é risco que se corre por
  // economia de configuração.
  await prisma.$transaction(
    async (tx) => {
      for (const s of cmds) await tx.$executeRawUnsafe(s)
    },
    { maxWait: 60_000, timeout: 240_000 },
  )
  console.log(`  ✅ ${cmds.length} statements aplicados numa transação.`)

  const depois = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
    `SELECT count(*)::bigint AS c FROM information_schema.tables WHERE table_schema='public'`,
  )
  console.log(`  tabelas: ${tabelas} → ${Number(depois[0].c)}`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })

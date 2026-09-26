// scripts/prod-migrate-guard-pula-noop.test.ts
// ============================================================================
// TESTE UNITÁRIO PURO (sem banco) — `pularMigrateDeploy`/`migrationsPendentes`
// (lib/db/leitura-migrations.mjs), achado real de 26/09/2026: dois builds de
// produção seguidos travaram em P1002 (timeout no advisory lock do Postgres)
// dentro de `prisma migrate deploy` — MESMO com o schema já 100% migrado (0
// pendentes). Rodar `migrate deploy` quando não há nada a aplicar não muda o
// schema, mas ainda disputa o lock — e uma disputa transitória derrubava o
// build inteiro por uma operação que seria um no-op.
//
// Não roda `prod-migrate-guard.mjs` de ponta a ponta (ele só age contra
// produção de verdade, com VERCEL_ENV=production e confirmação explícita —
// não é seguro nem correto simulá-lo aqui). Prova a DECISÃO pura, e prova por
// leitura de código que o guard real usa exatamente esta função (nunca uma
// condição própria que possa divergir).
// Rodar: npx tsx scripts/prod-migrate-guard-pula-noop.test.ts
// ============================================================================
import { readFileSync } from "node:fs"
import { migrationsPendentes, pularMigrateDeploy } from "../lib/db/leitura-migrations.mjs"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function main() {
  console.log("PROD-MIGRATE-GUARD — PULAR migrate deploy QUANDO NADA PENDENTE\n")

  secao("1) migrationsPendentes — a mesma conta que o guard faz")
  ok(
    "1.1) tudo registrado ⇒ nenhuma pendente",
    migrationsPendentes(["a", "b"], new Set(["a", "b"])).length === 0,
  )
  ok(
    "1.2) uma migration nova no repositório ⇒ 1 pendente",
    JSON.stringify(migrationsPendentes(["a", "b", "c"], new Set(["a", "b"]))) === JSON.stringify(["c"]),
  )
  ok(
    "1.3) repositório vazio ⇒ nenhuma pendente (nunca lança)",
    migrationsPendentes([], new Set()).length === 0,
  )

  secao("2) pularMigrateDeploy — a decisão que evita o P1002 à toa")
  ok("2.1) array vazio (plano leu com sucesso, nada pendente) ⇒ PULA", pularMigrateDeploy([]) === true)
  ok("2.2) 1+ pendente ⇒ NÃO pula (precisa aplicar de verdade)", pularMigrateDeploy(["20260101_x"]) === false)
  ok(
    "2.3) null (o PLANO falhou ao ler o ledger) ⇒ NÃO pula — sem saber, tenta aplicar (comportamento seguro de sempre)",
    pularMigrateDeploy(null) === false,
  )
  ok("2.4) undefined ⇒ NÃO pula (mesmo motivo do null)", pularMigrateDeploy(undefined) === false)

  secao("3) O GUARD REAL usa esta função — nunca uma condição própria que possa divergir")
  const guard = readFileSync("scripts/prod-migrate-guard.mjs", "utf8")
  ok("3.1) importa pularMigrateDeploy de leitura-migrations.mjs", /import\s*\{\s*pularMigrateDeploy\s*\}\s*from\s*['"]\.\.\/lib\/db\/leitura-migrations\.mjs['"]/.test(guard))
  ok("3.2) usa pularMigrateDeploy(pendentes) para decidir, antes do execSync", /if\s*\(\s*pularMigrateDeploy\(pendentes\)\s*\)/.test(guard))
  ok("3.3) não mantém uma condição própria tipo `pendentes.length === 0` fora da função", !/pendentes\.length\s*===\s*0/.test(guard))
  ok("3.4) o execSync de `migrate deploy` continua existindo (só fica condicional, nunca removido)", /execSync\(['"]npx prisma migrate deploy['"]/.test(guard))

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${passou} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) })

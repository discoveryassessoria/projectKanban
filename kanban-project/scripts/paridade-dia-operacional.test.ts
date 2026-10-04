// scripts/paridade-dia-operacional.test.ts — "hoje" e "amanhã" são o dia de São Paulo em toda tela (sem banco).
//   npx tsx scripts/paridade-dia-operacional.test.ts
import { readFileSync } from "node:fs"
import { diaOperacional } from "../lib/operacional/tempo-operacional"
let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n}`) } }
const f = (p: string) => readFileSync(p, "utf8")

console.log("às 22h de São Paulo (01h UTC do dia seguinte) o 'hoje' ainda é o dia de São Paulo")
ok("diaOperacional(2026-10-06T01:00Z) = 2026-10-05", diaOperacional(new Date("2026-10-06T01:00:00Z")) === "2026-10-05")

console.log("ninguém calcula 'hoje' por data UTC")
for (const p of ["lib/operacional/tarefa-projecoes.ts", "src/components/operacao/central-operacional.tsx", "src/components/operacao/visao-global.tsx", "src/lib/home/coleta.ts"]) {
  const src = f(p).split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n")
  ok(`${p}: sem new Date().toISOString().slice(0, 10) / agora.toISOString().slice(0, 10)`, !/(new Date\(\)|agora)\.toISOString\(\)\.slice\(0, 10\)/.test(src))
}
ok("Home: o bloco pessoal não afirma 'tudo em dia' da empresa", !f("src/components/home/home-content.tsx").includes("Tudo em dia — nenhuma operação exige sua atenção"))
console.log(`\n${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)

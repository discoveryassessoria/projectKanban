// scripts/financeiro-abas-v3.test.ts — A Receber, Dashboard, Fluxo e DRE leem do motor V3 (sem banco).
//   npx tsx scripts/financeiro-abas-v3.test.ts
import { readFileSync } from "node:fs"
import { diasAte, emAberto, recebida, doMes, soma, SEM_VENCIMENTO } from "../lib/financeiro/leitura/abas-v3"
let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n}`) } }
const f = (p: string) => readFileSync(p, "utf8")

console.log("regras puras")
const agora = new Date("2026-10-05T12:00:00Z")
ok("sem vencimento não tem dias (nunca vencido, nunca a vencer)", diasAte(null, agora) === null && SEM_VENCIMENTO > 365)
ok("vencimento daqui a 3 dias = 3; ontem = -1 (arredonda p/ cima)", diasAte("2026-10-08T12:00:00Z", agora) === 3 && diasAte("2026-10-04T12:00:00Z", agora) === -1)
ok("em aberto = saldo > 0; recebida = saldo 0 com valor contratado", emAberto({ saldo: 10, saldoBrl: 10 }) && !emAberto({ saldo: 0, saldoBrl: 0 }) && recebida({ saldo: 0, valorContratado: 5 }) && !recebida({ saldo: 0, valorContratado: 0 }))
ok("doMes compara mês e ano", doMes(new Date("2026-10-31T10:00:00"), new Date("2026-10-01T10:00:00")) && !doMes(new Date("2025-10-05T10:00:00"), new Date("2026-10-05T10:00:00")))
ok("soma arredonda em centavos", soma([{ v: 0.1 }, { v: 0.2 }], (x) => x.v) === 0.3)

console.log("as quatro rotas leem o V3 e não o motor antigo")
for (const r of ["receber", "dashboard", "fluxo", "dre"]) {
  const src = f(`src/app/api/financas/${r}/route.ts`).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")
  ok(`/api/financas/${r}: usa carregarBaseV3`, src.includes("carregarBaseV3"))
  ok(`/api/financas/${r}: não consulta ParcelaFinanceira/ContaPagar/PagamentoFatura/custo legado`, !/parcelaFinanceira|contaPagar|pagamentoFatura/.test(src))
}
console.log(`\n${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)

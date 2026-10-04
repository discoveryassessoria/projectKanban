// scripts/paridade-processos-contagens.test.ts — "processo ativo" e "tarefas do processo" têm UMA definição em toda tela (sem banco).
//   npx tsx scripts/paridade-processos-contagens.test.ts
import { readFileSync } from "node:fs"
let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n}`) } }
const f = (p: string) => readFileSync(p, "utf8")

console.log("processo ativo = ONDE_PROCESSO_ATIVO_E_NA_TORRE")
for (const p of ["src/app/api/financas/receber/route.ts", "src/app/api/financas/dashboard/route.ts", "src/app/api/home/processos/route.ts"])
  ok(`${p} usa a definição única`, f(p).includes("ONDE_PROCESSO_ATIVO_E_NA_TORRE") && !/processo\.count\(\{ where: \{ dataConclusao: null \} \}\)/.test(f(p)))
ok("Torre reexporta a mesma constante", f("lib/operacional/torre-processos.ts").includes("= ONDE_PROCESSO_ATIVO_E_NA_TORRE"))

console.log("Saúde PROC-006: total real, mesmo recorte da Torre")
const s = f("lib/saude/verificacoes/prontidao.ts")
ok("conta o total antes de cortar a amostra", s.includes("totalSemProximaAcao") && s.includes("slice(0, 100)") && !/WHERE p\."dataConclusao" IS NULL[\s\S]{0,400}LIMIT 100/.test(s))
ok("exclui processos fora da Torre e tarefa cancelada", s.includes("idsDeProcessosForaDaTorre") && s.includes("'CANCELADA','SUPERSEDIDA'"))

console.log("Lista de processos: tarefas vivas")
const l = f("src/components/processos-lista.tsx")
ok("total e concluídas da mesma lista, sem canceladas", l.includes("tarefasVivas") && !l.includes("processo._count?.tarefas"))

console.log("país vem da identidade canônica")
ok("Eventos e página do processo leem paisCanonico", f("src/app/events/page.tsx").includes("paisCanonico?.countryKey") && f("src/app/processos/[id]/page.tsx").includes("paisCanonico?.countryLabel"))

console.log(`\n${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)

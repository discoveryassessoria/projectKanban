// scripts/cron-rastro.test.ts
//
// OS SEIS CRONS COM RASTRO (09/10/2026): cada job grava a hora em que terminou bem; CRON-006 cobra a idade contra o ritmo do agendamento.
// Puro + estático: sem banco.
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { CRONS_COM_RASTRO, RASTRO_DE_CRON_DESDE, situacaoDoRastro, chaveDoRastro } from "../lib/operacional/cron-rastro"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const ler = (f: string) => readFileSync(join(RAIZ, f), "utf8")
let n = 0, falhou = 0
const ok = (nome: string, c: boolean, d = "") => { n++; if (c) console.log(`  ✅ ${nome}`); else { falhou++; console.log(`  ❌ ${nome}${d ? ` — ${d}` : ""}`) } }
const h = (x: number) => x * 3_600_000

console.log("\n1) A idade do rastro")
const t0 = RASTRO_DE_CRON_DESDE.getTime()
ok("nunca rodou, mas o rastro acabou de nascer: não acusa", !situacaoDoRastro({ ultimo: null, agora: new Date(t0 + h(1)), maxHoras: 3 }).atrasado)
ok("nunca rodou e passou do ritmo desde que o rastro existe: acusa", situacaoDoRastro({ ultimo: null, agora: new Date(t0 + h(4)), maxHoras: 3 }).atrasado)
ok("rodou há 2 h (horário, folga 3 h): não acusa", !situacaoDoRastro({ ultimo: new Date(t0 + h(10)), agora: new Date(t0 + h(12)), maxHoras: 3 }).atrasado)
ok("rodou há 5 h (horário): acusa", situacaoDoRastro({ ultimo: new Date(t0 + h(10)), agora: new Date(t0 + h(15)), maxHoras: 3 }).atrasado)
ok("o semanal tolera 9 dias", !situacaoDoRastro({ ultimo: new Date(t0 + h(10)), agora: new Date(t0 + h(10 + 24 * 8)), maxHoras: 24 * 9 }).atrasado)

console.log("\n2) Os seis jobs do vercel.json, cada um com rastro")
const vercel = JSON.parse(ler("vercel.json")) as { crons: { path: string; schedule: string }[] }
for (const c of CRONS_COM_RASTRO) {
  const agenda = vercel.crons.find((x) => x.path === `/api/cron/${c.chave}`)
  ok(`${c.chave}: está agendado`, !!agenda)
  const rota = ler(`src/app/api/cron/${c.chave}/route.ts`)
  ok(`${c.chave}: grava o rastro ao terminar bem`, new RegExp(`registrarExecucaoDeCron\\(['"]${c.chave}['"]\\)`).test(rota))
  const horario = agenda?.schedule.startsWith("0 * ") || agenda?.schedule.startsWith("*/")
  const semanal = /\s[0-7]$/.test(agenda?.schedule ?? "") && !/\*$/.test(agenda?.schedule ?? "")
  ok(`${c.chave}: o ritmo cobrado (${c.maxHoras} h) cabe no agendamento (${agenda?.schedule})`, horario ? c.maxHoras === 3 : semanal ? c.maxHoras === 24 * 9 : c.maxHoras === 36)
}
ok("ensaio não grava rastro (avisos e resumo)", /if \(!ensaio\) await registrarExecucaoDeCron/.test(ler("src/app/api/cron/avisos-prazo/route.ts")) && /if \(!ensaio\) await registrarExecucaoDeCron/.test(ler("src/app/api/cron/resumo-diario/route.ts")))

console.log("\n3) A verificação")
const ver = ler("lib/saude/verificacoes/agendados.ts")
ok("CRON-006 existe e cita cada job (a cobertura COB-001 reconhece)", /codigo: 'CRON-006'/.test(ver) && CRONS_COM_RASTRO.every((c) => ver.includes(`/api/cron/${c.chave}`)))
ok("a chave do rastro é por job", chaveDoRastro("coleta-purga") === "cron.coleta-purga.ultimo")

console.log(`\n${n - falhou}/${n} verificações`)
if (falhou) process.exit(1)

// scripts/prazo-nunca-antes-da-entrada.test.ts
// Item 4 (07/10/2026): o prazo de uma tarefa nunca é anterior à entrada do processo na fase. Caso real: Salvarani (IT-1), tarefa criada em 29/09 (operação
// antecipada, SLA 1 dia → 30/09) e processo que só entrou em Emissão em 06/10. PURO + fiação no código.
import { readFileSync } from "node:fs"
import { prazoNaoAnteriorAEntrada } from "../lib/operacional/tempo-operacional"

let n = 0, falhou = 0
const ok = (nome: string, c: boolean, d = "") => { n++; if (c) console.log(`  ✅ ${nome}`); else { falhou++; console.log(`  ❌ ${nome}${d ? ` — ${d}` : ""}`) } }
const ler = (f: string) => readFileSync(f, "utf8")
const d = (s: string) => new Date(s)
const dia = (x: Date | null) => x?.toISOString().slice(0, 10) ?? null

console.log("\n1) A regra (pura)")
ok("Salvarani: prazo 30/09, entrada 06/10, SLA 10 → 16/10", dia(prazoNaoAnteriorAEntrada(d("2026-09-30T17:15:00Z"), d("2026-10-06T17:29:00Z"), 10)) === "2026-10-16")
ok("sem SLA: o prazo passa a ser a própria entrada", dia(prazoNaoAnteriorAEntrada(d("2026-09-30T17:15:00Z"), d("2026-10-06T17:29:00Z"), null)) === "2026-10-06")
ok("prazo igual ou posterior à entrada NÃO se mexe", prazoNaoAnteriorAEntrada(d("2026-10-16T00:00:00Z"), d("2026-10-06T17:29:00Z"), 10) === null && prazoNaoAnteriorAEntrada(d("2026-10-06T17:29:00Z"), d("2026-10-06T17:29:00Z"), 10) === null)
ok("sem entrada conhecida ou sem prazo: nada a fazer", prazoNaoAnteriorAEntrada(d("2026-09-30T00:00:00Z"), null, 10) === null && prazoNaoAnteriorAEntrada(null, d("2026-10-06T00:00:00Z"), 10) === null)

console.log("\n2) Fiação: uma função, todas as portas")
const canon = ler("lib/operacional/tarefa-canonica.ts")
ok("a tarefa que já existe é reancorada na materialização (chave e unidade)", (canon.match(/await ajustarPrazoAEntradaNaFase\(tx,/g) ?? []).length === 3)
ok("só tarefa aberta, da fase atual do processo, é tocada; auditoria TAREFA_PRAZO_REANCORADO", /processo\?\.faseAtualKey !== t\.faseMacroKey/.test(canon) && /TAREFA_PRAZO_REANCORADO/.test(canon) && /CONCLUIDO_RECEBIDO/.test(canon))
ok("o reconciliador aplica a regra a toda tarefa existente (processos em andamento)", /ajustarPrazoAEntradaNaFase\(tx, t\.id, slaT\)/.test(ler("lib/operacional/reconciliar-tarefas.ts")))
ok("hover do prazo mostra a origem (vem do servidor, não da tela)", /prazoOrigem/.test(ler("lib/operacional/torre-proxima-acao.ts")) && /title=\{acao\?\.prazoOrigem/.test(ler("src/components/torre/TorreProcessos.tsx")))
ok("o vigia reprova prazo anterior à entrada", /prazosAntesDaEntrada\(\)/.test(ler("lib/operacional/torre-coerencia-abas.ts")))

console.log(`\n${n - falhou}/${n} verificações`)
if (falhou > 0) process.exit(1)

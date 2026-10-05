// scripts/torre-ajustes-passos-e-prazo.test.ts — card por passo sem "Sem responsável" como passo; coluna Prazo curta (sem banco).
import { readFileSync } from "node:fs"
import { textoPrazoCompacto } from "../lib/operacional/torre-tarefas-tela"
let passou = 0, falhou = 0
const ok = (n: string, c: boolean, x = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n} ${x}`) } }
const f = (p: string) => readFileSync(p, "utf8")

console.log("Prazo compacto (dias operacionais, 'dias' por extenso)")
const agora = new Date("2026-10-05T15:00:00Z")
const iso = (dia: string) => `${dia}T15:00:00Z`
ok("5 dias atrás → 'venceu há 5 dias'", textoPrazoCompacto({ dataPrazo: iso("2026-09-30") }, agora).texto === "venceu há 5 dias")
ok("1 dia atrás → 'venceu há 1 dia' (singular)", textoPrazoCompacto({ dataPrazo: iso("2026-10-04") }, agora).texto === "venceu há 1 dia")
ok("hoje / amanhã", textoPrazoCompacto({ dataPrazo: iso("2026-10-05") }, agora).texto === "vence hoje" && textoPrazoCompacto({ dataPrazo: iso("2026-10-06") }, agora).texto === "vence amanhã")
ok("daqui a 3 dias → 'vence em 3 dias'", textoPrazoCompacto({ dataPrazo: iso("2026-10-08") }, agora).texto === "vence em 3 dias")
ok("sem prazo → 'Sem prazo' e sem dica", JSON.stringify(textoPrazoCompacto({ dataPrazo: null }, agora)) === JSON.stringify({ texto: "Sem prazo", dica: null }))
ok("a data (dd/mm) vai na dica, não no texto", textoPrazoCompacto({ dataPrazo: iso("2026-09-30") }, agora).dica === "30/09")
const todos = ["2026-09-01", "2026-10-04", "2026-10-05", "2026-10-06", "2026-12-30"].map((d) => textoPrazoCompacto({ dataPrazo: iso(d) }, agora).texto)
ok("nenhum texto abrevia 'dias' para 'd' e todos são curtos (≤ 24 caracteres ≈ 2 linhas)", todos.every((t) => !/\b\d+ d\b/.test(t) && t.length <= 24), todos.join(" | "))
const tab = f("src/components/torre/TarefasTabela.tsx"), css = f("src/components/torre/tarefas.css")
ok("a tabela usa o prazo compacto e a coluna tem largura mínima", tab.includes("textoPrazoCompacto(l, agora)") && css.includes("minmax(84px, 1.4fr)"))

console.log("Card por passo")
const card = f("src/components/torre/TorrePassosDaFase.tsx"), lib = f("lib/operacional/torre-fase.ts")
const semComentarios = lib.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n")
ok("'Sem responsável' não é mais caixa (passo) da lista", !semComentarios.includes("__sem_responsavel"))
ok("as sem responsável vêm numa linha à parte, discreta, abaixo das caixas", card.includes("tor-pf-semresp") && card.indexOf("tor-pf-caixas") < card.indexOf("tor-pf-semresp") && css.length > 0 && f("src/components/torre/torre-processos.css").includes(".tor-pf-semresp"))
console.log(`\n${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)

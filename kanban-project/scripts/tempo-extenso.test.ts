// scripts/tempo-extenso.test.ts — tempo por extenso: singular/plural, "menos de 1 …" e a forma curta só onde é selo pequeno (sem banco).
import { readFileSync } from "node:fs"
import { diasPorExtenso, horasPorExtenso, minutosPorExtenso } from "../lib/operacional/tempo-extenso"
import { textoDuracao, textoNaFase } from "../lib/operacional/torre-fase"
let passou = 0, falhou = 0
const ok = (n: string, c: boolean, x = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n} ${x}`) } }
ok("dias: 5 dias · 1 dia · menos de 1 dia", diasPorExtenso(5) === "5 dias" && diasPorExtenso(1) === "1 dia" && diasPorExtenso(0) === "menos de 1 dia" && diasPorExtenso(-3) === "menos de 1 dia")
ok("horas: 5 horas · 1 hora · menos de 1 hora", horasPorExtenso(5) === "5 horas" && horasPorExtenso(1) === "1 hora" && horasPorExtenso(0) === "menos de 1 hora")
ok("minutos: 10 minutos · 1 minuto · menos de 1 minuto", minutosPorExtenso(10) === "10 minutos" && minutosPorExtenso(1) === "1 minuto" && minutosPorExtenso(0) === "menos de 1 minuto")
ok("número quebrado e NaN não viram texto estranho", diasPorExtenso(2.9) === "2 dias" && diasPorExtenso(NaN) === "menos de 1 dia")
ok("Na fase há (Processos): '5 dias', '1 dia', 'menos de 1 hora' (nunca '0 dias')", textoDuracao(5, 120) === "5 dias" && textoDuracao(1, 26) === "1 dia" && textoDuracao(0, 0) === "menos de 1 hora" && textoDuracao(0, 5) === "5 horas")
ok("Na fase há com meta: '52 dias / 30 dias'", textoNaFase({ naFase: { desde: null, origem: null, dias: 52, horas: 1248 }, metaDias: 30 }) === "52 dias / 30 dias")
ok("o selo pequeno do Radar continua curto ('52 d')", textoDuracao(52, 1248, true) === "52 d")
const semComentarios = (p: string) => readFileSync(p, "utf8").split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n")
for (const p of ["lib/operacional/torre-tarefas-tela.ts", "lib/operacional/terceiros-pedidos.ts", "lib/operacional/torre-risco.ts", "lib/operacional/regras-torre.ts", "lib/operacional/precisa-de-voce-decisoes.ts"])
  ok(`${p}: sem 'há N d' / 'N d' abreviado em texto`, !/\$\{[^}]+\} d[`'" ]|\} d\b/.test(semComentarios(p).replace(/\bdias\b/g, "")), p)
console.log(`\n${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)

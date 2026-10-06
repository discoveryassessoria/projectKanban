// scripts/torre-paridade-numeros.test.ts — o MESMO número em toda superfície da Torre (sem banco).
//   npx tsx scripts/torre-paridade-numeros.test.ts
import { readFileSync } from "node:fs"
import { ehCobravelVencido } from "../lib/operacional/torre-predicados"
import { numeroDoKpi, situacaoDaTarefa, type LinhaParaKpi } from "../lib/operacional/torre-kpis"
import { precisaCobrar } from "../lib/operacional/terceiros-pedidos"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const agora = new Date("2026-10-05T15:00:00Z")

const base: LinhaParaKpi = { processoId: 1, dataPrazo: null, responsavelId: 1, atrasada: false, diasParaPrazo: null, estadoOperacao: "AGUARDANDO", acompanhamentoVencido: false, escalada: false, faseMacroKey: "emissao", cobrarEm: null }
const linhas: LinhaParaKpi[] = [
  { ...base },                                                              // aguardando, sem data: não cobra
  { ...base, acompanhamentoVencido: true },                                 // acompanhamento vencido
  { ...base, cobrarEm: "2026-10-02T12:00:00Z" },                            // data passou
  { ...base, cobrarEm: "2026-10-05T12:00:00Z" },                            // data é hoje
  { ...base, cobrarEm: "2026-10-09T12:00:00Z" },                            // data futura
  { ...base, acompanhamentoVencido: true, faseMacroKey: "genealogia" },     // genealogia: nunca
  { ...base, estadoOperacao: "FILA", cobrarEm: "2026-10-02T12:00:00Z" },    // não é pedido
  { ...base, estadoOperacao: "CONCLUIDA", acompanhamentoVencido: true },    // encerrada
]
console.log("a cobrar: um predicado só")
const kpi = numeroDoKpi("cob", linhas, agora)
const lista = linhas.filter((l) => ehCobravelVencido(l, agora)).length
const terc = linhas.filter((l) => precisaCobrar({ ...l, cobravelVencida: l.acompanhamentoVencido, cobrarEm: l.cobrarEm ?? null }, agora)).length
ok("cartão = 3 (vencido + data passada + data de hoje)", kpi === 3, String(kpi))
ok("botão/selo/filtro = cartão", lista === kpi)
ok("Terceiros (paraCobrar) = cartão", terc === kpi, String(terc))

console.log("aguardando terceiros: partição")
const sem = { ...base, responsavelId: null }
ok("aguardando sem responsável conta em 'sem responsável', não em 'aguardando terceiros'", situacaoDaTarefa(sem) === "ninguem" && situacaoDaTarefa(base) === "cartorio")
const fonte = (p: string) => readFileSync(p, "utf8")
ok("Terceiros e Foco dizem 'com ou sem responsável' (contam todo AGUARDANDO, como o filtro da aba Tarefas)", fonte("src/components/torre/TorreTerceiros.tsx").includes("aguardando terceiros (com ou sem responsável)") && fonte("src/components/torre/ProcessoCabecalho.tsx").includes("com ou sem responsável"))

console.log("Processos: o botão e a Saúde da fase dizem o que contam")
ok("o botão e a Saúde da fase se chamam 'parados ou sem dono' (pa + sd) — não repetem o nome 'parado' do funil, que conta outra coisa",
  fonte("src/components/torre/TorreSaudeDaFase.tsx").includes("<span>parados ou sem dono</span>") && fonte("lib/operacional/torre-fase.ts").includes("p.situacao === 'pa' || p.situacao === 'sd'"))

console.log(`\n${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)

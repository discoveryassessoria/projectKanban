// scripts/paridade-central-a-receber.test.ts — "Total a receber" da Central e da aba A Receber saem da MESMA função (sem banco).
//   npx tsx scripts/paridade-central-a-receber.test.ts
import { readFileSync } from "node:fs"
import { totaisAReceber, diasAteVencimento, estaVencida, venceEm, type ObrigacaoParaTotais } from "../lib/financeiro/leitura/totais-a-receber"
let passou = 0, falhou = 0
const ok = (n: string, c: boolean, x = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n} ${x}`) } }
const f = (p: string) => readFileSync(p, "utf8")
const agora = new Date("2026-10-05T12:00:00Z")

// Dados com moeda mista: o saldo "cru" está em EUR; o BRL é o que importa. Taxas diferentes por receita (como em produção).
const o = (saldo: number, saldoBrl: number, venc: string | null, extra: Partial<ObrigacaoParaTotais> = {}): ObrigacaoParaTotais =>
  ({ direcao: "A_RECEBER", saldo, saldoBrl, recebidoBrl: 0, vencimento: venc, ...extra })
const dados: ObrigacaoParaTotais[] = [
  o(6800, 42650.28, null), o(1800, 11302.56, null),             // sem vencimento (como hoje em produção)
  o(1000, 6272.1, "2026-09-01T12:00:00Z"),                       // vencida
  o(500, 3136.05, "2026-10-10T12:00:00Z"),                       // vence em 5 dias
  o(2000, 12558.4, "2026-12-30T12:00:00Z"),                      // além do horizonte
  o(0, 0, "2026-09-01T12:00:00Z", { recebidoBrl: 9000 }),        // quitada
  { direcao: "A_PAGAR", saldo: 300, saldoBrl: 1500, recebidoBrl: 0, vencimento: null }, // não é a receber
]
console.log("a soma é em REAIS, não em euro")
const t = totaisAReceber(dados, agora, 30)
const esperado = 42650.28 + 11302.56 + 6272.1 + 3136.05 + 12558.4
ok("total a receber = soma do saldo em R$ (não a soma crua em EUR)", Math.abs(t.totalReceberBRL - esperado) < 0.005, String(t.totalReceberBRL))
ok("não é a soma crua das moedas", t.totalReceberBRL !== 6800 + 1800 + 1000 + 500 + 2000)
ok("em aberto = 5 (quitada e A_PAGAR ficam fora)", t.qtdEmAberto === 5)
ok("vencido = 1 · R$ 6.272,10; sem vencimento nunca é vencido", t.qtdVencidas === 1 && t.totalVencidoBRL === 6272.1)
ok("a vencer em 30 dias = 1 · R$ 3.136,05 (o de dezembro e os sem data ficam fora)", t.qtdAVencer === 1 && t.totalAVencerBRL === 3136.05)
ok("recebido em R$ vem de recebidoBrl", t.totalRecebidoBRL === 9000)
ok("horizonte maior inclui o de dezembro", totaisAReceber(dados, agora, 90).totalAVencerBRL === 3136.05 + 12558.4)
ok("diasAteVencimento: sem data = null; ontem = -1", diasAteVencimento(null, agora) === null && diasAteVencimento("2026-10-04T12:00:00Z", agora) === -1)
ok("estaVencida/venceEm batem com os totais", dados.filter((x) => estaVencida(x, agora)).length === t.qtdVencidas && dados.filter((x) => venceEm(x, agora, 30)).length === t.qtdAVencer)

console.log("as duas telas usam a mesma função (e nenhuma soma por conta própria)")
const sem = (p: string) => f(p).split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n")
const receber = sem("src/app/api/financas/receber/route.ts")
const central = sem("src/components/financeiro/CentralFinanceira.tsx")
ok("A Receber: totais por totaisAReceber", receber.includes("totaisAReceber("))
ok("Central: totais por totaisAReceber", central.includes("totaisAReceber("))
ok("Central não soma `o.saldo` (moeda crua) em nenhum total", !/reduce\(\(s, o\) => s \+ o\.saldo\b/.test(central) && !/resumo\?\.aReceber\?\.saldo\b/.test(central))
ok("resumo V3 também expõe o total em R$ pela mesma função", sem("lib/financeiro/leitura/consultas.ts").includes("totaisAReceber("))
ok("o módulo dos totais não faz conta de câmbio nem lê banco", !/prisma|converter|cotacao|fx/i.test(sem("lib/financeiro/leitura/totais-a-receber.ts")))
console.log(`\n${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)

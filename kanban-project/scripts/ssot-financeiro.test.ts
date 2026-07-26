/**
 * ETAPA 1A — GUARDA do SSOT do Financeiro Geral.
 * Rodar: npm run test:ssot-financeiro
 *
 * O que este teste impede de voltar:
 *  1. constante de câmbio hardcoded em qualquer rota /api/financas;
 *  2. tributos e comissões servidos de constante em vez do cadastro oficial;
 *  3. quebra do DRE por percentual arbitrário;
 *  4. fallback silencioso para dado financeiro fabricado quando a API falha;
 *  5. conversão para BRL assumindo 1:1 quando não há cotação real.
 */
import { readFileSync, readdirSync, statSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { carregarFx, converterBrl, somarBrl, type FxFinancas } from "../lib/financeiro/cambio-financas"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const ler = (p: string) => readFileSync(join(ROOT, p), "utf8")

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

function rotas(dir: string): string[] {
  const base = join(ROOT, dir)
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) walk(p)
      else if (e === "route.ts") out.push(p)
    }
  }
  walk(base)
  return out
}

// ═══════════ 1) CÂMBIO ═══════════
console.log("\n1) Câmbio — fonte única CotacaoCambio")
const todasRotas = rotas("src/app/api/financas")
const comFxFixo = todasRotas.filter((p) => /const FX\s*=\s*\{/.test(readFileSync(p, "utf8")))
ok(comFxFixo.length === 0, `nenhuma rota /financas com FX hardcoded (${todasRotas.length} rotas varridas)`)

const consumidorasFx = ["dre", "receber", "fluxo", "dashboard"]
for (const r of consumidorasFx) {
  const src = ler(`src/app/api/financas/${r}/route.ts`)
  ok(/cambio-financas/.test(src), `${r} importa a fonte única de câmbio`)
  ok(/naoConvertido/.test(src), `${r} declara o que não pôde ser convertido`)
}

// ═══════════ 2) TRIBUTOS E COMISSÕES ═══════════
console.log("\n2) Tributos e comissões — cadastro oficial")
const impostos = ler("src/app/api/financas/impostos/route.ts")
ok(/prisma\.imposto\.findMany/.test(impostos), "impostos lê o cadastro `Imposto`")
ok(!/DAS Simples|INSS Patronal|ISS Amparo|IRRF/.test(impostos), "impostos não tem tributo hardcoded")
ok(!/const TRIBUTOS|const CALENDARIO|const CARGA/.test(impostos), "impostos não tem constante de negócio")
ok(/fonte: "cadastro:Imposto"/.test(impostos), "impostos declara a fonte")

const comissoes = ler("src/app/api/financas/comissoes/route.ts")
ok(/prisma\.regraComissao\.findMany/.test(comissoes), "comissões lê o cadastro `RegraComissao`")
ok(!/João Silva|Studio Romano|Despachante Lisboa/.test(comissoes), "comissões não tem beneficiário fictício")
ok(!/const COMISSOES|const REGRAS/.test(comissoes), "comissões não tem constante de negócio")
ok(/comissoes: \[\]/.test(comissoes), "comissões apuradas voltam vazias (não há tabela de apuração)")

// ═══════════ 3) DRE ═══════════
console.log("\n3) DRE — sem percentual arbitrário")
const dre = ler("src/app/api/financas/dre/route.ts")
ok(!/\* 0\.136|receitaBruta \* 0\.13/.test(dre), "alíquota agregada de 13,6% eliminada")
ok(!/0\.45\)|0\.18\)|0\.12\)|0\.10\)|0\.08\)|0\.05\)|0\.02\)/.test(dre), "quebra de despesas por percentual fixo eliminada")
ok(/prisma\.imposto\.findMany/.test(dre), "impostos do DRE vêm do cadastro oficial")
ok(/aplicaA: "revenue"/.test(dre), "DRE filtra tributos que incidem sobre receita")
ok(/categoriaFinanceira\.findMany/.test(dre), "despesas agrupadas por categoria real")
ok(/planoContaVinculado: false/.test(dre), "DRE declara honestamente a falta de vínculo com PlanoConta")
ok(/prisma\.planoConta\.findMany/.test(dre), "DRE expõe o plano de contas oficial")

// ═══════════ 4) FALLBACK SILENCIOSO ═══════════
console.log("\n4) Sem fallback silencioso para dado fabricado")
for (const [tela, marcador] of [
  ["src/app/financas/contas-pagar/page.tsx", "Imobiliária Central"],
  ["src/app/financas/fornecedores/page.tsx", "Central Imóveis"],
] as const) {
  const src = ler(tela)
  ok(!src.includes(marcador), `${tela.split("/").slice(-2)[0]} não injeta dado fabricado`)
  ok(/setErro\(/.test(src), `${tela.split("/").slice(-2)[0]} sinaliza erro ao usuário`)
  ok(/role="alert"/.test(src), `${tela.split("/").slice(-2)[0]} renderiza o alerta`)
}

// ═══════════ 5) CONVERSOR ═══════════
console.log("\n5) Conversor — nunca assume 1:1")
const fxSemEur: FxFinancas = { taxas: { BRL: 1 }, indisponiveis: ["EUR"], fonte: "teste", dataReferencia: null }
ok(converterBrl(fxSemEur, 100, "EUR") === null, "moeda sem cotação devolve null (não 1:1)")
ok(converterBrl(fxSemEur, 100, "BRL") === 100, "BRL converte 1:1 corretamente")

const fxComEur: FxFinancas = { taxas: { BRL: 1, EUR: 6 }, indisponiveis: [], fonte: "teste", dataReferencia: "2026-07-26" }
ok(converterBrl(fxComEur, 100, "EUR") === 600, "cotação real é aplicada")

const soma = somarBrl(fxSemEur, [
  { valor: 100, moeda: "BRL" },
  { valor: 50, moeda: "EUR" },
  { valor: 30, moeda: "EUR", valorBrl: 180 },
])
ok(soma.total === 280, "total soma só o que é conversível + valorBrl congelado")
ok(soma.naoConvertido.length === 1 && soma.naoConvertido[0].moeda === "EUR" && soma.naoConvertido[0].valor === 50,
  "o que não converteu é declarado, não silenciado")
ok(typeof carregarFx === "function", "carregarFx exportado")

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
console.log("SSOT do Financeiro Geral: validado ✅")

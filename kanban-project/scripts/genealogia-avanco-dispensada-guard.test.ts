/**
 * GUARDA — Avanço da Genealogia não trava por passo de necessidade DISPENSADA
 * nem por passo órfão (genérico do WF Interno). Rodar:
 *   tsx scripts/genealogia-avanco-dispensada-guard.test.ts
 *
 * BUG: a Central (fonte oficial de progresso) ignora necessidades DISPENSADA e
 * mostrava 100%, mas o BlockingEngine bloqueava nos STEPS dessas necessidades
 * (passo ainda DISPONIVEL/CANCELADO) e no passo órfão localizar_registro
 * (necessidadeId=null) → processo travava na Genealogia com cabeçalho 0/3.
 *
 * FIX: no BlockingEngine, um passo localizar_registro órfão ou de necessidade
 * DISPENSADA não é obrigação aberta (alinhado à Central). Teste ESTÁTICO.
 */
import { readFileSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
let passed = 0, failed = 0
const viol: string[] = []
function ok(c: boolean, n: string) { if (c) { passed++; console.log(`  ✅ ${n}`) } else { failed++; viol.push(n); console.log(`  ❌ ${n}`) } }
const ler = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "")

const engine = ler("src/lib/motor/blocking-engine.ts")
const helpers = ler("src/lib/motor/blocking-helpers.ts")
// A lógica de gate migrou para a FUNÇÃO-BASE ÚNICA (computeGate), consumida tanto pelo
// BlockingEngine quanto pelo resolver canônico. As asserções agora leem o núcleo puro.
const core = ler("src/lib/motor/operational-projection-core.ts")

console.log("\n1) Gate (função-base) ignora genéricos por escopo e entidade DISPENSADA")
ok(/computeGate\(/.test(engine), "BlockingEngine delega o gate à função-base computeGate")
ok(/necStatusById = new Map\(input\.necessidades\.map/.test(core), "core constrói mapa necessidadeId → status")
ok(/const gateSteps = resolvePassosBloqueantesDaFase\(input\.steps\)/.test(core), "core usa o resolver canônico por escopo (genéricos fora quando há entidade) — sem hardcode")
ok(/step\.necessidadeId != null && necStatusById\.get\(step\.necessidadeId\) === "DISPENSADA"[\s\S]*?continue/.test(core), "passo de necessidade DISPENSADA não bloqueia")
ok(!/const isGenealogia\s*=/.test(engine) && !/step\.stepKey === "localizar_registro"/.test(core), "sem skip hardcoded por nome de fase / stepKey")

console.log("\n2) Não afeta as demais fases (mudança escopada, PASSO_OK inalterado)")
ok(/const PASSO_OK = new Set\(\["CONCLUIDO", "DISPENSADO", "SUPERSEDIDO"\]\)/.test(helpers), "PASSO_OK sem CANCELADO (fix amplo revertido — sem impacto em outras fases)")

console.log("\n3) Avanço continua pelo pipeline oficial (recalcular → advance → gate BlockingEngine)")
const recalc = ler("src/lib/process-stage/recalcular-fase.ts")
ok(/advance\(processo\.id\)/.test(recalc), "recalcularFaseDoProcesso delega ao PhaseAdvanceService (advance)")

console.log(`\n${failed === 0 ? "✅" : "❌"} GUARDA AVANÇO/DISPENSADA — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("Falhas: " + viol.join("; ")); process.exit(1) }

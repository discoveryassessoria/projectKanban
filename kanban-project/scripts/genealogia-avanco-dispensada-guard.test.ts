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

console.log("\n1) BlockingEngine ignora passos localizar_registro órfãos / de necessidade DISPENSADA (Genealogia)")
ok(/necStatusById = new Map\(necessidadesRaw\.map/.test(engine), "constrói mapa necessidadeId → status")
ok(/isGenealogia && step\.stepKey === "localizar_registro"/.test(engine), "regra escopada à Genealogia + localizar_registro")
ok(/step\.necessidadeId == null \|\| ns === "DISPENSADA"[\s\S]*?continue/.test(engine), "pula passo órfão (necessidadeId null) ou de necessidade DISPENSADA")

console.log("\n2) Não afeta as demais fases (mudança escopada, PASSO_OK inalterado)")
ok(/const PASSO_OK = new Set\(\["CONCLUIDO", "DISPENSADO", "SUPERSEDIDO"\]\)/.test(helpers), "PASSO_OK sem CANCELADO (fix amplo revertido — sem impacto em outras fases)")

console.log("\n3) Avanço continua pelo pipeline oficial (recalcular → advance → gate BlockingEngine)")
const recalc = ler("src/lib/process-stage/recalcular-fase.ts")
ok(/advance\(processo\.id\)/.test(recalc), "recalcularFaseDoProcesso delega ao PhaseAdvanceService (advance)")

console.log(`\n${failed === 0 ? "✅" : "❌"} GUARDA AVANÇO/DISPENSADA — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("Falhas: " + viol.join("; ")); process.exit(1) }

/**
 * GUARDA — Fatia 1: reconciliação dos 3 bloqueios do runtime da Genealogia.
 * Rodar: tsx scripts/genealogia-fatia1-guard.test.ts
 *
 * 1. Casing do gate: blocking-engine compara normalizado (não o literal cru).
 * 2. Catálogo unificado: passo canônico "localizar_registro"; sem alias de genealogia;
 *    seed do workflow interno = passo único; sem "buscar_certidao" no runtime.
 * 3. Regra de conclusão unificada (= front): cartório + (livro|folha|termo),
 *    exclusiva (sem fallback por status em "localizado").
 * Teste ESTÁTICO (source-scan) + checagem lógica da regra.
 */
import { readFileSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
let passed = 0, failed = 0
const viol: string[] = []
function ok(c: boolean, n: string) { if (c) { passed++; console.log(`  ✅ ${n}`) } else { failed++; viol.push(n); console.log(`  ❌ ${n}`) } }
const ler = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "")

console.log("\n1) Casing do gate da Genealogia")
const be = ler("src/lib/motor/blocking-engine.ts")
ok(/toUpperCase\(\)\s*===\s*"GENEALOGIA"/.test(be), "blocking-engine normaliza casing (toUpperCase === GENEALOGIA)")
ok(!/faseMacroKey\s*===\s*"GENEALOGIA"/.test(be), "sem comparação literal crua faseMacroKey === \"GENEALOGIA\"")

console.log("\n2) Catálogo de passos unificado (localizar_registro canônico)")
const fc = ler("src/lib/process-stage/fases-catalog.ts")
// alias de genealogia removido; fases-catalog usa localizar_registro (canônico)
ok(!/genealogia:\s*\{[\s\S]*?"buscar_certidao"/.test(fc), "STEP_KEY_ALIASES SEM entrada genealogia (alias removido)")
ok(/stepKey:\s*"localizar_registro"/.test(fc) && !/buscar_documento/.test(fc), "fases-catalog GENEALOGIA usa stepKey localizar_registro (não buscar_documento)")
const seed = ler("prisma/seed-workflows-fase.ts")
ok(/genealogia:\s*\['Localizar registro da certidão'\]/.test(seed), "seed do workflow interno: genealogia = passo único 'Localizar registro da certidão'")
// nenhum runtime keyeando buscar_certidao (fora de comentários) em código-fonte de motor/execução
for (const rel of ["src/services/processEngine/stepCompletionResolver.ts", "src/services/documento-operacao.ts", "src/lib/process-stage/fases-catalog.ts"]) {
  const semComentario = ler(rel).split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n")
  ok(!/buscar_certidao/.test(semComentario), `${rel.split("/").pop()} não referencia buscar_certidao no código`)
}

console.log("\n3) Regra de conclusão unificada (back = front)")
const scr = ler("src/services/processEngine/stepCompletionResolver.ts")
ok(/naoVazio\(d\.cartorio\)\s*&&\s*\(naoVazio\(d\.livro\)\s*\|\|\s*naoVazio\(d\.folha\)\s*\|\|\s*naoVazio\(d\.termo\)\)/.test(scr),
  "temDadosRegistrais = cartório && (livro|folha|termo)")
ok(!/const located = temDadosRegistrais\(d\)\s*\|\|\s*STATUS_LOCALIZADO/.test(scr), "located NÃO tem fallback por status (regra exclusiva)")
ok(/const located = temDadosRegistrais\(d\)\s*\n/.test(scr) || /const located = temDadosRegistrais\(d\)$/m.test(scr), "located usa exclusivamente a regra registral")
// front continua com a mesma regra (fonte da unificação)
const front = ler("src/components/kanban/workflow/EditorRegistralModal.tsx")
ok(/cartorio\.trim\(\)\.length\s*>\s*0/.test(front) && /livro[\s\S]{0,40}folha[\s\S]{0,40}termo/.test(front), "front (EditorRegistralModal) mantém cartório + (livro|folha|termo)")

console.log(`\n${failed === 0 ? "✅" : "❌"} GUARDA FATIA 1 — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("Falhas: " + viol.join("; ")); process.exit(1) }

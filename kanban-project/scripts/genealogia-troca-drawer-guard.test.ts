/**
 * GUARDA — a Central troca de contexto no avanço de fase (não fica presa na Genealogia).
 * Rodar: tsx scripts/genealogia-troca-drawer-guard.test.ts
 *
 * BUG: após o avanço genealogia→emissão, a Central continuava mostrando o drawer da
 * Genealogia (passo localizar_registro). Causa: `faseAtualNome` era derivado do PROP
 * estático `processo.faseAtualKey` (não reflete o avanço), não da resposta fresca da
 * rota. E o drawer aberto mantinha o contexto da fase antiga.
 *
 * FIX: fase vem de data.faseProgress.faseCode (fresco a cada fetch); ao mudar a fase,
 * o drawer é fechado (sem estado residual). Teste ESTÁTICO.
 */
import { readFileSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
let passed = 0, failed = 0
const viol: string[] = []
function ok(c: boolean, n: string) { if (c) { passed++; console.log(`  ✅ ${n}`) } else { failed++; viol.push(n); console.log(`  ❌ ${n}`) } }
const ler = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "")

const c = ler("src/components/kanban/ProcessoCentralOperacional.tsx")

console.log("\n1) Fase renderizada vem da resposta FRESCA da rota (não do prop estático)")
ok(/faseCodeData = \(data\?\.faseProgress\?\.faseCode/.test(c), "faseCodeData lê data.faseProgress.faseCode")
ok(/const faseKey =\s*faseCodeData \?\?/.test(c), "faseKey prioriza a fase fresca; prop é só fallback")

console.log("\n2) Drawer fecha ao mudar de fase (troca de contexto, sem estado residual)")
ok(/faseCodeRef = useRef/.test(c), "ref rastreia a fase anterior")
ok(/faseCodeRef\.current !== undefined && faseCodeRef\.current !== fc[\s\S]*?setDrawerDocId\(null\)/.test(c), "fase mudou → fecha o drawer (setDrawerDocId null)")
ok(/faseCodeRef\.current !== fc[\s\S]*?setInitModalDocId\(null\)[\s\S]*?setErroOperacao\(null\)/.test(c), "limpa também initModal e erro (sem contexto antigo)")
ok(/\}, \[data\?\.faseProgress\?\.faseCode\]\)/.test(c), "efeito reage à mudança de data.faseProgress.faseCode")

console.log(`\n${failed === 0 ? "✅" : "❌"} GUARDA TROCA-DRAWER — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("Falhas: " + viol.join("; ")); process.exit(1) }

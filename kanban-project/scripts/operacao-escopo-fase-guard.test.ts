/**
 * GUARDA — o contexto operacional (workflow do drawer + progresso) é SEMPRE escopado
 * à FASE ATUAL persistida do processo, genérico p/ qualquer transição do Workflow Macro.
 * Rodar: tsx scripts/operacao-escopo-fase-guard.test.ts
 *
 * CAUSA RAIZ do "drawer da Emissão mostrando localizar_registro da Genealogia": um mesmo
 * Documento acumula passos de várias fases; a fonte (passosOperacaoV2) lia por documentoId
 * SEM filtrar a fase → misturava passos de fases anteriores (mesmo CONCLUIDO).
 * FIX: passosOperacaoV2/temOperacaoV2 filtram por faseMacroKey = processo.faseAtualKey.
 * Front: fase vem da resposta fresca; drawer remonta por (fase+doc) e descarta respostas
 * antigas (guard de corrida). Teste ESTÁTICO.
 */
import { readFileSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
let passed = 0, failed = 0
const viol: string[] = []
function ok(c: boolean, n: string) { if (c) { passed++; console.log(`  ✅ ${n}`) } else { failed++; viol.push(n); console.log(`  ❌ ${n}`) } }
const ler = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "")

const svc = ler("src/services/documento-operacao.ts")
const central = ler("src/components/kanban/ProcessoCentralOperacional.tsx")
const drawer = ler("src/components/kanban/DocumentoOperationalDrawer.tsx")

console.log("\n1) Backend: fonte do workflow escopada à FASE ATUAL (genérico, sem condicional por fase)")
ok(/async function faseAtualKeyDoDoc\(documentoId: number\)/.test(svc), "helper faseAtualKeyDoDoc resolve a fase atual do processo do doc")
ok(/passosOperacaoV2[\s\S]*?faseAtualKey = await faseAtualKeyDoDoc\(documentoId\)[\s\S]*?faseAtualKey \? \{ faseMacroKey: faseAtualKey \}/.test(svc), "passosOperacaoV2 filtra por faseMacroKey = fase atual")
ok(/temOperacaoV2[\s\S]*?faseAtualKey = await faseAtualKeyDoDoc\(documentoId\)[\s\S]*?faseMacroKey: faseAtualKey/.test(svc), "temOperacaoV2 escopado à fase atual (não bloqueia 'Iniciar operação' por passo de fase anterior)")
ok(!/if \(fase === "GENEALOGIA"\)|faseCode === "EMISSAO/.test(svc), "sem condicional rígida por fase na fonte")

console.log("\n2) Front: Central usa a fase FRESCA e remonta o drawer por (fase+doc)")
ok(/faseCodeData = \(data\?\.faseProgress\?\.faseCode/.test(central), "fase vem de data.faseProgress.faseCode (não do prop estático)")
ok(/key=\{`\$\{faseCodeData \?\? "\?"\}-\$\{drawerDocId \?\? "none"\}`\}/.test(central), "drawer tem key (fase+doc) → desmonta/remonta ao trocar de fase")
ok(/faseCodeRef\.current !== fc[\s\S]*?setDrawerDocId\(null\)/.test(central), "fase muda → fecha o drawer (sem estado residual)")

console.log("\n3) Drawer: descarta respostas antigas (guard de corrida)")
ok(/reqSeq = useRef\(0\)/.test(drawer), "reqSeq rastreia a carga vigente")
ok(/const seq = \+\+reqSeq\.current/.test(drawer) && /vigente = \(\) => seq === reqSeq\.current/.test(drawer), "cada carga tem seq; vigente() compara com a mais recente")
ok(/if \(!vigente\(\)\) return[\s\S]*?setDoc\(data\)/.test(drawer), "resposta antiga NÃO sobrescreve o doc atual")

console.log(`\n${failed === 0 ? "✅" : "❌"} GUARDA ESCOPO-FASE — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("Falhas: " + viol.join("; ")); process.exit(1) }

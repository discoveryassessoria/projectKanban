/**
 * Catálogo de Fases — conversão canônica faseCode ⇄ phaseKey.
 * Rodar: npm run test:fases
 * Puro (sem banco) + guarda estrutural contra conversões diretas dispersas.
 */
import { FASES, faseCodeToPhaseKey, phaseKeyToFaseCode } from "../src/lib/process-stage/fases-catalog"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join, relative } from "path"
import { execSync } from "child_process"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

console.log("Catálogo de Fases — conversão canônica faseCode ⇄ phaseKey\n")

const codes = Object.keys(FASES) as (keyof typeof FASES)[]

// 1) round-trip completo para todas as fases
console.log("Round-trip:")
let rtOk = true
for (const code of codes) {
  const pk = faseCodeToPhaseKey(code)
  if (pk !== FASES[code].phaseKey) { rtOk = false; console.log(`    ! ${code}: faseCodeToPhaseKey=${pk} != ${FASES[code].phaseKey}`) }
  if (phaseKeyToFaseCode(pk) !== code) { rtOk = false; console.log(`    ! ${code}: phaseKeyToFaseCode(${pk})=${phaseKeyToFaseCode(pk)} != ${code}`) }
}
ok(rtOk, `1. round-trip faseCode⇄phaseKey para as ${codes.length} fases`)

// 2) valores conhecidos
ok(faseCodeToPhaseKey("GENEALOGIA") === "genealogia", "2. faseCodeToPhaseKey(GENEALOGIA)=genealogia")
ok(phaseKeyToFaseCode("genealogia") === "GENEALOGIA", "3. phaseKeyToFaseCode(genealogia)=GENEALOGIA")

// 3) tolerância de case: aceita MAIÚSCULO (faseCode legado do Workflow) como entrada de phaseKey
ok(phaseKeyToFaseCode("GENEALOGIA") === "GENEALOGIA" && phaseKeyToFaseCode("EMISSAO_DOCUMENTAL") === "EMISSAO_DOCUMENTAL",
  "4. phaseKeyToFaseCode tolera MAIÚSCULO (workflow.faseCode legado)")

// 4) desconhecido / nulo
ok(phaseKeyToFaseCode("xpto") === null && phaseKeyToFaseCode(null) === null && phaseKeyToFaseCode(undefined) === null,
  "5. phaseKeyToFaseCode: null p/ desconhecido/vazio (não inventa)")
ok(faseCodeToPhaseKey(null) === null && faseCodeToPhaseKey("QUALQUER_NOVA") === "qualquer_nova",
  "6. faseCodeToPhaseKey: null p/ vazio; fallback lowercase p/ código fora do catálogo")

// 5) todas as fases têm phaseKey minúsculo e único
const pks = codes.map((c) => FASES[c].phaseKey)
ok(pks.every((k) => k === k.toLowerCase() && k.length > 0), "7. todo phaseKey é minúsculo e não-vazio")
ok(new Set(pks).size === pks.length, "8. phaseKeys únicos")

// 6) GUARDA ESTRUTURAL: nenhuma conversão direta faseCode↔phaseKey fora do catálogo
console.log("\nGuarda estrutural (sem conversão direta dispersa):")
let stray = ""
try {
  stray = execSync(
    `grep -rn "toUpperCase() as FaseCode\\|faseAtualKey?.toUpperCase\\|faseAtualKey.toUpperCase\\|faseCode).toLowerCase\\|proximaFase.toLowerCase" ${JSON.stringify(join(ROOT, "src"))} ${JSON.stringify(join(ROOT, "prisma"))} --include="*.ts" --include="*.tsx" 2>/dev/null || true`,
    { encoding: "utf8" }
  )
} catch { stray = "" }
const strayLines = stray.split("\n").filter((l) => l.trim() && !l.includes("fases-catalog.ts"))
if (strayLines.length) strayLines.forEach((l) => console.log("    ! " + relative(ROOT, l)))
ok(strayLines.length === 0, "9. nenhuma conversão faseCode↔phaseKey fora do catálogo")

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
console.log("Catálogo de fases: conversão canônica validada ✅")

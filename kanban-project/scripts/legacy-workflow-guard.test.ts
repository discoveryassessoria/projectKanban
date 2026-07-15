/**
 * GUARDA DE CUTOVER — Workflow V2. Rodar: tsx scripts/legacy-workflow-guard.test.ts
 *
 * Ratchet: o uso OPERACIONAL do legado (prisma.workflow / prisma.workflowStep +
 * relação `.workflows` legada) fica confinado à ALLOWLIST abaixo — os consumidores
 * ainda pendentes de migração para V2. Qualquer uso NOVO fora da lista FALHA o CI.
 * À medida que cada arquivo é migrado para V2, remova-o da allowlist (a lista só
 * pode encolher). Quando a allowlist zerar, o legado tem zero consumidores.
 *
 * NÃO cobre migration/backfill/reconciliação (uso histórico legítimo, excluído).
 */
import { readFileSync, readdirSync, statSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join, relative } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SRC = join(ROOT, "src")

// Consumidores operacionais do legado ainda NÃO migrados (a lista só encolhe).
const ALLOWLIST = new Set<string>([
  "src/app/api/documentos/[id]/workflow/route.ts",
  "src/app/api/documentos/[id]/workflow/steps/[stepId]/route.ts",
  "src/lib/process-stage/recalcular-fase.ts",
  "src/app/api/processos/[processoId]/central-operacional/route.ts",
  "src/app/api/processos/[processoId]/phase/route.ts",
  "src/services/completion-engine/index.ts",
])

// Padrões de uso OPERACIONAL do legado (exclui models/campos V2).
const LEGACY = /(prisma|tx)\.(workflow|workflowStep)\.(create|update|delete|upsert|createMany|updateMany|deleteMany|findMany|findFirst|findUnique|count|aggregate)|workflows:\s*\{\s*(select|where|some)/
const V2_FALSE_POSITIVE = /phaseWorkflow|[wW]orkflowInstance|[wW]orkflowStepInstance|workflowEvento|workflowRuntime/

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}

let passed = 0, failed = 0
const violacoes: string[] = []
const naoUsados: string[] = []

const arquivos = walk(SRC)
const usamLegado = new Set<string>()
for (const abs of arquivos) {
  const rel = relative(ROOT, abs)
  const linhas = readFileSync(abs, "utf8").split("\n")
  const usa = linhas.some((l) => LEGACY.test(l) && !V2_FALSE_POSITIVE.test(l))
  if (usa) {
    usamLegado.add(rel)
    if (!ALLOWLIST.has(rel)) violacoes.push(rel)
  }
}
// Allowlist não pode conter entradas mortas (força encolher conforme migra).
for (const a of ALLOWLIST) if (!usamLegado.has(a)) naoUsados.push(a)

console.log("Guarda de cutover Workflow V2\n")
if (violacoes.length === 0) { passed++; console.log("  ✅ nenhum uso operacional NOVO do legado fora da allowlist") }
else { failed++; console.log("  ❌ uso operacional NOVO do legado detectado:\n     - " + violacoes.join("\n     - ")) }

if (naoUsados.length === 0) { passed++; console.log("  ✅ allowlist sem entradas mortas (só arquivos que ainda usam legado)") }
else { failed++; console.log("  ❌ allowlist com entradas que NÃO usam mais legado (remova-as):\n     - " + naoUsados.join("\n     - ")) }

console.log(`\nConsumidores legados restantes: ${usamLegado.size} (allowlist: ${ALLOWLIST.size})`)
console.log(`${passed} passaram, ${failed} falharam`)
if (failed > 0) process.exit(1)
console.log("Guarda de cutover OK ✅")

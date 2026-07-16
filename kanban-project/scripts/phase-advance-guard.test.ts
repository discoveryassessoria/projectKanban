/**
 * GUARDA DE CONSOLIDAÇÃO DO AVANÇO DE FASE — Rodar: tsx scripts/phase-advance-guard.test.ts
 *
 * Invariantes protegidas (o CI falha se algo reintroduzir um caminho concorrente):
 *
 *  (1) ESCRITA DE FASE: `Processo.faseAtualKey` só pode ser escrita pelo
 *      PhaseAdvanceService. Nenhum controller/rota/serviço/componente pode
 *      escrever faseAtualKey diretamente (fora da ALLOWLIST, que só encolhe).
 *
 *  (2) EXECUÇÃO DE AVANÇO POR AUTOMAÇÃO: a camada de execução (src/lib/motor,
 *      src/services) não pode referenciar `phase_advance`/`phase_transition`
 *      como coisa a EXECUTAR. O avanço é do PhaseAdvanceService; automação só
 *      reage a eventos com efeitos (task/document/event/protocol/financial/alert).
 *
 *  Não cobre migration/backfill/seed/scripts (uso histórico legítimo, excluído).
 */
import { readFileSync, readdirSync, statSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join, relative } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SRC = join(ROOT, "src")

// --------------------------------------------------------------------------
// (1) Escritores permitidos de faseAtualKey (a lista SÓ ENCOLHE)
// --------------------------------------------------------------------------
//  - motor/phase-advance.ts  → o ÚNICO escritor canônico (CAS transacional).
//  - api/processos/route.ts   → criação do processo grava a FASE INICIAL (não é
//                               transição; é o estado inicial do agregado).
//  - components/kanban-board-novo.tsx → estado local otimista do React + corpo
//                               da requisição (NÃO é escrita em banco).
const ALLOWLIST_FASE_WRITE = new Set<string>([
  "src/lib/motor/phase-advance.ts",
  "src/app/api/processos/route.ts",
  "src/components/kanban-board-novo.tsx",
])

// Escrita de faseAtualKey em posição de MUTAÇÃO (data:) — exclui leitura.
const FASE_WRITE = /faseAtualKey\s*:/
const FASE_WRITE_FALSE_POSITIVE =
  /faseAtualKey\s*:\s*(true|false)\b|select\s*:|where\s*:|include\s*:|orderBy\s*:|faseAtualKey\s*:\s*string|faseAtualKey\?\s*:/

// --------------------------------------------------------------------------
// (2) phase_advance / phase_transition na camada de EXECUÇÃO
// --------------------------------------------------------------------------
const EXEC_DIRS = [join(SRC, "lib", "motor"), join(SRC, "services")]
const KIND_AVANCO = /phase_advance|phase_transition/

function walk(dir: string): string[] {
  const out: string[] = []
  let entries: string[] = []
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}

let passed = 0, failed = 0
const violacoes: string[] = []
function ok(cond: boolean, nome: string, detalhe?: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; violacoes.push(detalhe ? `${nome} — ${detalhe}` : nome); console.log(`  ❌ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
}

console.log("\nGUARDA — escrita direta de faseAtualKey")
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file)
  const linhas = readFileSync(file, "utf8").split("\n")
  linhas.forEach((linha, i) => {
    const semComentario = linha.replace(/\/\/.*$/, "")
    if (!FASE_WRITE.test(semComentario)) return
    if (FASE_WRITE_FALSE_POSITIVE.test(semComentario)) return
    if (ALLOWLIST_FASE_WRITE.has(rel)) return
    ok(false, `escrita direta de faseAtualKey proibida`, `${rel}:${i + 1}`)
  })
}
ok(violacoes.length === 0, "nenhuma escrita direta de faseAtualKey fora do PhaseAdvanceService")

console.log("\nGUARDA — phase_advance/phase_transition na camada de execução")
let execViol = 0
for (const dir of EXEC_DIRS) {
  for (const file of walk(dir)) {
    const rel = relative(ROOT, file)
    const linhas = readFileSync(file, "utf8").split("\n")
    linhas.forEach((linha, i) => {
      const semComentario = linha.replace(/\/\/.*$/, "").replace(/\/\*.*\*\//, "")
      if (KIND_AVANCO.test(semComentario)) {
        execViol++
        ok(false, `referência executável a phase_advance/phase_transition`, `${rel}:${i + 1}`)
      }
    })
  }
}
ok(execViol === 0, "camada de execução (motor/services) livre de phase_advance/phase_transition")

console.log(`\n${failed === 0 ? "✅" : "❌"} GUARDA DE AVANÇO DE FASE — ${passed} ok, ${failed} falhas`)
if (failed > 0) {
  console.log("\nViolações:")
  for (const v of violacoes) console.log(`  · ${v}`)
  process.exit(1)
}

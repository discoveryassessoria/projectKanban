/**
 * GUARDA — legado Status do domínio de PROCESSO. Rodar: tsx scripts/status-legacy-guard.test.ts
 *
 * O legado `Processo.statusId` / relação `Processo.status` / `Status.faseCode`
 * foi REMOVIDO por completo. A fase do processo é exclusivamente
 * `Processo.faseAtualKey`. O CI falha se qualquer um desses reaparecer.
 *
 * Observação: a reintrodução de `Processo.statusId`/`status` no CÓDIGO já quebra o
 * `tsc` (os tipos Prisma não têm mais esses campos). Esta guarda cobre o que o tsc
 * NÃO pega: o SCHEMA e símbolos/arquivos legados removidos + fallback de fase.
 * `Status` permanece legítimo APENAS no domínio de TAREFA (Tarefa.statusId).
 */
import { readFileSync, readdirSync, statSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join, relative } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SRC = join(ROOT, "src")

let passed = 0, failed = 0
const violacoes: string[] = []
function ok(cond: boolean, nome: string, detalhe?: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; violacoes.push(detalhe ? `${nome} — ${detalhe}` : nome); console.log(`  ❌ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
}

function walk(dir: string): string[] {
  const out: string[] = []
  let entries: string[] = []
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

// --------------------------------------------------------------------------
// 1) SCHEMA — Processo desacoplado de Status; Status.faseCode removido
// --------------------------------------------------------------------------
console.log("\nSCHEMA — Processo × Status")
const schema = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8")
const modelProcesso = (schema.match(/model Processo \{[\s\S]*?\n\}/) || [""])[0]
const modelStatus = (schema.match(/model Status \{[\s\S]*?\n\}/) || [""])[0]

ok(!/\bstatusId\b/.test(modelProcesso), "Processo NÃO tem statusId")
ok(!/\bstatus\s+Status\b/.test(modelProcesso), "Processo NÃO tem relação status → Status")
ok(!/@@index\(\[statusId\]\)/.test(modelProcesso), "Processo NÃO tem @@index([statusId])")
ok(!/\bprocessos\s+Processo\[\]/.test(modelStatus), "Status NÃO tem relação reversa processos")
ok(!/\bfaseCode\b/.test(modelStatus), "Status NÃO tem faseCode (ponte de fase removida)")
ok(/\btarefas\s+Tarefa\[\]/.test(modelStatus), "Status MANTÉM relação com Tarefa (domínio legítimo)")

// --------------------------------------------------------------------------
// 2) CÓDIGO — símbolos/arquivos legados removidos + fallback de fase por status
// --------------------------------------------------------------------------
console.log("\nCÓDIGO — símbolos legados de status do processo")
ok(!existsSync(join(SRC, "lib/process-stage/recalculate.ts")), "recalculate.ts (mover statusId) NÃO existe")

// Padrões proibidos em QUALQUER .ts/.tsx (comentários removidos da checagem):
//  - moverStatusIdLegacy: helper de escrita de Processo.statusId (removido)
//  - status.faseCode / status?.faseCode: fallback de fase via Status (removido)
//  - import do recalculate deletado
const PROIBIDOS: { re: RegExp; nome: string }[] = [
  { re: /\bmoverStatusIdLegacy\b/, nome: "moverStatusIdLegacy (escrita legada de statusId)" },
  { re: /status\??\.faseCode/, nome: "fallback de fase via status.faseCode" },
  { re: /process-stage\/recalculate\b/, nome: "import do recalculate.ts (deletado)" },
]

let codeViol = 0
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file)
  const linhas = readFileSync(file, "utf8").split("\n")
  linhas.forEach((linha, i) => {
    const semComentario = linha.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "")
    for (const p of PROIBIDOS) {
      if (p.re.test(semComentario)) { codeViol++; ok(false, p.nome, `${rel}:${i + 1}`) }
    }
  })
}
ok(codeViol === 0, "nenhum símbolo/fallback legado de status do processo no código")

// --------------------------------------------------------------------------
// 3) Status.processos em _count/relations (Status não conta processos)
// --------------------------------------------------------------------------
console.log("\nCÓDIGO — Status não referencia processos")
let countViol = 0
for (const file of walk(SRC)) {
  const conteudo = readFileSync(file, "utf8")
  // _count select de processos a partir de Status (relação inexistente)
  if (/_count:\s*\{\s*select:\s*\{\s*processos:\s*true/.test(conteudo.replace(/\s+/g, " "))) {
    // só é violação se o alvo for Status; heurística: arquivo em /status/
    if (/\/status\//.test(file)) { countViol++; ok(false, "Status _count.processos (relação removida)", relative(ROOT, file)) }
  }
}
ok(countViol === 0, "nenhum _count.processos sobre Status")

console.log(`\n${failed === 0 ? "✅" : "❌"} GUARDA STATUS-LEGADO — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("\nViolações:"); for (const v of violacoes) console.log(`  · ${v}`); process.exit(1) }

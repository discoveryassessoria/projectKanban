/**
 * GUARDA — Regras Documentais não tocam runtime (seção 13).
 * Rodar: tsx scripts/regras-documentais-guard.test.ts
 *
 * O entregável é cadastro/persistência/versionamento/avaliador/simulação. NÃO
 * pode gerar Documento/Necessidade/Tarefa, instanciar Workflow Interno, alterar
 * BlockingEngine/avanço de fase, nem reativar document-generator/reconcile.
 * Teste ESTÁTICO (source-scan).
 */
import { readFileSync, readdirSync, statSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join, relative } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
let passed = 0, failed = 0
const viol: string[] = []
function ok(cond: boolean, nome: string, det?: string) { if (cond) { passed++; console.log(`  ✅ ${nome}`) } else { failed++; viol.push(det ? `${nome} — ${det}` : nome); console.log(`  ❌ ${nome}${det ? ` — ${det}` : ""}`) } }
function walk(dir: string): string[] { const out: string[] = []; let e: string[] = []; try { e = readdirSync(dir) } catch { return out }; for (const n of e) { const p = join(dir, n); if (statSync(p).isDirectory()) out.push(...walk(p)); else if (/\.(ts|tsx)$/.test(n)) out.push(p) } return out }
const ler = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "")

// diretórios da feature
const DIRS = [
  join(ROOT, "src/lib/documentos/regras-documentais"),
  join(ROOT, "src/app/api/gerenciamento/regras-documentais"),
]
const arquivos = DIRS.flatMap(walk)

console.log("\n1) Nada de criação de Documento/Necessidade/Tarefa nem runtime")
const PROIBIDOS: RegExp[] = [
  /prisma\.documento\.create/, /\.documento\.createMany/,
  /prisma\.necessidadeDocumental\.create/, /necessidadeDocumental\.createMany/,
  /prisma\.tarefa\.create/, /criarTarefaDeSpec/,
  /reconcileDocsForPessoa/, /reconcileAllForArvore/, /\bDOCUMENT_RULES\b/,
  /phase-advance/, /PhaseAdvanceService/, /calcularPendencias/, /blocking-engine/,
  /executarMotorNaFase/, /dispararMotorNaFase/,
]
let violCount = 0
for (const f of arquivos) {
  const rel = relative(ROOT, f)
  const linhas = readFileSync(f, "utf8").split("\n")
  linhas.forEach((linha, i) => {
    const semComentario = linha.replace(/\/\/.*$/, "")
    for (const re of PROIBIDOS) if (re.test(semComentario)) { violCount++; ok(false, `padrão proibido ${re}`, `${rel}:${i + 1}`) }
  })
}
ok(violCount === 0, "nenhum padrão de runtime/criação nos arquivos de Regras Documentais")

console.log("\n2) O avaliador é puro (sem prisma)")
const avaliador = ler("src/lib/documentos/regras-documentais/avaliador.ts")
const conflitos = ler("src/lib/documentos/regras-documentais/conflitos.ts")
const condicoes = ler("src/lib/documentos/regras-documentais/condicoes.ts")
ok(!/from ["']@\/lib\/prisma["']/.test(avaliador) && !/prisma\./.test(avaliador), "avaliador.ts não importa/usa prisma")
ok(!/prisma\./.test(conflitos) && !/prisma\./.test(condicoes), "conflitos/condições não usam prisma")

console.log("\n3) Fonte única + navegação")
const page = ler("src/app/administrator/page.tsx")
ok(/docrules:\s*RegrasDocumentaisTab/.test(page), "docrules → RegrasDocumentaisTab (tela real, não placeholder)")
const nav = ler("src/components/gerenciamentoComponents/managementNavigation.tsx")
ok(/h\(30,\s*"docmatrix"/.test(nav), "Matriz Documental absorvida (docmatrix oculto)")
ok(/a\(40,\s*"docrules",\s*"Regras Documentais"/.test(nav), "Regras Documentais é item visível único de edição")

console.log("\n4) Genealogia permanece neutra (não reativada)")
const pessoasPost = ler("src/app/api/pessoas/route.ts").replace(/\/\/.*$/gm, "")
const pessoasPut = ler("src/app/api/pessoas/[id]/route.ts").replace(/\/\/.*$/gm, "")
ok(!/reconcileDocsForPessoa/.test(pessoasPost) && !/reconcileDocsForPessoa/.test(pessoasPut), "criar/editar Pessoa não reativou reconcile")

console.log(`\n${failed === 0 ? "✅" : "❌"} GUARDA REGRAS-DOCUMENTAIS-RUNTIME — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("\nViolações:"); for (const v of viol) console.log(`  · ${v}`); process.exit(1) }

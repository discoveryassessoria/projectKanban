/**
 * GUARDA — Abertura do modal da operação "localizar_registro" (Genealogia V2).
 * Rodar: tsx scripts/genealogia-abrir-operacao-guard.test.ts
 *
 * REGRESSÃO CORRIGIDA: ao clicar em "Abrir operação" o backdrop abria mas o
 * conteúdo não renderizava (tela travada). Causa: linhas da Genealogia V2 têm
 * docId = step.documentoId ?? 0 e a materialização NÃO cria Documento; o drawer
 * abre com id inválido (0) e o carregar() retorna cedo (if (!documentoId)).
 *
 * O modal (EditorRegistralModal) NÃO foi redesenhado — foi reutilizado. O fix é
 * o pipeline de dados: ao abrir uma necessidade V2 sem Documento, o front garante
 * o registro operacional via POST .../genealogia/operacao (idempotente) e abre com
 * o id real. Teste ESTÁTICO (source-scan).
 */
import { readFileSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
let passed = 0, failed = 0
const viol: string[] = []
function ok(c: boolean, n: string) { if (c) { passed++; console.log(`  ✅ ${n}`) } else { failed++; viol.push(n); console.log(`  ❌ ${n}`) } }
const ler = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "")

const endpoint = ler("src/app/api/processos/[processoId]/genealogia/operacao/route.ts")
const route = ler("src/app/api/processos/[processoId]/central-operacional/route.ts")
const central = ler("src/components/kanban/ProcessoCentralOperacional.tsx")
const painel = ler("src/components/kanban/PainelDaFase.tsx")

console.log("\n1) Endpoint garante o registro operacional da necessidade (idempotente)")
ok(existsSync(join(ROOT, "src/app/api/processos/[processoId]/genealogia/operacao/route.ts")), "endpoint genealogia/operacao existe")
ok(/verificarPermissao\(request, "processos\.editar"\)/.test(endpoint), "exige permissão processos.editar")
ok(/necessidadeDocumental\.findUnique/.test(endpoint) && /nec\.processoId !== procId/.test(endpoint), "valida a necessidade pertence ao processo")
ok(/documento\.findFirst\(\{ where: \{ necessidadeId: nec\.id \}/.test(endpoint), "reusa Documento existente da necessidade (idempotência)")
ok(/documento\.create/.test(endpoint) && /origem: "regra_documental"/.test(endpoint), "cria Documento (origem regra_documental) quando não há")
ok(/phaseWorkflowStepInstance\.updateMany\(\{[\s\S]*?stepKey: "localizar_registro"[\s\S]*?documentoId: null[\s\S]*?data: \{ documentoId: d\.id \}/.test(endpoint), "liga o passo localizar_registro (só se documentoId null) ao Documento")
ok(!/buscar_documento|buscar_certidao/.test(endpoint), "endpoint não referencia stepKeys legados")

console.log("\n2) Central Operacional expõe necessidadeId na fila V2")
ok(/necessidadeId: n\.id/.test(route), "queue V2 inclui necessidadeId")
ok(/necessidadeId\?: number \| null/.test(route), "QueueRow tipa necessidadeId")

console.log("\n3) Front garante o Documento antes de abrir o drawer (não abre com id 0)")
ok(/const abrirOperacao = useCallback/.test(central), "handler abrirOperacao existe")
ok(/if \(docId && docId > 0\) \{ setDrawerDocId\(docId\); return \}/.test(central), "docId>0 abre direto o drawer")
ok(/fetch\(`\/api\/processos\/\$\{processo\.id\}\/genealogia\/operacao`/.test(central), "necessidade sem Documento chama o endpoint")
ok(/setDrawerDocId\(json\.documentoId\)/.test(central), "abre o drawer com o documentoId retornado")
ok(/setErro\(json\?\.error \|\| "Não foi possível abrir a operação\."\)/.test(central), "erro real em vez de backdrop vazio")
ok(/necessidadeId: q\.necessidadeId \?\? null/.test(central), "mapearPainel propaga necessidadeId para a linha do doc")

console.log("\n4) Painel repassa necessidadeId no clique 'Abrir operação'")
ok(/onAbrirOperacao: \(docId: number, necessidadeId\?: number \| null\) => void/.test(painel), "assinatura onAbrirOperacao aceita necessidadeId")
ok(/onAbrirOperacao\(d\.id, d\.necessidadeId\)/.test(painel), "clique passa d.id + d.necessidadeId")
ok(/necessidadeId\?: number \| null/.test(painel), "FaseDocRow tipa necessidadeId")

console.log(`\n${failed === 0 ? "✅" : "❌"} GUARDA ABRIR-OPERAÇÃO — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("Falhas: " + viol.join("; ")); process.exit(1) }

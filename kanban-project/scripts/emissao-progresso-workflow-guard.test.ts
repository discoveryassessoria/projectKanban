/**
 * GUARDA — FONTE OFICIAL ÚNICA de progresso da fase (resolveProgressoFaseDocumento),
 * consumida por Central Operacional E cabeçalho (/phase). Sem cálculo duplicado.
 * Rodar: tsx scripts/emissao-progresso-workflow-guard.test.ts
 *
 * BUGS corrigidos (empilhados):
 *  1) matrix usava STATUS_VALIDADOS (RECEBIDO=validado) → falso 100%.
 *  2) workflowsRaw era [] hardcoded → faseProgress/matrix/próxima ação zerados.
 *  3) cabeçalho usava OUTRO endpoint (/phase → computePhaseProgress com workflows:[]) → 0/4.
 * FIX: uma única função lê PhaseWorkflowStepInstance da fase atual e computa done/total/
 * percent/counts/próxima ação; Central e cabeçalho consomem a MESMA função. Teste ESTÁTICO.
 */
import { readFileSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
let passed = 0, failed = 0
const viol: string[] = []
function ok(c: boolean, n: string) { if (c) { passed++; console.log(`  ✅ ${n}`) } else { failed++; viol.push(n); console.log(`  ❌ ${n}`) } }
const ler = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "")

const fn = ler("src/lib/process-stage/resolve-fase-progresso.ts")
const route = ler("src/app/api/processos/[processoId]/central-operacional/route.ts")
const phase = ler("src/app/api/processos/[processoId]/phase/route.ts")

console.log("\n1) Função oficial única lê as instâncias V2 reais da fase atual")
ok(/export async function resolveProgressoFaseDocumento/.test(fn), "resolveProgressoFaseDocumento existe")
ok(/phaseWorkflowStepInstance\.findMany\(\{[\s\S]*?processoId,[\s\S]*?faseMacroKey,[\s\S]*?status: \{ notIn: \["SUPERSEDIDO", "CANCELADO"\] \}/.test(fn), "consulta escopada a processo + fase atual, ignora inativos")
ok(/const ultima = steps\.reduce\(\(a, b\) => \(b\.ordem > a\.ordem \? b : a\)\)[\s\S]*?stepConcluidoRe\(ultima\.status\)/.test(fn), "conclusão = última etapa concluída (não status mestre)")
ok(/usuario\.findMany\(\{ where: \{ id: \{ in: respIds \}/.test(fn), "responsáveis em LOTE (sem N+1)")
ok(/maisRecente|melhor\.set/.test(fn), "dedup por (documento, stepKey) — sem duplicidade")

console.log("\n2) Central Operacional consome a função (sem cálculo paralelo)")
ok(/resolveProgressoFaseDocumento\(id\)/.test(route), "rota central chama resolveProgressoFaseDocumento")
ok(/percentage: prog\.percent/.test(route) && /completed: prog\.done/.test(route) && /total: prog\.total/.test(route), "matrix vem de prog (done/total/percent)")
ok(/counts: prog\.counts/.test(route) && /steps: prog\.faseSteps/.test(route), "faseProgress (counts/steps) vem de prog")
ok(/prog\.concluidosPorDoc\.has\(docId\)/.test(route), "conclusão por doc vem de prog")
ok(!/STATUS_VALIDADOS\.includes\(d\.status\)/.test(route), "matrix não usa mais STATUS_VALIDADOS")

console.log("\n3) Cabeçalho (/phase) consome a MESMA função — fim da fonte paralela")
ok(/resolveProgressoFaseDocumento\(processoId\)/.test(phase), "/phase chama resolveProgressoFaseDocumento")
ok(/done: prog\.done/.test(phase) && /total: prog\.total/.test(phase) && /percent: prog\.percent/.test(phase), "/phase retorna done/total/percent da função")
ok(!/computePhaseProgress/.test(phase), "/phase não usa mais computePhaseProgress (workflows:[] → 0/4)")

console.log(`\n${failed === 0 ? "✅" : "❌"} GUARDA PROGRESSO-WORKFLOW (fonte única) — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("Falhas: " + viol.join("; ")); process.exit(1) }

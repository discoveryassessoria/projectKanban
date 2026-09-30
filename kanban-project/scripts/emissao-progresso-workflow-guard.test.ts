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
// Regra atual (fix "todos os passos obrigatórios, não o último"): o documento concluiu a fase
// quando TODOS os passos obrigatórios dele estão feitos pela régua do motor — nunca pelo status
// mestre do Documento, nunca só pelo passo de maior ordem.
ok(/const concluiuDoc = \(docId: number\): boolean => \{[\s\S]*?obrigatorios\.every\(\(s\) => stepConcluidoRe\(s\.status\)\)/.test(fn) && !/const ultima = steps\.reduce/.test(fn) && !/STATUS_VALIDADOS/.test(fn), "conclusão = todos os passos obrigatórios concluídos (não status mestre, não só o último)")
ok(/usuario\.findMany\(\{ where: \{ id: \{ in: respIds \}/.test(fn), "responsáveis em LOTE (sem N+1)")
ok(/maisRecente|melhor\.set/.test(fn), "dedup por (documento, stepKey) — sem duplicidade")

console.log("\n2) Central Operacional consome a função (sem cálculo paralelo)")
ok(/resolveProgressoFaseDocumento\(id(,|\))/.test(route), "rota central chama resolveProgressoFaseDocumento")
ok(/percentage: prog\.percent/.test(route) && /completed: prog\.done/.test(route) && /total: prog\.total/.test(route), "matrix vem de prog (done/total/percent)")
ok(/counts: prog\.counts/.test(route) && /steps: prog\.faseSteps/.test(route), "faseProgress (counts/steps) vem de prog")
// Desde a unificação de 27/09/2026 a conclusão POR DOCUMENTO/PESSOA da matrix vem da fonte única de
// completude documental (resolverCompletudeDocumental) — a rota não recalcula por status de Documento.
ok(/resolverCompletudeDocumental\(id,/.test(route) && /byPerson: matrixByPersonUnificado/.test(route) && !/prog\.concluidosPorDoc/.test(route), "conclusão por doc vem da fonte única de completude (sem cálculo local)")
ok(!/STATUS_VALIDADOS\.includes\(d\.status\)/.test(route), "matrix não usa mais STATUS_VALIDADOS")

console.log("\n3) Cabeçalho (/phase) consome a fonte oficial — fim da fonte paralela")
// /phase migrou para o resolver canônico da projeção operacional (percent, com a blindagem do gate)
// + a fonte única de completude documental (done/total). Nenhum cálculo próprio de progresso.
ok(/resolveOperationalProjection\(processoId\)/.test(phase), "/phase chama resolveOperationalProjection (resolver canônico)")
ok(/resolverCompletudeDocumental\(processoId,/.test(phase) && /const done = completude\.completed/.test(phase) && /const total = completude\.required/.test(phase) && /const percent = projection\.progress\.percentage/.test(phase), "/phase retorna done/total da completude e percent da projeção")
ok(!/computePhaseProgress/.test(phase) && !/workflows:\s*\[\]/.test(phase), "/phase não usa mais computePhaseProgress (workflows:[] → 0/4)")

console.log(`\n${failed === 0 ? "✅" : "❌"} GUARDA PROGRESSO-WORKFLOW (fonte única) — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("Falhas: " + viol.join("; ")); process.exit(1) }

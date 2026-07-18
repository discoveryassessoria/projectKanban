/**
 * GUARDA — materialização AUTOMÁTICA e idempotente da operação da fase atual ao abrir
 * o documento (sem depender de "Iniciar operação"). Rodar:
 *   tsx scripts/operacao-materializacao-auto-guard.test.ts
 *
 * BUG: na Emissão, o drawer mostrava "Sem operação ativa / Iniciar operação" e o modal
 * abria a operação da Genealogia ("Buscar certidão"). Causa: o workflow só era criado
 * manualmente; ao abrir só se LIA (montarWorkflowV2) e, sem passos da fase atual, caía
 * no estado vazio.
 * FIX: GET /workflow chama garantirOperacaoDocumentoV2 → materializa idempotentemente
 * (upsert por chaveIdempotencia) os passos do catálogo da FASE ATUAL. Teste ESTÁTICO.
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
const route = ler("src/app/api/documentos/[id]/workflow/route.ts")
const wfTab = ler("src/components/kanban/workflow/WorkflowTab.tsx")

console.log("\n1) Serviço: materialização automática idempotente da fase atual")
ok(/export async function garantirOperacaoDocumentoV2/.test(svc), "garantirOperacaoDocumentoV2 existe")
ok(/const existente = await montarWorkflowV2\(documentoId\)[\s\S]*?if \(existente\) return \{ workflow: existente \}/.test(svc), "reusa a operação existente (idempotente, não recria)")
ok(/await iniciarOperacaoDocumentoV2\(documentoId\)/.test(svc), "materializa via a rotina oficial (upsert por chaveIdempotencia)")
ok(/r\.status === 409[\s\S]*?montarWorkflowV2\(documentoId\)/.test(svc), "corrida: 409 → re-lê e reusa (sem duplicar)")
ok(/return \{ workflow: null, semWorkflowInterno: true \}/.test(svc), "fase sem WF Interno → sinaliza (nunca workflow de outra fase)")

console.log("\n2) GET /workflow materializa ao abrir (fluxo normal não usa 'Iniciar operação')")
ok(/garantirOperacaoDocumentoV2\(documentoId\)/.test(route), "rota GET chama garantirOperacaoDocumentoV2")
ok(/semWorkflowInterno: semWorkflowInterno \?\? false/.test(route), "rota retorna o sinal semWorkflowInterno")

console.log("\n3) WorkflowTab: sem 'Iniciar operação' no fluxo normal; mensagem controlada")
ok(/setSemWorkflowInterno\(json\.semWorkflowInterno === true\)/.test(wfTab), "lê semWorkflowInterno da resposta")
ok(/Não existe Workflow Interno configurado para esta fase\./.test(wfTab), "mensagem controlada quando não há WF Interno")
ok(!/▸ Iniciar operação/.test(wfTab), "estado vazio não oferece mais 'Iniciar operação'")

console.log(`\n${failed === 0 ? "✅" : "❌"} GUARDA MATERIALIZAÇÃO-AUTO — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("Falhas: " + viol.join("; ")); process.exit(1) }

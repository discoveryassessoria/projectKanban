/**
 * Reconciliação legado → V2 (integrada ao backfill). Rodar: npm run test:reconciliacao
 * Puro (mapa) + estrutural (backfill é create-or-reconcile idempotente).
 */
import { mapLegacyStepStatus, mapLegacyWorkflowStatus } from "../src/lib/process-stage/legacy-status-map"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const src = (p: string) => readFileSync(join(ROOT, p), "utf8")

let passed = 0, failed = 0
const falhas: string[] = []
function ok(c: boolean, n: string) { if (c) { passed++; console.log(`  ✅ ${n}`) } else { failed++; falhas.push(n); console.log(`  ❌ ${n}`) } }

console.log("Reconciliação legado → V2 (espelhamento no backfill)\n")

// mapa de passo
ok(mapLegacyStepStatus("concluida") === "CONCLUIDO", "1. step concluida → CONCLUIDO")
ok(mapLegacyStepStatus("em_andamento") === "EM_ANDAMENTO", "2. step em_andamento → EM_ANDAMENTO")
ok(mapLegacyStepStatus("nao_iniciada") === "PENDENTE" && mapLegacyStepStatus(null) === "PENDENTE" && mapLegacyStepStatus("xpto") === "PENDENTE", "3. step desconhecido/nulo → PENDENTE (não marca falso concluído)")
ok(mapLegacyStepStatus("bloqueada") === "BLOQUEADO" && mapLegacyStepStatus("cancelado") === "CANCELADO", "3b. bloqueada→BLOQUEADO, cancelado→CANCELADO")

// mapa de instância
ok(mapLegacyWorkflowStatus("arquivado") === "CONCLUIDO", "4. workflow arquivado → CONCLUIDO (fase passada)")
ok(mapLegacyWorkflowStatus("em_andamento") === "ATIVO", "5. workflow em_andamento → ATIVO (fase corrente)")
ok(mapLegacyWorkflowStatus("cancelado") === "CANCELADO" && mapLegacyWorkflowStatus(null) === "ATIVO", "5b. cancelado→CANCELADO, default→ATIVO")

// backfill: create-or-reconcile idempotente com espelhamento
console.log("\nBackfill (integrado):")
const bf = src("prisma/backfill-cp4-workflow.ts")
ok(/mapLegacyStepStatus\(st\.status\)/.test(bf), "6. backfill espelha status do passo legado (mapLegacyStepStatus)")
ok(/mapLegacyWorkflowStatus\(wf\.status\)/.test(bf), "7. backfill espelha status da instância (mapLegacyWorkflowStatus)")
ok(/phaseWorkflowInstance\.upsert/.test(bf) && /phaseWorkflowStepInstance\.upsert/.test(bf), "8. usa upsert (create-or-reconcile idempotente)")
ok(/update:\s*\{\s*status:\s*instStatus\s*\}/.test(bf) && /update:\s*\{[^}]*status:\s*p\.status/.test(bf), "9. reexecutar RECONCILIA o status (update no upsert, instância e passo)")
ok(!/if \(jaExiste\)\s*\{\s*rel\.pulou\(\);\s*continue\s*\}/.test(bf), "10. removeu o skip que impedia reconciliar já-migrados")
ok(!/status:\s*"PENDENTE"\s*,\s*ciclo/.test(bf), "11. não grava mais PENDENTE fixo (status vem do legado)")

// CP-5 — camada operacional POR-DOCUMENTO (runtime único, sem model novo)
console.log("\nCP-5 (operação por-documento):")
ok(/montarChavePasso\(\{[^}]*documentoId\s*\}/.test(bf), "12. chave do passo inclui documentoId (distingue por documento)")
ok(/documentoId,\s*\/\/ ← camada operacional por-documento/.test(bf) || /create:\s*\{[^]*?documentoId,[^]*?\}/.test(bf), "13. passo criado com documentoId (operação por-documento)")
ok(/montarOperacaoMetadata\(st\)/.test(bf) && /\{\s*operacao:\s*p\.operacao\s*\}/.test(bf), "14. domínio vai para metadata.operacao (não vira coluna)")
ok(/responsavelId:\s*p\.responsavelId/.test(bf) && /prazo:\s*p\.prazo/.test(bf), "15. universais (responsável/prazo) viram campos do passo")
const modelV2 = (src("prisma/schema.prisma").match(/model PhaseWorkflowStepInstance \{[^]*?\n\}/) ?? [""])[0]
ok(modelV2.length > 0 && !/externalProtocol|reviewResult|validationResult|trackingCode|costPaid/.test(modelV2), "16. nenhuma coluna de domínio adicionada ao PhaseWorkflowStepInstance (só extensão via metadata)")

// CP-5 FASE 3 — consumidores leem/escrevem a operação por-documento V2 (runtime único)
console.log("\nCP-5 FASE 3 (consumidores V2 por-documento):")
const svc = src("src/services/documento-operacao.ts")
ok(/phaseWorkflowStepInstance\.findMany\(\{[^]*?documentoId/.test(svc), "17. serviço lê passos V2 por documentoId")
ok(/notIn:\s*INATIVOS/.test(svc) && /INATIVOS[^]*?"SUPERSEDIDO",\s*"CANCELADO"/.test(svc), "18. exclui passos SUPERSEDIDO/CANCELADO")
ok(/evaluateWorkflowProgress/.test(svc) && /resolveStepCompletionState/.test(svc), "19. reusa o completion-engine (não recalcula regra)")
ok(/mapLegacyStepStatus/.test(svc) && /phaseWorkflowStepInstance\.update/.test(svc), "20. sincronizarStatusPassoV2 espelha status legado→V2")
const ce = src("src/services/completion-engine/index.ts")
ok(/const v2 = await progressoOperacaoV2\(documentoId\)/.test(ce) && /return v2 \?\?/.test(ce) && !/prisma\.workflow\.findFirst/.test(ce), "21. completion-engine é V2-only (sem fallback legado)")
const stepRoute = src("src/app/api/documentos/[id]/workflow/steps/[stepId]/route.ts")
ok(/atualizarPassoV2\(documentoId, stepInstanceId/.test(stepRoute) && !/prisma\.workflowStep/.test(stepRoute), "22. steps PATCH opera no passo V2 (sem WorkflowStep legado)")

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
console.log("Reconciliação validada ✅")

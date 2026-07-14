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
ok(/update:\s*\{\s*status:\s*instStatus\s*\}/.test(bf) && /update:\s*\{\s*status:\s*stepStatus\s*\}/.test(bf), "9. reexecutar RECONCILIA o status (update no upsert)")
ok(!/if \(jaExiste\)\s*\{\s*rel\.pulou\(\);\s*continue\s*\}/.test(bf), "10. removeu o skip que impedia reconciliar já-migrados")
ok(!/status:\s*"PENDENTE"\s*,\s*ciclo/.test(bf), "11. não grava mais PENDENTE fixo (status vem do legado)")

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
console.log("Reconciliação validada ✅")

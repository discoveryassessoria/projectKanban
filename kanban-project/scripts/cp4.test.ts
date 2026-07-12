/**
 * CP-4A — testes estruturais (sem servidor/DB).
 * Rodar: npm run test:cp4
 */

import { readFileSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { resolveWorkflowRuntime, runtimeV2Ativo } from "../src/lib/workflow-runtime"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

function run() {
  console.log("CP-4A — testes estruturais\n")

  // 1) Feature flag (default legacy; v2 nunca automático)
  console.log("1) Feature flag / runtime:")
  ok(resolveWorkflowRuntime("v2", false) === "legacy", "kill switch global OFF => legacy mesmo com processo v2")
  ok(resolveWorkflowRuntime("v2", true) === "v2", "global ON + processo v2 => v2")
  ok(resolveWorkflowRuntime("legacy", true) === "legacy", "global ON + processo legacy => legacy")
  ok(resolveWorkflowRuntime(null, true) === "legacy", "global ON + processo indefinido => legacy")
  ok(resolveWorkflowRuntime(undefined, false) === "legacy", "default seguro => legacy")
  ok(runtimeV2Ativo("v2", false) === false, "v2 nunca ativo com kill switch OFF")

  // 2) Schema — models/relações/versionamento
  console.log("\n2) Schema:")
  const schema = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8")
  for (const m of ["PhaseWorkflowInstance", "PhaseWorkflowStepInstance", "WorkflowEvento", "DomainOutbox"]) {
    ok(new RegExp(`model ${m} \\{`).test(schema), `schema tem model ${m}`)
  }
  ok(/workflowRuntime\s+String\s+@default\("legacy"\)/.test(schema), "Processo.workflowRuntime default \"legacy\"")
  ok(/runtimeV2Habilitado\s+Boolean\s+@default\(false\)/.test(schema), "MotorConfig.runtimeV2Habilitado default false (kill switch)")
  ok((schema.match(/versao\s+Int\s+@default\(1\)/g) || []).length >= 4, "versionamento com default 1 (>=4 definições)")
  ok((schema.match(/chaveIdempotencia\s+String\s+@unique/g) || []).length >= 3, "chaveIdempotencia @unique (instância/passo/tarefa)")
  ok(/enum StatusTarefa \{[^}]*BLOQUEADA[^}]*SUPERSEDIDA/.test(schema), "StatusTarefa ampliado (BLOQUEADA, SUPERSEDIDA)")
  ok(/enum PassoTipo \{/.test(schema) && /enum WorkflowEventoTipo \{/.test(schema), "enums PassoTipo e WorkflowEventoTipo")

  // 3) Migration aditiva
  console.log("\n3) Migration CP-4A:")
  const mig = readFileSync(join(ROOT, "prisma/migrations/20260712120000_cp4a_workflow_runtime/migration.sql"), "utf8")
  ok(!/DROP\s+TABLE/i.test(mig), "não contém DROP TABLE")
  ok(!/DROP\s+COLUMN/i.test(mig), "não contém DROP COLUMN")
  ok(/CREATE TABLE "PhaseWorkflowInstance"/.test(mig), "cria PhaseWorkflowInstance")
  ok(/CREATE TABLE "PhaseWorkflowStepInstance"/.test(mig), "cria PhaseWorkflowStepInstance")
  ok(/CREATE TABLE "WorkflowEvento"/.test(mig), "cria WorkflowEvento")
  ok(/CREATE TABLE "DomainOutbox"/.test(mig), "cria DomainOutbox")
  ok(/ALTER TYPE "StatusTarefa" ADD VALUE 'BLOQUEADA'/.test(mig), "ADD VALUE StatusTarefa BLOQUEADA (aditivo)")
  ok(/"workflowRuntime" VARCHAR\(20\) NOT NULL DEFAULT 'legacy'/.test(mig), "workflowRuntime default legacy na migration")
  // FK de ligação sem NOT NULL prematuro
  ok(/"necessidadeId" INTEGER[,;]/.test(mig) && !/"necessidadeId" INTEGER NOT NULL/.test(mig), "necessidadeId nullable (sem NOT NULL prematuro)")
  ok(!/DEFAULT 'v2'/.test(mig) && !/runtimeV2Habilitado" BOOLEAN NOT NULL DEFAULT true/.test(mig), "nenhuma ativação automática de v2")

  // 4) Permissões workflow.* no catálogo
  console.log("\n4) Permissões (catálogo):")
  const perms = readFileSync(join(ROOT, "src/lib/permissoes.ts"), "utf8")
  for (const k of ["workflow.avancar", "workflow.forcarAvanco", "workflow.reabrirFase", "workflow.dispensarPasso", "workflow.concluirPasso", "workflow.aprovarPasso", "workflow.cancelarPasso"]) {
    ok(perms.includes(`'${k}'`), `catálogo tem ${k}`)
  }

  // 5) WorkflowEvento append-only (sem rota de mutação)
  console.log("\n5) WorkflowEvento append-only:")
  ok(!existsSync(join(ROOT, "src/app/api/workflow-eventos")), "não existe rota de mutação de WorkflowEvento")

  console.log(`\n${passed} passaram, ${failed} falharam`)
  if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
  console.log("CP-4A: todos os testes verdes ✅")
}

run()

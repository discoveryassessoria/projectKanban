/**
 * CP-4A + CP-4B — testes estruturais/unitários (sem servidor/DB).
 * Rodar: npm run test:cp4
 */

import { readFileSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { resolveWorkflowRuntime, runtimeV2Ativo } from "../src/lib/workflow-runtime"
import {
  montarChaveWorkflow, montarChavePasso, montarChaveEvento, mapearTipoPasso,
  estadoInicialPasso, ordenarStepsDeterministico, detectarCicloDependencia,
  dependenciasInvalidas, construirSnapshotWorkflow, construirSnapshotPasso,
  type DefStep,
} from "../src/services/phase-workflow-helpers"
import { validarDefinicao } from "../src/services/workflow-definition-validator"
import {
  montarChaveTarefa, mapearPrioridade, addDiasUteis, calcularPrazo,
  resolverResponsavel, passoGeraTarefa,
} from "../src/services/passo-tarefa-helpers"
import * as D from "../src/services/task-step-sync-helpers"
import * as B from "../src/lib/motor/blocking-helpers"

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

  // ============================================================
  // CP-4B — instanciação versionada
  // ============================================================
  console.log("\n--- CP-4B ---")

  // 6) Chaves de idempotência determinísticas
  console.log("6) Idempotência (chaves):")
  const bw = { processoId: 1, faseMacroId: 9, faseMacroKey: "GENEALOGIA", faseMacroVersion: 1, workflowDefinitionId: 5, workflowVersion: 2, ciclo: 1 }
  ok(montarChaveWorkflow(bw) === montarChaveWorkflow({ ...bw }), "chave workflow determinística")
  ok(montarChaveWorkflow(bw) !== montarChaveWorkflow({ ...bw, ciclo: 2 }), "ciclo distinto => chave distinta")
  ok(montarChaveWorkflow(bw) !== montarChaveWorkflow({ ...bw, workflowVersion: 3 }), "versão distinta => chave distinta")
  const bp = { workflowInstanceId: 7, stepDefinitionId: 3, stepKey: "solicitar", stepDefinitionVersion: 1, ciclo: 1 }
  ok(montarChavePasso(bp) === montarChavePasso({ ...bp }), "chave passo determinística")
  ok(montarChavePasso(bp) !== montarChavePasso({ ...bp, ciclo: 2 }), "passo: ciclo distinto => chave distinta")
  ok(montarChaveEvento({ correlationId: "c", tipo: "T", entityType: "e", entityId: 1, operationKey: "k" }) ===
     montarChaveEvento({ correlationId: "c", tipo: "T", entityType: "e", entityId: 1, operationKey: "k" }), "chave evento determinística")

  // 7) Tipo do passo (decisão 11)
  console.log("\n7) Tipo do passo:")
  ok(mapearTipoPasso({ tipo: "VALIDACAO", createsTask: true }).tipo === "VALIDACAO", "tipo explícito preservado")
  const inf = mapearTipoPasso({ createsTask: true })
  ok(inf.tipo === "HUMANO" && inf.warnings.some((w) => w.code === "PASSO_TIPO_INFERIDO"), "createsTask=true => HUMANO + warning")
  ok(mapearTipoPasso({ createsTask: false }).tipo === "AUTOMATICO", "createsTask=false => AUTOMATICO")
  ok(mapearTipoPasso({ tipo: "XPTO", createsTask: true }).error?.code === "CONFIGURACAO_TIPO_INVALIDA", "tipo inválido => CONFIGURACAO_TIPO_INVALIDA")

  // 8) Estado inicial + ordenação determinística
  console.log("\n8) Estado inicial e ordem:")
  ok(estadoInicialPasso(false) === "DISPONIVEL", "sem dependência => DISPONIVEL")
  ok(estadoInicialPasso(true) === "PENDENTE", "com dependência => PENDENTE")
  const ord = ordenarStepsDeterministico([{ ordem: 1, key: "b" }, { ordem: 1, key: "a" }, { ordem: 0, key: "z" }])
  ok(ord.map((s) => s.key).join(",") === "z,a,b", "ordem ASC, desempate stepKey ASC")

  // 9) Dependências e ciclo
  console.log("\n9) Dependências:")
  ok(detectarCicloDependencia([{ key: "a", dependeDeStepKeys: ["b"] }, { key: "b", dependeDeStepKeys: ["a"] }]) !== null, "detecta ciclo")
  ok(detectarCicloDependencia([{ key: "a", dependeDeStepKeys: [] }, { key: "b", dependeDeStepKeys: ["a"] }]) === null, "sem ciclo => null")
  ok(dependenciasInvalidas([{ key: "a", dependeDeStepKeys: ["x"] }]).length === 1, "dependência inexistente detectada")

  // 10) Validator
  console.log("\n10) Validator:")
  const wf = { id: 5, wfUid: "u", name: "W", phaseKey: "GENEALOGIA", tipoProcessoId: 1, versao: 1, active: true, arquivado: false }
  const stepOk: DefStep = { id: 1, key: "solicitar", label: "L", description: null, ordem: 0, createsTask: true, required: true, owner: null, priority: "medium", slaDays: 3, completionRule: null, checklist: null, versao: 1 }
  ok(validarDefinicao(wf, []).errors.some((e) => e.code === "WORKFLOW_SEM_PASSOS"), "workflow sem passos => WORKFLOW_SEM_PASSOS")
  ok(validarDefinicao(wf, [{ ...stepOk, key: "" }]).errors.some((e) => e.code === "STEP_SEM_KEY"), "step sem key => STEP_SEM_KEY")
  ok(validarDefinicao(wf, [stepOk, { ...stepOk, id: 2 }]).errors.some((e) => e.code === "STEP_KEY_DUPLICADA"), "stepKey duplicada => STEP_KEY_DUPLICADA")
  ok(validarDefinicao(wf, [{ ...stepOk, dependeDeStepKeys: ["nao-existe"] }]).errors.some((e) => e.code === "DEPENDENCIA_INVALIDA"), "dep inexistente => DEPENDENCIA_INVALIDA")
  ok(validarDefinicao(wf, [{ ...stepOk, key: "a", dependeDeStepKeys: ["b"] }, { ...stepOk, id: 2, key: "b", dependeDeStepKeys: ["a"] }]).errors.some((e) => e.code === "CICLO_DE_DEPENDENCIA"), "ciclo => CICLO_DE_DEPENDENCIA")
  ok(validarDefinicao({ ...wf, active: false }, [stepOk]).errors.some((e) => e.code === "SEM_VERSAO_ATIVA"), "inativo => SEM_VERSAO_ATIVA")
  const vok = validarDefinicao(wf, [stepOk])
  ok(vok.valid && vok.warnings.some((w) => w.code === "PASSO_TIPO_INFERIDO"), "definição válida => valid true + warning tipo inferido")

  // 11) Snapshot autocontido, versionado e imutável
  console.log("\n11) Snapshot:")
  const snapW = construirSnapshotWorkflow({ workflowDefinitionId: 5, workflowVersion: 1, name: "W", faseMacroId: 9, faseMacroKey: "GENEALOGIA", faseMacroVersion: 1, modoKey: null, tipoProcessoId: 1, instantiatedAt: "2026-07-12T00:00:00Z" })
  ok(snapW.snapshotSchemaVersion === 1, "snapshotSchemaVersion = 1 (workflow)")
  const defMut: DefStep = { ...stepOk }
  const snapS = construirSnapshotPasso(defMut, { tipo: "HUMANO", dependeDeStepKeys: [], instantiatedAt: "2026-07-12T00:00:00Z" })
  ok(snapS.snapshotSchemaVersion === 1 && snapS.stepKey === "solicitar" && snapS.tipo === "HUMANO", "snapshot passo autocontido (stepKey/tipo/versão)")
  defMut.label = "ALTERADO"
  ok(snapS.titulo === "L", "mudança posterior na definição NÃO altera o snapshot")

  // 12) Service (estrutural) — contrato, idempotência, sem tarefa/legado
  console.log("\n12) Service (estrutural):")
  const svc = readFileSync(join(ROOT, "src/services/phase-workflow.ts"), "utf8")
  ok(/export async function instanciarWorkflowDaFase/.test(svc), "exporta instanciarWorkflowDaFase")
  ok(/RUNTIME_V2_DESABILITADO/.test(svc) && /PROCESSO_LEGACY/.test(svc), "diagnósticos de runtime/flag")
  ok(/prisma\.\$transaction/.test(svc), "instanciação em transação única")
  ok(/findUnique\(\{ where: \{ chaveIdempotencia: chaveWorkflow \} \}\)/.test(svc) && /"P2002"/.test(svc), "idempotência: findUnique + P2002 convergem")
  ok(/status: "ATIVO"/.test(svc), "instância nasce ATIVO (decisão 8)")
  ok(!/\.tarefa\.create/.test(svc), "NÃO cria Tarefa no CP-4B")
  ok(!/workflowStep\.(create|update|delete)/.test(svc) && !/\bworkflow\.(create|update|delete)/.test(svc), "NÃO escreve no Workflow/WorkflowStep legado")
  const rota = readFileSync(join(ROOT, "src/app/api/processos/[processoId]/phase-workflow/instantiate/route.ts"), "utf8")
  ok(/verificarPermissao\(request, "workflow\.avancar"\)/.test(rota), "rota instantiate gated por workflow.avancar")

  // 13) Migration CP-4B aditiva
  console.log("\n13) Migration CP-4B:")
  const mig4b = readFileSync(join(ROOT, "prisma/migrations/20260712130000_cp4b_instance_identity_snapshot/migration.sql"), "utf8")
  ok(!/DROP\s+(TABLE|COLUMN)/i.test(mig4b), "sem DROP")
  ok(/ADD COLUMN\s+"faseMacroId" INTEGER/.test(mig4b), "adiciona faseMacroId")
  ok(/"snapshotSchemaVersion" INTEGER NOT NULL DEFAULT 1/.test(mig4b), "snapshotSchemaVersion default 1")
  ok(/ADD COLUMN\s+"causationId" VARCHAR\(60\)/.test(mig4b), "adiciona causationId")
  ok(/CREATE UNIQUE INDEX "WorkflowEvento_chaveIdempotencia_key"/.test(mig4b), "unique chaveIdempotencia em WorkflowEvento")

  // ============================================================
  // CP-4C — Passo humano → Tarefa real
  // ============================================================
  console.log("\n--- CP-4C ---")

  // 14) Chave da Tarefa + prioridade
  console.log("14) Chave e prioridade:")
  const bt = { stepInstanceId: 10, taskRole: "principal", ciclo: 1 }
  ok(montarChaveTarefa(bt) === montarChaveTarefa({ ...bt }), "chave Tarefa determinística")
  ok(montarChaveTarefa(bt) !== montarChaveTarefa({ ...bt, ciclo: 2 }), "ciclo distinto => chave distinta")
  ok(montarChaveTarefa(bt) !== montarChaveTarefa({ ...bt, taskRole: "revisor" }), "role distinto => chave distinta")
  ok(mapearPrioridade("low") === "BAIXA" && mapearPrioridade("medium") === "MEDIA" && mapearPrioridade("high") === "ALTA", "prioridade low/medium/high")
  ok(mapearPrioridade(undefined) === "MEDIA" && mapearPrioridade("xyz") === "MEDIA", "prioridade default MEDIA")

  // 15) Prazo por dias úteis
  console.log("\n15) Prazo (dias úteis):")
  ok(calcularPrazo(new Date("2026-07-17T12:00:00Z"), null) === null, "sem SLA => sem prazo")
  ok(calcularPrazo(new Date("2026-07-17T12:00:00Z"), 0) === null, "SLA 0 => sem prazo")
  const sexta = new Date("2026-07-17T12:00:00Z") // sexta-feira
  const mais1 = addDiasUteis(sexta, 1)
  ok(mais1.getUTCDay() !== 0 && mais1.getUTCDay() !== 6, "addDiasUteis pula fim de semana")
  ok(mais1.getTime() > sexta.getTime(), "prazo > base")

  // 16) Responsável (atribuição pendente)
  console.log("\n16) Responsável:")
  ok(resolverResponsavel({ responsavelId: 5 }).responsavelId === 5 && !resolverResponsavel({ responsavelId: 5 }).warning, "responsavelId explícito => sem warning")
  ok(resolverResponsavel({ papel: "analista" }).responsavelId === null && resolverResponsavel({ papel: "analista" }).warning?.code === "ATRIBUICAO_PENDENTE", "só papel => warning ATRIBUICAO_PENDENTE")
  ok(resolverResponsavel({}).warning?.code === "ATRIBUICAO_PENDENTE", "sem nada => warning")

  // 17) Regra normativa de geração
  console.log("\n17) Regra normativa:")
  ok(passoGeraTarefa({ tipo: "HUMANO", geraTarefa: true, status: "DISPONIVEL", aplicavel: true }).gera === true, "HUMANO+geraTarefa+DISPONIVEL+aplicável => gera")
  ok(passoGeraTarefa({ tipo: "AUTOMATICO", geraTarefa: true, status: "DISPONIVEL", aplicavel: true }).code === "PASSO_TIPO_NAO_HUMANO", "AUTOMATICO => não gera")
  ok(passoGeraTarefa({ tipo: "HUMANO", geraTarefa: false, status: "DISPONIVEL", aplicavel: true }).code === "PASSO_NAO_GERA_TAREFA", "geraTarefa=false => não gera")
  ok(passoGeraTarefa({ tipo: "HUMANO", geraTarefa: true, status: "PENDENTE", aplicavel: true }).code === "PASSO_ESTADO_INCOMPATIVEL", "status!=DISPONIVEL => não gera")
  ok(passoGeraTarefa({ tipo: "HUMANO", geraTarefa: true, status: "DISPONIVEL", aplicavel: false }).code === "PASSO_NAO_APLICAVEL", "não aplicável => não gera")

  // 18) Service (estrutural)
  console.log("\n18) Service (estrutural):")
  const svcT = readFileSync(join(ROOT, "src/services/passo-tarefa.ts"), "utf8")
  ok(/export async function garantirTarefaDePasso/.test(svcT), "exporta garantirTarefaDePasso")
  ok(/RUNTIME_V2_DESABILITADO/.test(svcT) && /PROCESSO_LEGACY/.test(svcT), "diagnósticos de runtime/flag")
  ok(/prisma\.\$transaction/.test(svcT), "criação em transação única")
  ok(/findFirst\(\{ where: \{ chaveIdempotencia: chaveTarefa \} \}\)/.test(svcT) && /"P2002"/.test(svcT), "idempotência findFirst + P2002")
  ok(/statusTarefa: "NAO_INICIADA"/.test(svcT), "Tarefa nasce NAO_INICIADA")
  ok(/"TAREFA_GERADA"/.test(svcT) && /domainOutbox\.create/.test(svcT), "evento TAREFA_GERADA + outbox na transação")
  ok(!/phaseWorkflowStepInstance\.update/.test(svcT), "NÃO altera o Passo (sem sincronização/conclusão)")
  ok(!/faseAtualKey/.test(svcT), "NÃO avança fase")
  const rotaT = readFileSync(join(ROOT, "src/app/api/workflow-step-instances/[id]/gerar-tarefa/route.ts"), "utf8")
  ok(/verificarPermissao\(request, "workflow\.gerarTarefa"\)/.test(rotaT), "rota gated por workflow.gerarTarefa (permissão específica)")
  const perms4c = readFileSync(join(ROOT, "src/lib/permissoes.ts"), "utf8")
  ok(perms4c.includes("'workflow.gerarTarefa'"), "catálogo tem workflow.gerarTarefa")

  // ============================================================
  // CP-4D — Sincronização Tarefa ↔ Passo
  // ============================================================
  console.log("\n--- CP-4D ---")

  // 19) Precedência de conflito
  console.log("19) Precedência (conflito):")
  ok(D.podeAplicarPasso("EM_ANDAMENTO", "CONCLUIDO") === true, "EM_ANDAMENTO → CONCLUIDO permitido")
  ok(D.podeAplicarPasso("CONCLUIDO", "EM_ANDAMENTO") === false, "CONCLUIDO → EM_ANDAMENTO proibido (terminal)")
  ok(D.podeAplicarPasso("CANCELADO", "CONCLUIDO") === false, "CANCELADO não é sobrescrito por CONCLUIDO")
  ok(D.podeAplicarPasso("CONCLUIDO", "SUPERSEDIDO") === true, "SUPERSEDIDO vence CONCLUIDO (nova rodada)")
  ok(D.podeAplicarPasso("EXECUTADO", "AGUARDANDO_APROVACAO") === true, "EXECUTADO → AGUARDANDO_APROVACAO (fluxo aprovação)")
  ok(D.podeAplicarPasso("AGUARDANDO_APROVACAO", "CONCLUIDO") === true, "AGUARDANDO_APROVACAO → CONCLUIDO (aprovação)")
  ok(D.podeAplicarPasso("BLOQUEADO", "DISPONIVEL") === true, "BLOQUEADO → DISPONIVEL (desbloqueio)")
  ok(D.podeAplicarTarefa("CANCELADA", "CONCLUIDO_RECEBIDO") === false, "Tarefa CANCELADA não vira CONCLUIDA")
  ok(D.ehTerminalPasso("CONCLUIDO") && !D.ehTerminalPasso("BLOQUEADO"), "bloqueio NÃO é terminal")

  // 20) Chaves idempotentes
  console.log("\n20) Chaves idempotentes:")
  ok(D.chaveComando("task-complete", "tarefa", 5, "CONCLUIDO_RECEBIDO", 1) === D.chaveComando("task-complete", "tarefa", 5, "CONCLUIDO_RECEBIDO", 1), "chaveComando determinística")
  ok(D.chaveComando("task-complete", "tarefa", 5, "X", 1) !== D.chaveComando("task-complete", "tarefa", 5, "X", 2), "ciclo distinto => chave distinta")
  ok(D.chaveEvento("PASSO_CONCLUIDO", "step_instance", 3, "CONCLUIDO", 1).startsWith("evt|PASSO_CONCLUIDO|"), "chaveEvento formada")

  // 21) Política de cancelamento
  console.log("\n21) Política de cancelamento:")
  ok(D.destinoCancelamentoTarefa("REFAZER").passoAlvo === "DISPONIVEL", "REFAZER => Passo DISPONIVEL")
  ok(D.destinoCancelamentoTarefa("INVALIDO").passoAlvo === "BLOQUEADO", "INVALIDO => Passo BLOQUEADO")
  ok(D.destinoCancelamentoTarefa("SUPERSESSAO").tarefaAlvo === "SUPERSEDIDA" && D.destinoCancelamentoTarefa("SUPERSESSAO").passoAlvo === "SUPERSEDIDO", "SUPERSESSAO => ambos SUPERSEDIDO")
  ok(D.destinoCancelamentoTarefa("ADMINISTRATIVO").passoAlvo === null, "ADMINISTRATIVO => não infere estado do Passo")

  // 22) Restauração de bloqueio
  console.log("\n22) Restauração:")
  ok(D.restaurarStatusPasso("EM_ANDAMENTO") === "EM_ANDAMENTO", "restaura Passo ao estado anterior válido")
  ok(D.restaurarStatusPasso("CONCLUIDO") === "DISPONIVEL", "estado inválido => DISPONIVEL")
  ok(D.restaurarStatusTarefa(null) === "NAO_INICIADA", "restaura Tarefa default NAO_INICIADA")

  // 23) Service (estrutural) — CAS, sem loop, sem legado, sem fase
  console.log("\n23) Service (estrutural):")
  const svcS = readFileSync(join(ROOT, "src/services/task-step-sync.ts"), "utf8")
  ok(/updateMany\(/.test(svcS) && /lockVersion: \{ increment: 1 \}/.test(svcS), "CAS: updateMany + lockVersion increment")
  ok(/lockVersion: step\.lockVersion/.test(svcS) && /lockVersion: t\.lockVersion/.test(svcS), "CAS condicionado ao lockVersion lido")
  ok(/"P2002"/.test(svcS) && /convergirOuThrow/.test(svcS), "P2002 => convergência idempotente")
  ok(/if \(step\.status === alvo\) return/.test(svcS) && /if \(t\.statusTarefa === alvo\) return/.test(svcS), "no-op quando já no alvo")
  // ausência de loop: appliers não chamam operações públicas nem entre si
  const bodyConcluirTarefa = svcS.slice(svcS.indexOf("export async function concluirTarefa"), svcS.indexOf("export async function bloquearTarefa"))
  ok(!/concluirPasso\(/.test(bodyConcluirTarefa), "concluirTarefa NÃO chama concluirPasso (sem loop)")
  const bodyConcluirPasso = svcS.slice(svcS.indexOf("export async function concluirPasso"), svcS.indexOf("export async function aprovarPasso"))
  ok(!/concluirTarefa\(/.test(bodyConcluirPasso), "concluirPasso NÃO chama concluirTarefa (sem loop)")
  ok(!/faseAtualKey/.test(svcS), "NÃO avança fase")
  ok(!/workflowStep\.(create|update|updateMany|delete)/.test(svcS), "NÃO escreve no WorkflowStep legado")
  ok(/step\.status !== "AGUARDANDO_APROVACAO"/.test(svcS) && /SEGREGACAO_VIOLADA/.test(svcS), "aprovarPasso: exige AGUARDANDO_APROVACAO + segregação executor≠aprovador")

  // 24) Delegação nas rotas legadas (só v2 + step instance)
  console.log("\n24) Delegação legada:")
  const rotaConcluir = readFileSync(join(ROOT, "src/app/api/tarefas/[tarefaId]/concluir/route.ts"), "utf8")
  ok(/workflowStepInstanceId && tarefaAtual\.processoId/.test(rotaConcluir) && /workflowRuntime === "v2"/.test(rotaConcluir) && /concluirTarefa\(/.test(rotaConcluir), "concluir delega ao sync só se v2 + step instance")

  // 25) Migration CP-4D aditiva
  console.log("\n25) Migration CP-4D:")
  const mig4d = readFileSync(join(ROOT, "prisma/migrations/20260712140000_cp4d_sync_lock_events/migration.sql"), "utf8")
  ok(!/DROP\s+(TABLE|COLUMN)/i.test(mig4d), "sem DROP")
  ok(/ALTER TYPE "StatusTarefa" ADD VALUE 'CANCELADA'/.test(mig4d), "StatusTarefa +CANCELADA")
  ok(/ADD VALUE 'PASSO_AGUARDANDO_APROVACAO'/.test(mig4d) && /ADD VALUE 'TAREFA_INICIADA'/.test(mig4d), "novos eventos aditivos")
  ok(/"lockVersion" INTEGER NOT NULL DEFAULT 0/.test(mig4d), "Tarefa.lockVersion default 0")
  const perms4d = readFileSync(join(ROOT, "src/lib/permissoes.ts"), "utf8")
  ok(perms4d.includes("'workflow.iniciarPasso'") && perms4d.includes("'workflow.supersederPasso'") && perms4d.includes("'tarefas.bloquear'"), "permissões CP-4D no catálogo")

  // ============================================================
  // CP-4E — Motor de Pendências e simulação
  // ============================================================
  console.log("\n--- CP-4E ---")

  // 26) NecessidadeDocumental (por fase)
  console.log("26) Necessidades:")
  ok(B.classificarNecessidade("PENDENTE", true, true, 1) === null, "Genealogia: necessidade existente não bloqueia (não exige atendida)")
  ok(B.classificarNecessidade("NAO_LOCALIZADA", true, false, 1)?.code === "DOCUMENTO_NAO_LOCALIZADO", "Emissão: NAO_LOCALIZADA => DOCUMENTO_NAO_LOCALIZADO")
  ok(B.classificarNecessidade("PENDENTE", true, false, 1)?.severity === "BLOCKING", "Emissão: obrigatória pendente => BLOCKING")
  ok(B.classificarNecessidade("ATENDIDA", true, false, 1) === null, "Emissão: ATENDIDA não bloqueia")
  ok(B.classificarNecessidade("PENDENTE", false, false, 1)?.severity === "WARNING", "opcional pendente => WARNING")

  // 27) Passos
  console.log("\n27) Passos:")
  ok(B.classificarPasso("CONCLUIDO", true, "s", 1) === null && B.classificarPasso("DISPENSADO", true, "s", 1) === null && B.classificarPasso("SUPERSEDIDO", true, "s", 1) === null, "CONCLUIDO/DISPENSADO/SUPERSEDIDO não bloqueiam")
  ok(B.classificarPasso("AGUARDANDO_APROVACAO", true, "s", 1)?.code === "PASSO_AGUARDANDO_APROVACAO", "AGUARDANDO_APROVACAO bloqueia")
  ok(B.classificarPasso("BLOQUEADO", true, "s", 1)?.code === "PASSO_BLOQUEADO", "BLOQUEADO bloqueia")
  ok(B.classificarPasso("FALHOU", true, "s", 1)?.code === "PASSO_FALHOU", "FALHOU bloqueia")
  ok(B.classificarPasso("DISPONIVEL", true, "s", 1)?.severity === "BLOCKING", "obrigatório aberto bloqueia")
  ok(B.classificarPasso("DISPONIVEL", false, "s", 1)?.severity === "WARNING", "opcional aberto => WARNING")

  // 28) Tarefas
  console.log("\n28) Tarefas:")
  ok(B.classificarTarefa("CONCLUIDO_RECEBIDO", true, true, false, 1).length === 0, "concluída não bloqueia")
  ok(B.classificarTarefa("EM_ANDAMENTO", true, true, false, 1).some((i) => i.code === "TAREFA_OBRIGATORIA_ABERTA" && i.severity === "BLOCKING"), "obrigatória aberta bloqueia")
  ok(B.classificarTarefa("EM_ANDAMENTO", false, true, false, 1).some((i) => i.severity === "WARNING"), "opcional aberta => WARNING")
  ok(B.classificarTarefa("CANCELADA", true, true, false, 1).length === 0, "CANCELADA não bloqueia por si (avaliada pelo Passo)")
  ok(B.classificarTarefa("EM_ANDAMENTO", true, false, true, 1).some((i) => i.code === "TAREFA_SEM_RESPONSAVEL" && i.severity === "BLOCKING"), "sem responsável + exige => BLOCKING")
  ok(B.classificarTarefa("EM_ANDAMENTO", true, false, false, 1).some((i) => i.code === "TAREFA_SEM_RESPONSAVEL" && i.severity === "WARNING"), "sem responsável default => WARNING")

  // 29) Transversal + política
  console.log("\n29) Transversal + política:")
  ok(B.classificarTransversal(true, true, true, 1)?.category === "TAREFA_TRANSVERSAL", "transversal aplicável+obrigatória+aberta bloqueia")
  ok(B.classificarTransversal(false, true, true, 1) === null && B.classificarTransversal(true, false, true, 1) === null, "transversal não aplicável/opcional => não bloqueia")
  ok(B.avaliarPolitica([{ code: "x", category: "PASSO", severity: "BLOCKING", message: "" }]) === false, "ALL_REQUIRED_COMPLETED: BLOCKING impede avanço")
  ok(B.avaliarPolitica([{ code: "x", category: "PASSO", severity: "WARNING", message: "" }]) === true, "só WARNING => pode avançar")
  // determinismo
  ok(JSON.stringify(B.classificarPasso("BLOQUEADO", true, "s", 1)) === JSON.stringify(B.classificarPasso("BLOQUEADO", true, "s", 1)), "classificação determinística")

  // 30) Engine + simulação (estrutural, somente leitura)
  console.log("\n30) Engine/simulação (somente leitura):")
  const eng = readFileSync(join(ROOT, "src/lib/motor/blocking-engine.ts"), "utf8")
  ok(!/\.(create|update|updateMany|delete|deleteMany|upsert)\(/.test(eng) && !/\$transaction/.test(eng), "blocking-engine NÃO escreve (só findMany/findUnique/count)")
  ok(!/faseAtualKey:/.test(eng), "engine não altera faseAtualKey")
  const sim = readFileSync(join(ROOT, "src/lib/motor/phase-simulation.ts"), "utf8")
  ok(!/\.(create|update|updateMany|delete|deleteMany|upsert)\(/.test(sim) && !/\$transaction/.test(sim), "phase-simulation NÃO escreve (sem create/update/outbox)")
  ok(!/workflowEvento\.create|domainOutbox\.create/.test(sim), "simulação sem WorkflowEvento/DomainOutbox (decisão: 100% sem escrita)")
  ok(/RUNTIME_V2_DESABILITADO/.test(sim) && /PROCESSO_LEGACY/.test(sim), "kill switch/legacy => diagnóstico claro")
  ok(/tarefasPrevistas/.test(sim) && /stepKeys/.test(sim), "preview de próximos passos/tarefas")
  ok(!/tarefa\.create|\.tarefa\.create/.test(sim), "simulação não cria Tarefa")
  const rotaPend = readFileSync(join(ROOT, "src/app/api/processos/[processoId]/pendencias/route.ts"), "utf8")
  const rotaSim = readFileSync(join(ROOT, "src/app/api/processos/[processoId]/advance/simulate/route.ts"), "utf8")
  ok(/verificarPermissao\(request, "workflow\.avancar"\)/.test(rotaPend) && /verificarPermissao\(request, "workflow\.avancar"\)/.test(rotaSim), "rotas gated por workflow.avancar")

  console.log(`\n${passed} passaram, ${failed} falharam`)
  if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
  console.log("CP-4 (A+B+C+D+E): todos os testes verdes ✅")
}

run()

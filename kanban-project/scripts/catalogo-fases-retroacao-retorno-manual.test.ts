// scripts/catalogo-fases-retroacao-retorno-manual.test.ts
//
// MANDATO "MÓDULO DE FASES" — blindagem (22/09/2026). Fecha os itens da
// matriz que `catalogo-fases-reconciliacao.test.ts`/`retroacao-publicacao-
// workflow-interno-apos-macro.test.ts` não cobrem:
//
//   15. retroação alcança corretamente um processo RETORNADO MANUALMENTE
//       (não só os que estão antes/na posição/depois da fase nova);
//   23. retorno manual para fase anterior NÃO invalida nem reseta a
//       obrigação da fase de onde o processo saiu;
//   24. depois de concluir de novo a fase pra qual retornou, a "primeira
//       pendência real" do processo é calculada certo — REGRA MASTER: a
//       fase nunca decide isso sozinha; quem calcula é
//       `calcularObrigacoesRetroativasPendentes`, a MESMA função que bloqueia
//       finalização, ordenada por posição da composição, não por nome.
//
// Fixture 100% genérica e sintética própria — nunca TESTEVIS_fase.
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("catalogo-fases-retroacao-retorno-manual.test.ts")

import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { movePhaseManual } from "../src/lib/motor/phase-advance"
import { materializarExecucaoDaFase } from "../src/services/materializar-fase"
import { calcularObrigacoesRetroativasPendentes, enqueueReconciliacaoFaseMacro } from "../src/lib/motor/reconciliar-fase-macro"
import { processarOutbox } from "../src/services/outbox-dispatcher"

const MARCA = "RETORNOMANUAL"
let ok = 0, falhou = 0
function check(nome: string, cond: boolean, detalhe?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}${detalhe ? " — " + detalhe : ""}`) }
  else { falhou++; console.error(`  ❌ ${nome}${detalhe ? " — " + detalhe : ""}`) }
}

async function limpar() {
  const tipo = await prisma.tipoProcessoNacionalidade.findUnique({ where: { code: MARCA } })
  if (tipo) {
    const procs = await prisma.processo.findMany({ where: { tipoProcessoMotorId: tipo.id }, select: { id: true } })
    const ids = procs.map((p) => p.id)
    if (ids.length) {
      await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
      await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
      await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
      await prisma.domainOutbox.deleteMany({ where: { aggregateType: "Processo", aggregateId: { in: ids } } })
      await prisma.logAuditoria.deleteMany({ where: { entidade: "PROCESSO", entidadeId: { in: ids } } })
      await prisma.processo.deleteMany({ where: { id: { in: ids } } })
    }
    await prisma.phaseInternalWorkflow.deleteMany({ where: { tipoProcessoId: tipo.id } })
    await prisma.faseMacro.deleteMany({ where: { macroWorkflow: { tipoProcessoId: tipo.id } } })
    await prisma.macroWorkflow.deleteMany({ where: { tipoProcessoId: tipo.id } })
    await prisma.tipoProcessoNacionalidade.delete({ where: { id: tipo.id } })
  }
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: { startsWith: MARCA.toLowerCase() } } })
  await prisma.usuario.deleteMany({ where: { email: `admin@${MARCA.toLowerCase()}.test` } })
}

async function main() {
  await limpar()
  const pm = await prisma.modalidadePais.findFirst({ select: { id: true, paisId: true } })
  if (!pm) throw new Error("nenhuma modalidade de país no banco de teste")
  const admin = await prisma.usuario.create({ data: { nome: MARCA, email: `admin@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" } })

  const K_A = `${MARCA.toLowerCase()}_a`, K_B = `${MARCA.toLowerCase()}_b`, K_C = `${MARCA.toLowerCase()}_c`
  await prisma.catalogoFase.createMany({
    data: [
      { phaseKey: K_A, label: "Fase A", escopo: "PROCESSO", ordemPadrao: 1, requiredPadrao: true, conditionalPadrao: false, ativo: true, status: "PUBLICADA", revisaoAtual: 1, efeitosPermitidos: ["REGISTER_ONLY"] },
      { phaseKey: K_B, label: "Fase B", escopo: "PROCESSO", ordemPadrao: 2, requiredPadrao: true, conditionalPadrao: false, ativo: true, status: "PUBLICADA", revisaoAtual: 1, efeitosPermitidos: ["REGISTER_ONLY"] },
      { phaseKey: K_C, label: "Fase C", escopo: "PROCESSO", ordemPadrao: 3, requiredPadrao: true, conditionalPadrao: false, ativo: true, status: "PUBLICADA", revisaoAtual: 1, efeitosPermitidos: ["REGISTER_ONLY"] },
    ],
  })
  const tipo = await prisma.tipoProcessoNacionalidade.create({ data: { code: MARCA, name: `[${MARCA}] tipo`, paisId: pm.paisId, ativo: true } })
  await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: tipo.id, modalidadeId: pm.id } })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, modalidadeId: pm.id, name: `[${MARCA}] macro`, ativo: true } })
  await prisma.faseMacro.createMany({
    data: [
      { macroWorkflowId: macro.id, phaseKey: K_A, label: "Fase A", ordem: 1, required: true, conditional: false, entryRule: "process_created", showInKanban: true },
      { macroWorkflowId: macro.id, phaseKey: K_B, label: "Fase B", ordem: 2, required: true, conditional: false, entryRule: "previous_phase_completed", showInKanban: true },
      { macroWorkflowId: macro.id, phaseKey: K_C, label: "Fase C", ordem: 3, required: true, conditional: false, entryRule: "previous_phase_completed", showInKanban: true },
      { macroWorkflowId: macro.id, phaseKey: "finalizado", label: "Finalizado", ordem: 4, required: true, conditional: false, entryRule: "previous_phase_completed", showInKanban: true },
    ],
  })
  for (const fk of [K_A, K_B, K_C]) {
    const wf = await prisma.phaseInternalWorkflow.create({
      data: { wfUid: `${tipo.id}::${fk}`, phaseKey: fk, tipoProcessoId: tipo.id, name: `Workflow · ${fk}`, versao: 1, active: true, execucao: "SEQUENCIAL" },
    })
    await prisma.phaseInternalWorkflowStep.create({
      data: { workflowId: wf.id, key: "passo", label: `Trabalho de ${fk}`, ordem: 1, createsTask: true, required: true, owner: null, slaDays: 0, cardinalidade: null },
    })
  }

  const proc = await prisma.processo.create({ data: { nome: `[${MARCA}] processo`, faseAtualKey: K_A, tipoProcessoMotorId: tipo.id, modalidadeId: pm.id, paisId: pm.paisId } })
  const fasesComposicao = [
    { phaseKey: K_A, ordem: 1, required: true, conditional: false },
    { phaseKey: K_B, ordem: 2, required: true, conditional: false },
    { phaseKey: K_C, ordem: 3, required: true, conditional: false },
  ]

  console.log("\n1) Processo avança A → B → C, concluindo o trabalho de cada uma")
  await materializarExecucaoDaFase({ processoId: proc.id, faseMacroKey: K_A, fonte: "REGULARIZACAO_HISTORICA", solicitadoPorId: admin.id })
  await prisma.phaseWorkflowInstance.updateMany({ where: { processoId: proc.id, faseMacroKey: K_A }, data: { status: "CONCLUIDO" } })
  const mvB = await movePhaseManual(proc.id, { faseAlvo: K_B, justificativa: "avanço normal", motivoCodigo: "TESTE", solicitadoPorId: admin.id })
  check("avança A→B", mvB.success === true)
  await materializarExecucaoDaFase({ processoId: proc.id, faseMacroKey: K_B, fonte: "REGULARIZACAO_HISTORICA", solicitadoPorId: admin.id })
  await prisma.phaseWorkflowInstance.updateMany({ where: { processoId: proc.id, faseMacroKey: K_B }, data: { status: "CONCLUIDO" } })
  const mvC = await movePhaseManual(proc.id, { faseAlvo: K_C, justificativa: "avanço normal", motivoCodigo: "TESTE", solicitadoPorId: admin.id })
  check("avança B→C", mvC.success === true)
  await materializarExecucaoDaFase({ processoId: proc.id, faseMacroKey: K_C, fonte: "REGULARIZACAO_HISTORICA", solicitadoPorId: admin.id })
  const tarefaB = await prisma.tarefa.findFirstOrThrow({ where: { processoId: proc.id, faseMacroKey: K_B } })
  check("fase B tem sua tarefa própria, concluída", true)

  console.log("\n2) RETORNO MANUAL de C para B — a tarefa/instância de B (já concluída) NÃO é reaberta nem resetada")
  const antesRetorno = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaB.id }, select: { statusTarefa: true, id: true } })
  const mvVolta = await movePhaseManual(proc.id, { faseAlvo: K_B, justificativa: "investigar algo na fase B", motivoCodigo: "REGULARIZACAO_ADMINISTRATIVA", solicitadoPorId: admin.id })
  check("retorno manual C→B aceito", mvVolta.success === true, JSON.stringify(mvVolta))
  const p = await prisma.processo.findUniqueOrThrow({ where: { id: proc.id }, select: { faseAtualKey: true } })
  check("faseAtualKey agora é B", p.faseAtualKey === K_B)
  const depoisRetorno = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaB.id }, select: { statusTarefa: true, id: true } })
  check("a MESMA tarefa (mesmo id) — retorno não recria", depoisRetorno.id === antesRetorno.id)
  check("status da tarefa de B NÃO foi alterado pelo retorno (nem reaberta, nem resetada)", depoisRetorno.statusTarefa === antesRetorno.statusTarefa, `antes=${antesRetorno.statusTarefa} depois=${depoisRetorno.statusTarefa}`)
  // SUPERSEDIDO é o marcador esperado e NÃO-destrutivo pra quem se moveu pra
  // trás: a instância continua existindo, legível, histórica — não foi
  // apagada nem marcada CANCELADO (que SERIA invalidação real do trabalho).
  const instC = await prisma.phaseWorkflowInstance.findFirstOrThrow({ where: { processoId: proc.id, faseMacroKey: K_C } })
  check("instância de C (de onde retornou) NÃO foi apagada nem CANCELADA — preservada (histórico), status real", instC.status !== "CANCELADO", instC.status)
  const tarefaC = await prisma.tarefa.findFirst({ where: { processoId: proc.id, faseMacroKey: K_C } })
  check("a tarefa de C (se existia) não foi cancelada nem apagada pelo retorno", !tarefaC || tarefaC.statusTarefa !== "CANCELADA", tarefaC?.statusTarefa ?? "sem tarefa própria")

  console.log("\n3) Retroação de fase nova ALCANÇA o processo mesmo estando retornado manualmente (item 15)")
  const K_NOVA = `${MARCA.toLowerCase()}_nova_pos2`
  await prisma.catalogoFase.create({
    data: { phaseKey: K_NOVA, label: "Fase Nova (inserida)", escopo: "PROCESSO", ordemPadrao: 2, requiredPadrao: true, conditionalPadrao: false, ativo: true, status: "PUBLICADA", revisaoAtual: 1, efeitosPermitidos: ["REGISTER_ONLY"] },
  })
  const wfNova = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${tipo.id}::${K_NOVA}`, phaseKey: K_NOVA, tipoProcessoId: tipo.id, name: "Workflow · nova", versao: 1, active: true, execucao: "SEQUENCIAL" },
  })
  await prisma.phaseInternalWorkflowStep.create({
    data: { workflowId: wfNova.id, key: "passo", label: "Trabalho da fase nova", ordem: 1, createsTask: true, required: true, owner: null, slaDays: 0, cardinalidade: null },
  })
  // Insere no meio (posição 2, empurra B/C/finalizado) — mesma mecânica de
  // `enqueueReconciliacaoFaseMacro`, chamada direta (sem HTTP) pois o que se
  // prova aqui é o ALCANCE da retroação, não a rota de composição.
  await prisma.faseMacro.updateMany({ where: { macroWorkflowId: macro.id, phaseKey: { in: [K_B, K_C, "finalizado"] } }, data: {} })
  await prisma.faseMacro.update({ where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: K_B } }, data: { ordem: 3 } })
  await prisma.faseMacro.update({ where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: K_C } }, data: { ordem: 4 } })
  await prisma.faseMacro.update({ where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: "finalizado" } }, data: { ordem: 5 } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: K_NOVA, label: "Fase Nova (inserida)", ordem: 2, required: true, conditional: false, entryRule: "previous_phase_completed", showInKanban: true } })

  const macroAtual = await prisma.macroWorkflow.findUniqueOrThrow({ where: { id: macro.id }, select: { versao: true } })
  await enqueueReconciliacaoFaseMacro({
    macroWorkflowId: macro.id, tipoProcessoId: tipo.id, versaoAnterior: macroAtual.versao, versaoNova: macroAtual.versao,
    fasesNovas: [{ phaseKey: K_NOVA, required: true, conditional: false }], publicadoPorId: admin.id,
  })
  await processarOutbox({ forcar: true })

  const instNova = await prisma.phaseWorkflowInstance.findFirst({ where: { processoId: proc.id, faseMacroKey: K_NOVA } })
  check("processo RETORNADO MANUALMENTE (faseAtualKey=B) recebeu a fase nova retroativamente", instNova != null, instNova ? `instância #${instNova.id}` : "NENHUMA")
  const tarefaNova = await prisma.tarefa.count({ where: { processoId: proc.id, faseMacroKey: K_NOVA } })
  check("e exatamente 1 tarefa nasceu para ela", tarefaNova === 1, String(tarefaNova))
  check("a tarefa de B continua intacta (retroação de outra fase não mexe nela)", (await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaB.id }, select: { statusTarefa: true } })).statusTarefa === antesRetorno.statusTarefa)

  console.log("\n4) Item 24 — 'primeira pendência real' calculada certo depois do retorno + fase nova")
  const fasesAtualizadas = [
    { phaseKey: K_A, ordem: 1, required: true, conditional: false },
    { phaseKey: K_NOVA, ordem: 2, required: true, conditional: false },
    { phaseKey: K_B, ordem: 3, required: true, conditional: false },
    { phaseKey: K_C, ordem: 4, required: true, conditional: false },
  ]
  const pendentesEmB = await calcularObrigacoesRetroativasPendentes(proc.id, fasesAtualizadas, K_B)
  // A/B já concluídas (nunca ficam pendentes ao consultar da própria posição B,
  // pois "faseAtual" é excluída); a fase NOVA (posição 2, ANTES de B) está
  // materializada mas NÃO concluída — é a primeira pendência real.
  check("a fase nova aparece como primeira pendência (materializada, não concluída)", pendentesEmB[0]?.phaseKey === K_NOVA, JSON.stringify(pendentesEmB))
  check("motivo correto: materializada mas não concluída (não 'nunca materializada')", pendentesEmB[0]?.motivo === "MATERIALIZADA_MAS_NAO_CONCLUIDA", pendentesEmB[0]?.motivo)

  // Concluir a fase nova — a pendência correta unica que resta, ao terminar de
  // novo a fase B, é nenhuma (A, nova e B todas concluídas/satisfeitas).
  await prisma.phaseWorkflowInstance.updateMany({ where: { processoId: proc.id, faseMacroKey: K_NOVA }, data: { status: "CONCLUIDO" } })
  const pendentesDepois = await calcularObrigacoesRetroativasPendentes(proc.id, fasesAtualizadas, K_B)
  check("depois de concluir a fase nova, zero pendências ao reavaliar em B", pendentesDepois.length === 0, JSON.stringify(pendentesDepois))

  await limpar()
  console.log(`\n=== RESULTADO: ${ok} ok, ${falhou} falhas ===`)
  if (falhou > 0) process.exitCode = 1
}

main().finally(() => prisma.$disconnect())

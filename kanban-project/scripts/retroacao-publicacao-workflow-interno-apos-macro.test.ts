// scripts/retroacao-publicacao-workflow-interno-apos-macro.test.ts
//
// MANDATO "MÓDULO DE FASES" (21/09/2026), DEFEITO 1 — "RETROAÇÃO NÃO
// DISPARADA". Cenário: uma fase é inserida na composição do Workflow Macro
// ANTES de seu Workflow Interno existir publicado. A reconciliação
// enfileirada naquele momento chama `materializarExecucaoDaFase`, que
// devolve SEM_WORKFLOW_PUBLICADO sem lançar exceção — e o outbox-dispatcher
// marca ENVIADO qualquer despacho que não lança, permanentemente, sem retry.
// Publicar o Workflow Interno DEPOIS precisa reconciliar de novo; antes do
// fix, nada disparava isso.
//
// Prova, contra o BANCO DE TESTE local (nunca produção):
//   1) reproduz o evento morto (ENVIADO, zero instância/tarefa) — a falha real;
//   2) publica o Workflow Interno pelo serviço canônico (`publicarWorkflow`);
//   3) processo em andamento NA fase (direto) e processo em andamento em OUTRA
//      fase do mesmo tipo (via composição do macro) recebem exatamente 1
//      instância + 1 tarefa "Validar fase sintética" cada;
//   4) processo finalizado permanece absolutamente intocado;
//   5) repetir a publicação/reconciliação não duplica nada.
//
// Fixture 100% genérica e sintética própria — nunca TESTEVIS_fase.
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("retroacao-publicacao-workflow-interno-apos-macro.test.ts")

import { prisma } from "../lib/prisma"
import { enqueueReconciliacaoFaseMacro, enqueueReconciliacaoCatalogoFase } from "../src/lib/motor/reconciliar-fase-macro"
import { processarOutbox } from "../src/services/outbox-dispatcher"
import { publicarWorkflow } from "../src/services/publicacao-de-workflow"

const MARCA = "RETROWFI"
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

  const CHAVE_A = `${MARCA.toLowerCase()}_a`
  const CHAVE_B = `${MARCA.toLowerCase()}_b` // a fase cujo Workflow Interno só publica DEPOIS de já composta
  await prisma.catalogoFase.createMany({
    data: [
      { phaseKey: CHAVE_A, label: "[RETROWFI] Fase A", escopo: "PROCESSO", ordemPadrao: 1, requiredPadrao: true, conditionalPadrao: false, ativo: true, status: "PUBLICADA", revisaoAtual: 1, efeitosPermitidos: ["REGISTER_ONLY"] },
      { phaseKey: CHAVE_B, label: "[RETROWFI] Fase B — Validação Sintética", escopo: "PROCESSO", ordemPadrao: 2, requiredPadrao: true, conditionalPadrao: false, ativo: true, status: "PUBLICADA", revisaoAtual: 1, efeitosPermitidos: ["REGISTER_ONLY"] },
    ],
  })
  const tipo = await prisma.tipoProcessoNacionalidade.create({ data: { code: MARCA, name: `[${MARCA}] tipo`, paisId: pm.paisId, modalidadeId: pm.id, ativo: true } })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, name: `[${MARCA}] macro`, ativo: true } })
  await prisma.faseMacro.createMany({
    data: [
      { macroWorkflowId: macro.id, phaseKey: CHAVE_A, label: "Fase A", ordem: 1, required: true, conditional: false, entryRule: "process_created", showInKanban: true },
      { macroWorkflowId: macro.id, phaseKey: CHAVE_B, label: "Fase B", ordem: 2, required: true, conditional: false, entryRule: "previous_phase_completed", showInKanban: true },
      { macroWorkflowId: macro.id, phaseKey: "finalizado", label: "Finalizado", ordem: 3, required: true, conditional: false, entryRule: "previous_phase_completed", showInKanban: true },
    ],
  })

  // Workflow Interno da fase B NASCE aqui, mas SEM publicar (sem step, sem
  // congelamento) — exatamente a ordem do Defeito 1: a fase já está composta
  // no Macro antes do Workflow Interno dela existir de verdade.
  const wfB = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${tipo.id}::${CHAVE_B}`, phaseKey: CHAVE_B, tipoProcessoId: tipo.id, name: "Workflow Interno · Fase B", versao: 1, active: true, execucao: "SEQUENCIAL" },
  })

  // Três processos sintéticos: em andamento NA fase B (alcance direto), em
  // andamento em OUTRA fase do mesmo tipo (alcance por composição do macro), e
  // finalizado de verdade (nunca deve ser tocado).
  const procB = await prisma.processo.create({ data: { nome: `[${MARCA}] processo na fase B`, faseAtualKey: CHAVE_B, tipoProcessoMotorId: tipo.id, paisId: pm.paisId } })
  const procA = await prisma.processo.create({ data: { nome: `[${MARCA}] processo na fase A`, faseAtualKey: CHAVE_A, tipoProcessoMotorId: tipo.id, paisId: pm.paisId } })
  const procFinalizado = await prisma.processo.create({ data: { nome: `[${MARCA}] processo finalizado`, faseAtualKey: "finalizado", tipoProcessoMotorId: tipo.id, paisId: pm.paisId, dataConclusao: new Date() } })

  async function contarInstanciasETarefas(processoId: number) {
    const [instancias, tarefas] = await Promise.all([
      prisma.phaseWorkflowInstance.count({ where: { processoId, faseMacroKey: CHAVE_B } }),
      prisma.tarefa.count({ where: { processoId, faseMacroKey: CHAVE_B } }),
    ])
    return { instancias, tarefas }
  }

  console.log("\n1) Reproduzir o evento morto — fase B composta no Macro, Workflow Interno AINDA sem publicar")
  const r1 = await enqueueReconciliacaoFaseMacro({
    macroWorkflowId: macro.id, tipoProcessoId: tipo.id,
    versaoAnterior: macro.versao, versaoNova: macro.versao,
    fasesNovas: [{ phaseKey: CHAVE_B, required: true, conditional: false }],
    publicadoPorId: admin.id,
  })
  check("enfileirou reconciliação para os 2 processos em andamento (A e B)", r1.processosAlcancados === 2, `processosAlcancados=${r1.processosAlcancados}`)
  await processarOutbox({ forcar: true })
  const antesB = await contarInstanciasETarefas(procB.id)
  const antesA = await contarInstanciasETarefas(procA.id)
  check("evento morto: procB NÃO recebeu instância/tarefa (SEM_WORKFLOW_PUBLICADO, sem retry)", antesB.instancias === 0 && antesB.tarefas === 0, JSON.stringify(antesB))
  check("evento morto: procA (outra fase, mesmo tipo) também não recebeu nada", antesA.instancias === 0 && antesA.tarefas === 0, JSON.stringify(antesA))
  const outboxMorto = await prisma.domainOutbox.findMany({ where: { aggregateType: "Processo", aggregateId: { in: [procA.id, procB.id] } }, select: { status: true } })
  check("outbox do evento morto ficou ENVIADO (permanentemente, sem retry) — a causa raiz", outboxMorto.length > 0 && outboxMorto.every((o) => o.status === "ENVIADO"), JSON.stringify(outboxMorto.map((o) => o.status)))

  console.log("\n2) Publicar o Workflow Interno da fase B pelo fluxo canônico (agora COM o passo)")
  await prisma.phaseInternalWorkflowStep.create({
    data: { workflowId: wfB.id, key: "validar_fase_sintetica", label: "Validar fase sintética", ordem: 1, createsTask: true, required: true, owner: null, slaDays: 0, cardinalidade: null },
  })
  const pub = await publicarWorkflow({ workflowId: wfB.id, actorId: admin.id })
  check("publicação aceita", pub.ok === true, JSON.stringify(pub))

  // A trigger dentro de publicarWorkflow é fire-and-forget (não bloqueia a resposta
  // de publicação) — drenar o outbox explicitamente é o que corresponde, no mundo
  // real, ao outbox-dispatcher rodando em segundo plano.
  await processarOutbox({ forcar: true })

  console.log("\n3) A publicação do Workflow Interno reconciliou os processos em andamento")
  const depoisB = await contarInstanciasETarefas(procB.id)
  const depoisA = await contarInstanciasETarefas(procA.id)
  check("procB (direto na fase): exatamente 1 instância + 1 tarefa 'Validar fase sintética'", depoisB.instancias === 1 && depoisB.tarefas === 1, JSON.stringify(depoisB))
  check("procA (outra fase, mesmo tipo — alcance por composição do macro): exatamente 1 instância + 1 tarefa", depoisA.instancias === 1 && depoisA.tarefas === 1, JSON.stringify(depoisA))
  const tarefaB = await prisma.tarefa.findFirst({ where: { processoId: procB.id, faseMacroKey: CHAVE_B }, select: { titulo: true } })
  check("tarefa criada é a do passo publicado ('Validar fase sintética')", (tarefaB?.titulo ?? "").includes("Validar fase sintética"), tarefaB?.titulo ?? "null")

  console.log("\n4) Processo finalizado permanece absolutamente intocado")
  const finalizadoDepois = await prisma.processo.findUniqueOrThrow({ where: { id: procFinalizado.id }, select: { faseAtualKey: true, dataConclusao: true } })
  const instFinalizado = await prisma.phaseWorkflowInstance.count({ where: { processoId: procFinalizado.id } })
  check("finalizado: faseAtualKey/dataConclusao inalterados, 0 instâncias", finalizadoDepois.faseAtualKey === "finalizado" && finalizadoDepois.dataConclusao != null && instFinalizado === 0, JSON.stringify({ ...finalizadoDepois, instFinalizado }))

  console.log("\n5) Idempotência — republicar/reconciliar de novo não duplica nada")
  const catalogoB = await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey: CHAVE_B }, select: { id: true } })
  await enqueueReconciliacaoCatalogoFase({
    phaseKey: CHAVE_B, catalogoFaseId: catalogoB.id, revisaoAnterior: 1, revisaoNova: pub.versaoNova ?? 2,
    escopoMudou: false, publicadoPorId: admin.id, origem: "WORKFLOW_INTERNO",
  })
  await processarOutbox({ forcar: true })
  const depoisB2 = await contarInstanciasETarefas(procB.id)
  const depoisA2 = await contarInstanciasETarefas(procA.id)
  check("segunda reconciliação: procB continua com exatamente 1 instância + 1 tarefa (zero duplicação)", depoisB2.instancias === 1 && depoisB2.tarefas === 1, JSON.stringify(depoisB2))
  check("segunda reconciliação: procA continua com exatamente 1 instância + 1 tarefa (zero duplicação)", depoisA2.instancias === 1 && depoisA2.tarefas === 1, JSON.stringify(depoisA2))

  console.log("\n6) NOVA VERSÃO genuína do Workflow Interno (mudança real, não retry) — NÃO cria uma segunda instância/tarefa em paralelo")
  // Achado real em produção (mandato #3, 21/09/2026): `instanciarWorkflowDaFase`
  // inclui `workflowVersion` na chave de idempotência da instância — uma
  // publicação nova (versão genuinamente diferente) gerava uma SEGUNDA
  // PhaseWorkflowInstance/Tarefa em paralelo pra quem já tinha a fase, porque a
  // chave nova nunca batia com a existente. Corrigido restringindo a origem
  // WORKFLOW_INTERNO a processos que AINDA não têm nenhuma instância desta
  // fase — reproduzido e corrigido em produção nos processos 632/633/635/637.
  const step = await prisma.phaseInternalWorkflowStep.findFirstOrThrow({ where: { workflowId: wfB.id, key: "validar_fase_sintetica" } })
  await prisma.phaseInternalWorkflowStep.update({ where: { id: step.id }, data: { slaDays: 1 } })
  const pub2 = await publicarWorkflow({ workflowId: wfB.id, actorId: admin.id })
  check("nova versão publicada de verdade (versaoNova > anterior)", pub2.ok === true && (pub2.versaoNova ?? 0) > (pub2.versaoAnterior ?? 0), JSON.stringify(pub2))
  await processarOutbox({ forcar: true })
  const depoisB3 = await contarInstanciasETarefas(procB.id)
  const depoisA3 = await contarInstanciasETarefas(procA.id)
  check("procB: continua com exatamente 1 instância + 1 tarefa após nova versão (zero duplicação)", depoisB3.instancias === 1 && depoisB3.tarefas === 1, JSON.stringify(depoisB3))
  check("procA: continua com exatamente 1 instância + 1 tarefa após nova versão (zero duplicação)", depoisA3.instancias === 1 && depoisA3.tarefas === 1, JSON.stringify(depoisA3))

  await limpar()
  console.log(`\n=== RESULTADO: ${ok} ok, ${falhou} falhas ===`)
  if (falhou > 0) process.exitCode = 1
}

main().finally(() => prisma.$disconnect())

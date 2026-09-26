// scripts/motor-estado-operacao.test.ts
// ============================================================================
// ESTADO OPERACIONAL DA TAREFA — Etapa 2, fechamento (26/09/2026), item 3.
// Rodar: PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//        DIRECT_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//        npx tsx scripts/motor-estado-operacao.test.ts
//
// PROVA, com fixture de 4 subtarefas (mesma forma real de Emissão
// Documental: entrada → espera → espera+prazo → ação interna final):
//   passo 1 corrente, ainda não tocado → FILA, aIniciar=true
//   passo 2 corrente (espera externa)  → AGUARDANDO
//   passo 3 corrente (espera + define prazo) → AGUARDANDO, prazoTarefaEm preenchido
//   passo 4 corrente (ação interna final)    → FILA
//   todas concluídas                          → CONCLUIDA
// e, com uma fixture SEM subtarefas (Genealogia — motor de subtarefas não se
// aplica), tarefa aberta → FILA.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { publicarWorkflow } from "@/src/services/publicacao-de-workflow"
import { instanciarWorkflowDaFase } from "@/src/services/phase-workflow"
import { garantirTarefaDePasso } from "@/src/services/passo-tarefa"
import { concluirSubtarefaCorrentePeloPasso, estadoOperacaoDaTarefa } from "@/src/services/subtarefas-da-etapa"

const MARCA = "MOTORESTADO"
const PHASE_KEY_4_SUBTAREFAS = `${MARCA.toLowerCase()}_fase4`
const PHASE_KEY_SEM_SUBTAREFA = `${MARCA.toLowerCase()}_fase_sem_sub`

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  const tarefaIds = (await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })).map((t) => t.id)
  await prisma.contatoTerceiro.deleteMany({ where: { tarefaId: { in: tarefaIds } } })
  await prisma.subtaskExecution.deleteMany({ where: { stepInstance: { processoId: { in: ids } } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.faseMacro.deleteMany({ where: { phaseKey: { in: [PHASE_KEY_4_SUBTAREFAS, PHASE_KEY_SEM_SUBTAREFA] } } })
  await prisma.macroWorkflow.deleteMany({ where: { name: { startsWith: MARCA } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { wfUid: { startsWith: MARCA } } })
}

async function main() {
  exigirBancoDeTeste("motor-estado-operacao.test.ts")
  await limpar()
  console.log("ESTADO OPERACIONAL DA TAREFA\n")

  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })
  const tipo = await prisma.tipoProcessoNacionalidade.findFirst({ select: { id: true } })
  if (!tipo) throw new Error("Banco de teste sem nenhum TipoProcessoNacionalidade — rode o seed base primeiro.")
  let habilitacao = await prisma.tipoProcessoModalidadeHabilitada.findFirst({ where: { tipoProcessoId: tipo.id } })
  if (!habilitacao) {
    const modalidade = await prisma.modalidadePais.findFirstOrThrow()
    habilitacao = await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: tipo.id, modalidadeId: modalidade.id, ativo: true } })
  }
  const macro = await prisma.macroWorkflow.upsert({
    where: { tipoProcessoId_modalidadeId: { tipoProcessoId: tipo.id, modalidadeId: habilitacao.modalidadeId } },
    update: {}, create: { tipoProcessoId: tipo.id, modalidadeId: habilitacao.modalidadeId, name: `${MARCA} macro` },
    select: { id: true },
  })
  await prisma.faseMacro.upsert({
    where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: PHASE_KEY_4_SUBTAREFAS } },
    update: {}, create: { macroWorkflowId: macro.id, phaseKey: PHASE_KEY_4_SUBTAREFAS, label: PHASE_KEY_4_SUBTAREFAS },
    select: { id: true },
  })
  await prisma.faseMacro.upsert({
    where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: PHASE_KEY_SEM_SUBTAREFA } },
    update: {}, create: { macroWorkflowId: macro.id, phaseKey: PHASE_KEY_SEM_SUBTAREFA, label: PHASE_KEY_SEM_SUBTAREFA },
    select: { id: true },
  })

  // ══════════════════════════════════════════════════════════════════════
  secao("1) CADASTRO — 1 Step com 4 subtarefas (mesma forma real de Emissão Documental)")
  // ══════════════════════════════════════════════════════════════════════
  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${MARCA}-wf4`, phaseKey: PHASE_KEY_4_SUBTAREFAS, name: `${MARCA} wf4`, active: true, tipoProcessoId: tipo.id, escopoExecucao: "PROCESSO" },
    select: { id: true },
  })
  const step = await prisma.phaseInternalWorkflowStep.create({
    data: { workflowId: wf.id, key: "solicitar_certidao", label: "Solicitar certidão", ordem: 1, slaDays: 0, cardinalidade: "PROCESSO", diasParaIniciar: 2 },
    select: { id: true },
  })
  const SUBTAREFAS = [
    { key: "passo1_enviar", label: "Passo 1 — enviar", ordem: 0, esperaExternaAoLiberar: false, dependeDe: [] as string[] },
    { key: "passo2_aguardar", label: "Passo 2 — aguardar confirmação", ordem: 1, esperaExternaAoLiberar: true, acompanhamentoAtivo: true, acompanhamentoPrimeiroDias: 1, dependeDe: ["passo1_enviar"] },
    { key: "passo3_receber", label: "Passo 3 — receber certidão", ordem: 2, esperaExternaAoLiberar: true, acompanhamentoAtivo: true, acompanhamentoPrimeiroDias: 7, definePrazoDaTarefa: true, prazoDaTarefaDias: 10, dependeDe: ["passo2_aguardar"] },
    { key: "passo4_conferir", label: "Passo 4 — conferir e validar", ordem: 3, esperaExternaAoLiberar: false, dependeDe: ["passo3_receber"] },
  ]
  for (const s of SUBTAREFAS) {
    const criada = await prisma.stepSubtaskDefinition.create({
      data: {
        stepId: step.id, key: s.key, label: s.label, ordem: s.ordem,
        esperaExternaAoLiberar: s.esperaExternaAoLiberar,
        acompanhamentoAtivo: s.acompanhamentoAtivo ?? false,
        acompanhamentoPrimeiroDias: s.acompanhamentoPrimeiroDias ?? null,
        definePrazoDaTarefa: s.definePrazoDaTarefa ?? false,
        prazoDaTarefaDias: s.prazoDaTarefaDias ?? null,
        dependeDe: s.dependeDe,
      },
      select: { id: true },
    })
    await prisma.stepAction.create({
      data: { stepId: step.id, subtaskId: criada.id, key: "concluir", label: "Concluir", ordem: 1, effectKey: "COMPLETE_STEP" },
    })
  }
  const pub = await publicarWorkflow({ workflowId: wf.id, actorId: null, pularCompetenciaDeEfeito: true })
  ok("1.1) publicação sucede", pub.ok === true, JSON.stringify(pub).slice(0, 150))

  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arv` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${MARCA} proc`, arvoreId: arv.id, faseAtualKey: PHASE_KEY_4_SUBTAREFAS, workflowRuntime: "v2", tipoProcessoMotorId: tipo.id, modalidadeId: habilitacao.modalidadeId },
    select: { id: true },
  })
  const r = await instanciarWorkflowDaFase({ processoId: proc.id, faseMacroKey: PHASE_KEY_4_SUBTAREFAS })
  if (!r.success) { console.error(r); await limpar(); process.exit(1) }
  const stepInst = await prisma.phaseWorkflowStepInstance.findFirstOrThrow({ where: { workflowInstanceId: r.workflowInstance.id }, select: { id: true } })
  await garantirTarefaDePasso({ stepInstanceId: stepInst.id })
  const tarefaId = (await prisma.tarefa.findFirstOrThrow({ where: { workflowStepInstanceId: stepInst.id }, select: { id: true } })).id

  const tarefaAtual = () => prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId }, select: { statusTarefa: true, dataPrazo: true } })

  // ══════════════════════════════════════════════════════════════════════
  secao("2) PASSO 1 CORRENTE, ainda não tocado → FILA, aIniciar=true")
  // ══════════════════════════════════════════════════════════════════════
  const t1 = await tarefaAtual()
  const e1 = await estadoOperacaoDaTarefa({ stepInstanceId: stepInst.id, statusTarefa: t1.statusTarefa, dataPrazo: t1.dataPrazo })
  ok("2.1) estado=FILA", e1.estado === "FILA", JSON.stringify(e1))
  ok("2.2) aIniciar=true (ponto de entrada, ainda sem execução)", e1.aIniciar === true)

  // ══════════════════════════════════════════════════════════════════════
  secao("3) CONCLUIR PASSO 1 → PASSO 2 corrente (espera externa) → AGUARDANDO")
  // ══════════════════════════════════════════════════════════════════════
  const c1 = await concluirSubtarefaCorrentePeloPasso({ stepInstanceId: stepInst.id, executadoPorId: null, payload: {} })
  ok("3.1) 'passo1_enviar' concluída", c1.aplicavel === true && c1.subtarefaKey === "passo1_enviar")
  const t2 = await tarefaAtual()
  const e2 = await estadoOperacaoDaTarefa({ stepInstanceId: stepInst.id, statusTarefa: t2.statusTarefa, dataPrazo: t2.dataPrazo })
  ok("3.2) estado=AGUARDANDO", e2.estado === "AGUARDANDO", JSON.stringify(e2))
  ok("3.3) aIniciar=false (não é ponto de entrada)", e2.aIniciar === false)
  ok("3.4) prazoTarefaEm ainda null (ninguém definiu prazo até aqui)", e2.prazoTarefaEm == null)

  // ══════════════════════════════════════════════════════════════════════
  secao("4) CONCLUIR PASSO 2 → PASSO 3 corrente (espera + define prazo) → AGUARDANDO + prazoTarefaEm")
  // ══════════════════════════════════════════════════════════════════════
  const c2 = await concluirSubtarefaCorrentePeloPasso({ stepInstanceId: stepInst.id, executadoPorId: null, payload: {} })
  ok("4.1) 'passo2_aguardar' concluída", c2.aplicavel === true && c2.subtarefaKey === "passo2_aguardar")
  const t3 = await tarefaAtual()
  ok("4.2) Tarefa.dataPrazo nasceu (definePrazoDaTarefa da subtarefa 3)", t3.dataPrazo != null, String(t3.dataPrazo))
  const e3 = await estadoOperacaoDaTarefa({ stepInstanceId: stepInst.id, statusTarefa: t3.statusTarefa, dataPrazo: t3.dataPrazo })
  ok("4.3) estado=AGUARDANDO", e3.estado === "AGUARDANDO", JSON.stringify(e3))
  ok("4.4) prazoTarefaEm preenchido e bate com Tarefa.dataPrazo", e3.prazoTarefaEm != null && t3.dataPrazo != null && e3.prazoTarefaEm.getTime() === t3.dataPrazo.getTime())

  // ══════════════════════════════════════════════════════════════════════
  secao("5) CONCLUIR PASSO 3 → PASSO 4 corrente (ação interna final) → FILA")
  // ══════════════════════════════════════════════════════════════════════
  const c3 = await concluirSubtarefaCorrentePeloPasso({ stepInstanceId: stepInst.id, executadoPorId: null, payload: {} })
  ok("5.1) 'passo3_receber' concluída", c3.aplicavel === true && c3.subtarefaKey === "passo3_receber")
  const t4 = await tarefaAtual()
  const e4 = await estadoOperacaoDaTarefa({ stepInstanceId: stepInst.id, statusTarefa: t4.statusTarefa, dataPrazo: t4.dataPrazo })
  ok("5.2) estado=FILA (ação interna, não é espera de terceiro)", e4.estado === "FILA", JSON.stringify(e4))
  ok("5.3) aIniciar=false (não é ponto de entrada)", e4.aIniciar === false)
  ok("5.4) prazoTarefaEm continua preenchido (prazo fica fixo, decisão definitiva 23/09/2026)", e4.prazoTarefaEm != null)

  // ══════════════════════════════════════════════════════════════════════
  secao("6) CONCLUIR PASSO 4 → todas concluídas → CONCLUIDA")
  // ══════════════════════════════════════════════════════════════════════
  const c4 = await concluirSubtarefaCorrentePeloPasso({ stepInstanceId: stepInst.id, executadoPorId: null, payload: {} })
  ok("6.1) 'passo4_conferir' concluída, passo pode concluir", c4.aplicavel === true && c4.subtarefaKey === "passo4_conferir" && c4.podeConcluirPasso === true)
  // `concluirSubtarefaCorrentePeloPasso` não fecha o PASSO nem a TAREFA — só
  // a subtarefa (mesmo contrato documentado da função). Simula o fechamento
  // que o chamador real faria, só para provar o estado CONCLUIDA.
  await prisma.tarefa.update({ where: { id: tarefaId }, data: { statusTarefa: "CONCLUIDO_RECEBIDO", dataConclusao: new Date() } })
  const t5 = await tarefaAtual()
  const e5 = await estadoOperacaoDaTarefa({ stepInstanceId: stepInst.id, statusTarefa: t5.statusTarefa, dataPrazo: t5.dataPrazo })
  ok("6.2) estado=CONCLUIDA", e5.estado === "CONCLUIDA", JSON.stringify(e5))
  ok("6.3) aIniciar=false", e5.aIniciar === false)

  // ══════════════════════════════════════════════════════════════════════
  secao("7) TAREFA DE FASE ANTERIOR (Genealogia) ABERTA, sem motor de subtarefas → FILA")
  // ══════════════════════════════════════════════════════════════════════
  const wfSemSub = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${MARCA}-wf-semsub`, phaseKey: PHASE_KEY_SEM_SUBTAREFA, name: `${MARCA} wf sem subtarefa`, active: true, tipoProcessoId: tipo.id, escopoExecucao: "PROCESSO" },
    select: { id: true },
  })
  const stepSemSub = await prisma.phaseInternalWorkflowStep.create({
    data: { workflowId: wfSemSub.id, key: "localizar_registro", label: "Localizar registro", ordem: 1, slaDays: 5, cardinalidade: "PROCESSO" },
    select: { id: true },
  })
  await prisma.stepAction.create({
    data: { stepId: stepSemSub.id, key: "concluir", label: "Concluir", ordem: 1, effectKey: "COMPLETE_STEP" },
  })
  const pubSemSub = await publicarWorkflow({ workflowId: wfSemSub.id, actorId: null, pularCompetenciaDeEfeito: true })
  ok("7.1) publicação (fase sem subtarefas) sucede", pubSemSub.ok === true, JSON.stringify(pubSemSub).slice(0, 150))
  const procGenealogia = await prisma.processo.create({
    data: { nome: `${MARCA} proc genealogia`, arvoreId: arv.id, faseAtualKey: PHASE_KEY_SEM_SUBTAREFA, workflowRuntime: "v2", tipoProcessoMotorId: tipo.id, modalidadeId: habilitacao.modalidadeId },
    select: { id: true },
  })
  const rGen = await instanciarWorkflowDaFase({ processoId: procGenealogia.id, faseMacroKey: PHASE_KEY_SEM_SUBTAREFA })
  if (!rGen.success) { console.error(rGen); await limpar(); process.exit(1) }
  const stepInstGen = await prisma.phaseWorkflowStepInstance.findFirstOrThrow({ where: { workflowInstanceId: rGen.workflowInstance.id }, select: { id: true } })
  await garantirTarefaDePasso({ stepInstanceId: stepInstGen.id })
  const tarefaGenealogia = await prisma.tarefa.findFirstOrThrow({ where: { workflowStepInstanceId: stepInstGen.id }, select: { statusTarefa: true, dataPrazo: true } })
  const eGen = await estadoOperacaoDaTarefa({ stepInstanceId: stepInstGen.id, statusTarefa: tarefaGenealogia.statusTarefa, dataPrazo: tarefaGenealogia.dataPrazo })
  ok("7.2) estado=FILA (passo sem subtarefas cadastradas)", eGen.estado === "FILA", JSON.stringify(eGen))

  await limpar()

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${passou} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch(async (e) => { console.error(e); await limpar().catch(() => {}); process.exit(1) }).finally(() => prisma.$disconnect())

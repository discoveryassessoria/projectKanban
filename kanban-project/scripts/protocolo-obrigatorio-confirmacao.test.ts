// scripts/protocolo-obrigatorio-confirmacao.test.ts
// ============================================================================
// BUG 2 (rodada de ajustes Operação v3, 26/09/2026) — o botão que conclui a
// subtarefa "Confirmar pedido" (passo 2, confirmação do cartório) deixava
// concluir sem nenhum protocolo/nº do pedido registrado —
// `concluirSubtarefaCorrentePeloPasso` aceitava `protocolo`/`protocoloId`
// como argumentos OPCIONAIS, sem validação nenhuma.
//
// FIX: `StepSubtaskDefinition.exigeProtocolo` (novo campo, cadastro,
// congelado no snapshot como `definePrazoDaTarefa`) — quando ligado,
// `concluirSubtarefaCorrentePeloPasso` recusa concluir sem `protocolo` OU
// `protocoloId`, A MENOS que o chamador mande `confirmadoSemProtocolo: true`
// explicitamente (a ÚNICA alternativa real: "sem retorno do cartório",
// escolha que a TELA já registrava antes deste bug — StepEditors.tsx,
// checkbox "sem retorno" — mas que o backend nunca conferia).
//
// Este teste prova os 3 estados:
//   1. sem protocolo, sem "sem retorno" → recusado (aplicavel:false,
//      motivo:PROTOCOLO_OBRIGATORIO), nada é gravado
//   2. com protocolo → concluído, SubtaskExecution.protocolo salvo
//   3. sem protocolo mas com confirmadoSemProtocolo:true (a exceção real,
//      "sem retorno") → concluído mesmo sem protocolo
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { publicarWorkflow } from "@/src/services/publicacao-de-workflow"
import { criarProcessoV2 } from "@/src/services/criar-processo"
import { concluirSubtarefaCorrentePeloPasso } from "@/src/services/subtarefas-da-etapa"

const MARCA = "PROTOCOLOOBRIG"
const PHASE_KEY = `${MARCA.toLowerCase()}_fase`

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
  await prisma.subtaskExecution.deleteMany({ where: { stepInstance: { processoId: { in: ids } } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.faseMacro.deleteMany({ where: { phaseKey: PHASE_KEY } })
  await prisma.macroWorkflow.deleteMany({ where: { name: { startsWith: MARCA } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { wfUid: { startsWith: MARCA } } })
}

/** Cria um processo novo com o workflow de teste, já com o 1º passo ("enviar") concluído. */
async function novoProcessoComPasso1Concluido(tipoId: number, paisKey: string, modalidadeId: number, sufixo: string) {
  const res = await criarProcessoV2({ nome: `${MARCA} proc ${sufixo}`, pais: paisKey, tipoProcessoMotorId: tipoId, modalidadeId })
  if (!res.success) throw new Error(`criarProcessoV2 falhou: ${JSON.stringify(res)}`)
  const stepInst = await prisma.phaseWorkflowStepInstance.findFirstOrThrow({ where: { workflowInstanceId: res.currentPhaseInstanceId }, select: { id: true } })
  await concluirSubtarefaCorrentePeloPasso({ stepInstanceId: stepInst.id, executadoPorId: null, payload: {} })
  return stepInst.id
}

async function main() {
  exigirBancoDeTeste("protocolo-obrigatorio-confirmacao.test.ts")
  await limpar()
  console.log("BUG 2 — protocolo obrigatório pra concluir 'Confirmar pedido'\n")

  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })
  const tipo = await prisma.tipoProcessoNacionalidade.findFirst({ select: { id: true, paisId: true } })
  if (!tipo) throw new Error("Banco de teste sem nenhum TipoProcessoNacionalidade — rode o seed base primeiro.")
  const pais = await prisma.catalogoPais.findUniqueOrThrow({ where: { id: tipo.paisId }, select: { countryKey: true } })
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
    where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: PHASE_KEY } },
    update: {}, create: { macroWorkflowId: macro.id, phaseKey: PHASE_KEY, label: PHASE_KEY, ordem: 1 },
    select: { id: true },
  })
  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${MARCA}-wf`, phaseKey: PHASE_KEY, name: `${MARCA} wf`, active: true, tipoProcessoId: tipo.id, escopoExecucao: "PROCESSO" },
    select: { id: true },
  })
  const step = await prisma.phaseInternalWorkflowStep.create({
    data: { workflowId: wf.id, key: "solicitar_certidao", label: "Solicitar certidão", ordem: 1, slaDays: 10, cardinalidade: "PROCESSO" },
    select: { id: true },
  })
  const SUBTAREFAS = [
    { key: "enviar", label: "Enviar requerimento", ordem: 1, dependeDe: [] as string[] },
    { key: "confirmar", label: "Confirmar pedido", ordem: 2, dependeDe: ["enviar"], esperaExternaAoLiberar: true, exigeProtocolo: true },
    { key: "receber", label: "Receber certidão", ordem: 3, dependeDe: ["confirmar"], esperaExternaAoLiberar: true, definePrazoDaTarefa: true, prazoDaTarefaDias: 10 },
    { key: "conferir", label: "Conferir e validar", ordem: 4, dependeDe: ["receber"] },
  ]
  for (const s of SUBTAREFAS) {
    const criada = await prisma.stepSubtaskDefinition.create({
      data: {
        stepId: step.id, key: s.key, label: s.label, ordem: s.ordem, dependeDe: s.dependeDe,
        esperaExternaAoLiberar: s.esperaExternaAoLiberar ?? false,
        definePrazoDaTarefa: s.definePrazoDaTarefa ?? false,
        prazoDaTarefaDias: s.prazoDaTarefaDias ?? null,
        exigeProtocolo: s.exigeProtocolo ?? false,
      },
      select: { id: true },
    })
    await prisma.stepAction.create({ data: { stepId: step.id, subtaskId: criada.id, key: "concluir", label: "Concluir", ordem: 1, effectKey: "COMPLETE_STEP" } })
  }
  const pub = await publicarWorkflow({ workflowId: wf.id, actorId: null, pularCompetenciaDeEfeito: true })
  ok("0.1) publicação sucede", pub.ok === true, JSON.stringify(pub).slice(0, 150))

  // ══════════════════════════════════════════════════════════════════════
  secao("1) SEM protocolo, sem 'sem retorno' — recusado, nada gravado")
  // ══════════════════════════════════════════════════════════════════════
  const stepInst1 = await novoProcessoComPasso1Concluido(tipo.id, pais.countryKey, habilitacao.modalidadeId, "1")
  const r1 = await concluirSubtarefaCorrentePeloPasso({ stepInstanceId: stepInst1, executadoPorId: null, payload: {} })
  ok("1.1) recusado", r1.aplicavel === false, JSON.stringify(r1))
  ok("1.2) motivo é PROTOCOLO_OBRIGATORIO", !r1.aplicavel && r1.motivo === "PROTOCOLO_OBRIGATORIO", !r1.aplicavel ? r1.motivo : "—")
  const exec1 = await prisma.subtaskExecution.findFirst({ where: { stepInstanceId: stepInst1, subtaskKey: "confirmar" }, select: { status: true } })
  ok("1.3) 'confirmar' continua não concluída", exec1?.status !== "CONCLUIDO", exec1?.status)

  // ══════════════════════════════════════════════════════════════════════
  secao("2) COM protocolo — concluído, protocolo salvo na execução")
  // ══════════════════════════════════════════════════════════════════════
  const stepInst2 = await novoProcessoComPasso1Concluido(tipo.id, pais.countryKey, habilitacao.modalidadeId, "2")
  const r2 = await concluirSubtarefaCorrentePeloPasso({ stepInstanceId: stepInst2, executadoPorId: null, payload: {}, protocolo: "CART-2026-00042" })
  ok("2.1) aplicavel=true", r2.aplicavel === true, JSON.stringify(r2))
  const exec2 = await prisma.subtaskExecution.findFirst({ where: { stepInstanceId: stepInst2, subtaskKey: "confirmar" }, select: { status: true, protocolo: true } })
  ok("2.2) 'confirmar' concluída", exec2?.status === "CONCLUIDO", exec2?.status)
  ok("2.3) protocolo salvo", exec2?.protocolo === "CART-2026-00042", exec2?.protocolo ?? "null")

  // ══════════════════════════════════════════════════════════════════════
  secao("3) SEM protocolo mas com confirmadoSemProtocolo (\"sem retorno\") — concluído")
  // ══════════════════════════════════════════════════════════════════════
  const stepInst3 = await novoProcessoComPasso1Concluido(tipo.id, pais.countryKey, habilitacao.modalidadeId, "3")
  const r3 = await concluirSubtarefaCorrentePeloPasso({ stepInstanceId: stepInst3, executadoPorId: null, payload: {}, confirmadoSemProtocolo: true })
  ok("3.1) aplicavel=true (exceção explícita aceita)", r3.aplicavel === true, JSON.stringify(r3))
  const exec3 = await prisma.subtaskExecution.findFirst({ where: { stepInstanceId: stepInst3, subtaskKey: "confirmar" }, select: { status: true, protocolo: true } })
  ok("3.2) 'confirmar' concluída sem protocolo", exec3?.status === "CONCLUIDO" && exec3.protocolo === null, JSON.stringify(exec3))

  await limpar()

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${passou} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch(async (e) => { console.error(e); await limpar().catch(() => {}); process.exit(1) }).finally(() => prisma.$disconnect())

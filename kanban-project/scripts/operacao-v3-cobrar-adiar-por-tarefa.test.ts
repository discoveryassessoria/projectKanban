// scripts/operacao-v3-cobrar-adiar-por-tarefa.test.ts
// ============================================================================
// ETAPA 3 — subtarefaCorrenteDaTarefa + adiarAcompanhamento (fachada por
// tarefaId usada pelas portas /api/operacao/tarefas/[tarefaId]/cobrar e
// .../adiar-acompanhamento). Rodar:
//   PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//   DIRECT_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//   npx tsx scripts/operacao-v3-cobrar-adiar-por-tarefa.test.ts
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { publicarWorkflow } from "@/src/services/publicacao-de-workflow"
import { instanciarWorkflowDaFase } from "@/src/services/phase-workflow"
import { garantirTarefaDePasso } from "@/src/services/passo-tarefa"
import {
  concluirSubtarefaCorrentePeloPasso, subtarefaCorrenteDaTarefa,
  adiarAcompanhamento, registrarCobranca,
} from "@/src/services/subtarefas-da-etapa"
import { prazoOperacional } from "@/lib/operacional/tempo-operacional"

const MARCA = "OPV3COBADIAR"
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
  const tarefaIds = (await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })).map((t) => t.id)
  await prisma.contatoTerceiro.deleteMany({ where: { tarefaId: { in: tarefaIds } } })
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

async function main() {
  exigirBancoDeTeste("operacao-v3-cobrar-adiar-por-tarefa.test.ts")
  await limpar()
  console.log("ETAPA 3 — cobrar/adiar pela porta de tarefaId\n")

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
    where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: PHASE_KEY } },
    update: {}, create: { macroWorkflowId: macro.id, phaseKey: PHASE_KEY, label: PHASE_KEY },
    select: { id: true },
  })

  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${MARCA}-wf`, phaseKey: PHASE_KEY, name: `${MARCA} wf`, active: true, tipoProcessoId: tipo.id, escopoExecucao: "PROCESSO" },
    select: { id: true },
  })
  const step = await prisma.phaseInternalWorkflowStep.create({
    data: { workflowId: wf.id, key: "solicitar_certidao", label: "Solicitar certidão", ordem: 1, slaDays: 0, cardinalidade: "PROCESSO" },
    select: { id: true },
  })
  const SUBTAREFAS = [
    { key: "enviar", label: "Enviar", ordem: 0, esperaExternaAoLiberar: false, dependeDe: [] as string[] },
    { key: "aguardar", label: "Aguardar retorno", ordem: 1, esperaExternaAoLiberar: true, acompanhamentoAtivo: true, acompanhamentoPrimeiroDias: 5, dependeDe: ["enviar"] },
  ]
  for (const s of SUBTAREFAS) {
    const criada = await prisma.stepSubtaskDefinition.create({
      data: {
        stepId: step.id, key: s.key, label: s.label, ordem: s.ordem,
        esperaExternaAoLiberar: s.esperaExternaAoLiberar,
        acompanhamentoAtivo: s.acompanhamentoAtivo ?? false,
        acompanhamentoPrimeiroDias: s.acompanhamentoPrimeiroDias ?? null,
        dependeDe: s.dependeDe,
      },
      select: { id: true },
    })
    await prisma.stepAction.create({
      data: { stepId: step.id, subtaskId: criada.id, key: "concluir", label: "Concluir", ordem: 1, effectKey: "COMPLETE_STEP" },
    })
  }
  const pub = await publicarWorkflow({ workflowId: wf.id, actorId: null, pularCompetenciaDeEfeito: true })
  ok("0.1) publicação sucede", pub.ok === true, JSON.stringify(pub).slice(0, 150))

  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arv` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${MARCA} proc`, arvoreId: arv.id, faseAtualKey: PHASE_KEY, workflowRuntime: "v2", tipoProcessoMotorId: tipo.id, modalidadeId: habilitacao.modalidadeId },
    select: { id: true },
  })
  const r = await instanciarWorkflowDaFase({ processoId: proc.id, faseMacroKey: PHASE_KEY })
  if (!r.success) { console.error(r); await limpar(); process.exit(1) }
  const stepInst = await prisma.phaseWorkflowStepInstance.findFirstOrThrow({ where: { workflowInstanceId: r.workflowInstance.id }, select: { id: true } })
  await garantirTarefaDePasso({ stepInstanceId: stepInst.id })
  const tarefaId = (await prisma.tarefa.findFirstOrThrow({ where: { workflowStepInstanceId: stepInst.id }, select: { id: true } })).id

  await concluirSubtarefaCorrentePeloPasso({ stepInstanceId: stepInst.id, executadoPorId: null, payload: {} })

  // ══════════════════════════════════════════════════════════════════════
  secao("1) subtarefaCorrenteDaTarefa resolve pelo tarefaId, não pelo stepInstanceId")
  // ══════════════════════════════════════════════════════════════════════
  const corrente = await subtarefaCorrenteDaTarefa(tarefaId)
  ok("1.1) resolve stepInstanceId+subtaskKey corretos", corrente?.stepInstanceId === stepInst.id && corrente?.subtaskKey === "aguardar", JSON.stringify(corrente))

  // ══════════════════════════════════════════════════════════════════════
  secao("2) ADIAR — motivo obrigatório, +N dias corridos sobre proximoAcompanhamentoEm")
  // ══════════════════════════════════════════════════════════════════════
  const antes = await prisma.subtaskExecution.findFirstOrThrow({ where: { stepInstanceId: stepInst.id, subtaskKey: "aguardar", supersededAt: null }, select: { proximoAcompanhamentoEm: true } })
  const esperado = prazoOperacional(3, antes.proximoAcompanhamentoEm!)
  const rAdiar = await adiarAcompanhamento({ stepInstanceId: corrente!.stepInstanceId, subtaskKey: corrente!.subtaskKey, motivo: "aguardando retorno do requerente" })
  ok("2.1) adiar sucede", rAdiar.ok === true, JSON.stringify(rAdiar))
  if (rAdiar.ok) {
    ok("2.2) nova data = +3 dias corridos sobre a data anterior", esperado != null && rAdiar.proximoAcompanhamentoEm.getTime() === esperado.getTime(), `esperado=${esperado?.toISOString()} obtido=${rAdiar.proximoAcompanhamentoEm.toISOString()}`)
  }
  const logAdiar = await prisma.logAuditoria.findFirst({ where: { acao: "ACOMPANHAMENTO_ADIADO", entidadeId: (await prisma.subtaskExecution.findFirstOrThrow({ where: { stepInstanceId: stepInst.id, subtaskKey: "aguardar", supersededAt: null }, select: { id: true } })).id } })
  ok("2.3) motivo fica registrado em LogAuditoria", !!logAdiar?.descricao.includes("aguardando retorno do requerente"))

  const semExecucao = await adiarAcompanhamento({ stepInstanceId: 999999, subtaskKey: "x", motivo: "teste" })
  ok("2.4) sem execução vigente devolve SEM_EXECUCAO_VIGENTE", semExecucao.ok === false && semExecucao.motivo === "SEM_EXECUCAO_VIGENTE")

  // ══════════════════════════════════════════════════════════════════════
  secao("3) COBRAR pela mesma resolução — reagenda e conta certo")
  // ══════════════════════════════════════════════════════════════════════
  const rCobrar = await registrarCobranca({ stepInstanceId: corrente!.stepInstanceId, subtaskKey: corrente!.subtaskKey, canal: "EMAIL" })
  ok("3.1) cobrança via subtarefaCorrenteDaTarefa sucede", rCobrar.ok === true && rCobrar.totalContatos === 1, JSON.stringify(rCobrar))

  await limpar()

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${passou} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch(async (e) => { console.error(e); await limpar().catch(() => {}); process.exit(1) }).finally(() => prisma.$disconnect())

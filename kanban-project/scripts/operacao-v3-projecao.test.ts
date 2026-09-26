// scripts/operacao-v3-projecao.test.ts
// ============================================================================
// ETAPA 3 (TELA OPERAÇÃO V3) — `LinhaDeFila.estadoOperacao/aIniciar/passoCorrente`.
// Rodar: PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//        DIRECT_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//        npx tsx scripts/operacao-v3-projecao.test.ts
//
// PROVA que `visaoGerencial`/`minhaFila` (a MESMA consulta que a tela usa)
// devolve os 3 campos aditivos que a Etapa 3 precisa, computados em LOTE a
// partir de `progressoPorSubtarefa` — sem consulta extra por linha:
//   passo 1 corrente, ainda não tocado → estadoOperacao=FILA, aIniciar=true
//   passo 2 corrente (espera externa)  → estadoOperacao=AGUARDANDO, aIniciar=false
//   passoCorrente.label bate com o rótulo da subtarefa (nunca a chave crua)
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { publicarWorkflow } from "@/src/services/publicacao-de-workflow"
import { instanciarWorkflowDaFase } from "@/src/services/phase-workflow"
import { garantirTarefaDePasso } from "@/src/services/passo-tarefa"
import { concluirSubtarefaCorrentePeloPasso } from "@/src/services/subtarefas-da-etapa"
import { visaoGerencial } from "@/lib/operacional/tarefa-projecoes"

const MARCA = "OPV3PROJ"
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

async function main() {
  exigirBancoDeTeste("operacao-v3-projecao.test.ts")
  await limpar()
  console.log("ETAPA 3 — PROJEÇÃO estadoOperacao/aIniciar/passoCorrente\n")

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
    { key: "enviar_requerimento", label: "Enviar requerimento ao cartório", ordem: 0, esperaExternaAoLiberar: false, dependeDe: [] as string[] },
    { key: "aguardar_retorno", label: "Confirmar pedido do cartório", ordem: 1, esperaExternaAoLiberar: true, acompanhamentoAtivo: true, acompanhamentoPrimeiroDias: 1, dependeDe: ["enviar_requerimento"] },
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

  // ══════════════════════════════════════════════════════════════════════
  secao("1) PASSO 1 CORRENTE, ainda não tocado")
  // ══════════════════════════════════════════════════════════════════════
  // `garantirTarefaDePasso` pode criar, à parte, a obrigação administrativa
  // "Atribuir tarefas" (sem responsável) — não é a linha sob teste; filtra
  // pelo título real da tarefa da etapa, nunca por índice/posição.
  const { linhas: l1all } = await visaoGerencial({ processoId: proc.id }, new Date())
  const l1 = l1all.find((l) => l.titulo === "Solicitar certidão")
  ok("1.1) a tarefa 'Solicitar certidão' existe na projeção", l1 != null, `titulos=${l1all.map((l) => l.titulo).join(", ")}`)
  ok("1.2) estadoOperacao=FILA", l1?.estadoOperacao === "FILA", l1?.estadoOperacao)
  ok("1.3) aIniciar=true", l1?.aIniciar === true)
  ok("1.4) passoCorrente.chave/label corretos", l1?.passoCorrente?.chave === "enviar_requerimento" && l1?.passoCorrente?.label === "Enviar requerimento ao cartório", JSON.stringify(l1?.passoCorrente))

  // ══════════════════════════════════════════════════════════════════════
  secao("2) CONCLUIR PASSO 1 → PASSO 2 corrente (espera externa)")
  // ══════════════════════════════════════════════════════════════════════
  const c1 = await concluirSubtarefaCorrentePeloPasso({ stepInstanceId: stepInst.id, executadoPorId: null, payload: {} })
  ok("2.1) 'enviar_requerimento' concluída", c1.aplicavel === true && c1.subtarefaKey === "enviar_requerimento")
  const { linhas: l2all } = await visaoGerencial({ processoId: proc.id }, new Date())
  const l2 = l2all.find((l) => l.titulo === "Solicitar certidão")
  ok("2.2) estadoOperacao=AGUARDANDO", l2?.estadoOperacao === "AGUARDANDO", l2?.estadoOperacao)
  ok("2.3) aIniciar=false (não é ponto de entrada)", l2?.aIniciar === false)
  ok("2.4) passoCorrente aponta para 'aguardar_retorno'", l2?.passoCorrente?.chave === "aguardar_retorno", JSON.stringify(l2?.passoCorrente))

  await limpar()

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${passou} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch(async (e) => { console.error(e); await limpar().catch(() => {}); process.exit(1) }).finally(() => prisma.$disconnect())

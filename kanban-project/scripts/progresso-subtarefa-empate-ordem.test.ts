// scripts/progresso-subtarefa-empate-ordem.test.ts
// ============================================================================
// REGRESSÃO REAL 26/09/2026 (hotfix Cibils) — `progressoPorSubtarefa` escolhia
// a subtarefa "atual" ordenando as execuções não-encerradas só por `ordem`.
// Quando o snapshot tem DUAS subtarefas com a MESMA `ordem` (cadastro torto:
// `enviar_requerimento_cartorio` e `receber_confirmacao_pedido`, as duas em
// 1 — a dependência já as distinguia, o `ordem` não), e a query de execuções
// não tem `ORDER BY`, o empate virava sorteio pela ordem física que o
// Postgres devolvia: 9 de 16 tarefas reais caíram numa subtarefa BLOQUEADA
// (dependência pendente) escolhida como "atual" só por ter vindo primeiro no
// array — aIniciar caiu pra false, banner de bloqueio sumiu, botão errado.
//
// Este teste reproduz o empate (duas subtarefas com `ordem: 1`, a segunda
// dependendo da primeira) e prova que a subtarefa BLOQUEADA nunca é
// escolhida como "atual" enquanto a dependência dela não concluiu —
// independente de `ordem` empatado.
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

const MARCA = "EMPATEORDEM"
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
  exigirBancoDeTeste("progresso-subtarefa-empate-ordem.test.ts")
  await limpar()
  console.log("EMPATE DE ORDEM — 'atual' nunca pode ser a subtarefa bloqueada\n")

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
  // A REPRODUÇÃO DO EMPATE REAL: "entrada" e "dependente" com a MESMA
  // `ordem` (1) — só `dependeDe` distingue quem pode ser "atual".
  const SUBTAREFAS = [
    { key: "entrada", label: "Enviar requerimento", ordem: 1, dependeDe: [] as string[] },
    { key: "dependente", label: "Confirmar pedido", ordem: 1, dependeDe: ["entrada"] },
    { key: "final", label: "Receber certidão", ordem: 2, dependeDe: ["dependente"] },
  ]
  for (const s of SUBTAREFAS) {
    const criada = await prisma.stepSubtaskDefinition.create({
      data: { stepId: step.id, key: s.key, label: s.label, ordem: s.ordem, dependeDe: s.dependeDe },
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
  const { materializarSubtarefas } = await import("@/src/services/subtarefas-da-etapa")
  await materializarSubtarefas({ stepInstanceId: stepInst.id })

  // ══════════════════════════════════════════════════════════════════════
  secao("1) NADA concluído — 'atual' tem que ser 'entrada', nunca 'dependente'")
  // ══════════════════════════════════════════════════════════════════════
  const { linhas: l1all } = await visaoGerencial({ processoId: proc.id }, new Date())
  const l1 = l1all.find((l) => l.titulo === "Solicitar certidão")
  ok("1.1) a tarefa existe na projeção", l1 != null, `titulos=${l1all.map((l) => l.titulo).join(", ")}`)
  ok("1.2) passoCorrente é 'entrada' (não 'dependente', mesmo com ordem empatada)", l1?.passoCorrente?.chave === "entrada", JSON.stringify(l1?.passoCorrente))
  ok("1.3) estadoOperacao=FILA", l1?.estadoOperacao === "FILA", l1?.estadoOperacao)
  ok("1.4) aIniciar=true", l1?.aIniciar === true)

  // ══════════════════════════════════════════════════════════════════════
  secao("2) CONCLUIR 'entrada' → 'atual' passa a ser 'dependente'")
  // ══════════════════════════════════════════════════════════════════════
  const c1 = await concluirSubtarefaCorrentePeloPasso({ stepInstanceId: stepInst.id, executadoPorId: null, payload: {} })
  ok("2.1) 'entrada' concluída", c1.aplicavel === true && c1.subtarefaKey === "entrada", JSON.stringify(c1))
  const { linhas: l2all } = await visaoGerencial({ processoId: proc.id }, new Date())
  const l2 = l2all.find((l) => l.titulo === "Solicitar certidão")
  ok("2.2) passoCorrente agora é 'dependente'", l2?.passoCorrente?.chave === "dependente", JSON.stringify(l2?.passoCorrente))
  ok("2.3) aIniciar=false (não é ponto de entrada)", l2?.aIniciar === false)

  await limpar()

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${passou} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch(async (e) => { console.error(e); await limpar().catch(() => {}); process.exit(1) }).finally(() => prisma.$disconnect())

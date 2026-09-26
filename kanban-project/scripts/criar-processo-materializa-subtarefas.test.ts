// scripts/criar-processo-materializa-subtarefas.test.ts
// ============================================================================
// ETAPA A (fechamento Operação v3, 26/09/2026) — fecha o gap: todo processo
// novo nasce com as subtarefas do primeiro passo já materializadas.
//
// ACHADO (hotfix Cibils, 25-26/09/2026): `criarProcessoV2` cria Processo +
// Workflow Interno + Tarefas iniciais numa `prisma.$transaction`, chamando
// `garantirTarefaDePasso(..., tx)`. Só o caminho STANDALONE de
// `garantirTarefaDePasso` (sem `txExterno`) materializava subtarefas depois
// — sob `txExterno`, "o chamador dela é quem materializa depois que A
// PRÓPRIA transação dele comita" (comentário original em passo-tarefa.ts).
// `criarProcessoV2` não fazia isso: TODO processo novo cujo primeiro passo
// tivesse subtarefas nascia com Tarefa.dataPrazo correto (null, quando
// alguma subtarefa define o prazo) mas ZERO SubtaskExecution — exatamente o
// estado que quebrou a Operação v3 pros 16 documentos da Cibils.
//
// Corrigido em src/services/criar-processo.ts: depois que a transação
// comita, materializarSubtarefas roda pra cada stepInstance cuja Tarefa
// nasceu agora — mesmo padrão (fora da tx, best-effort) que
// passo-tarefa.ts já usa no caminho standalone.
//
// Este teste cria um processo de VERDADE via criarProcessoV2 (a porta real
// que POST /api/processos usa) com um Workflow Interno cujo primeiro passo
// tem 4 subtarefas (a mesma forma da Emissão Documental: enviar/confirmar/
// receber/conferir), e prova ponta a ponta:
//   1. 4 SubtaskExecution materializadas pro primeiro passo
//   2. Tarefa.dataPrazo nulo (o passo tem subtarefa que define prazo)
//   3. a projeção (visaoGerencial, a mesma que /api/operacao/tarefas usa)
//      devolve aIniciar=true e a entrada corrente correta
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { publicarWorkflow } from "@/src/services/publicacao-de-workflow"
import { criarProcessoV2 } from "@/src/services/criar-processo"
import { visaoGerencial } from "@/lib/operacional/tarefa-projecoes"
import { acaoDe } from "@/src/components/operacao/operacao-v3-derivacoes"

const MARCA = "CRIARPROCMAT"
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
  exigirBancoDeTeste("criar-processo-materializa-subtarefas.test.ts")
  await limpar()
  console.log("ETAPA A — criarProcessoV2 materializa subtarefas do 1º passo\n")

  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })
  const tipo = await prisma.tipoProcessoNacionalidade.findFirst({ select: { id: true, paisId: true } })
  if (!tipo) throw new Error("Banco de teste sem nenhum TipoProcessoNacionalidade — rode o seed base primeiro.")
  const pais = await prisma.catalogoPais.findUniqueOrThrow({ where: { id: tipo.paisId }, select: { countryKey: true, ativo: true } })
  if (!pais.ativo) throw new Error(`CatalogoPais ${tipo.paisId} inativo — teste precisa de um país ativo.`)

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
    data: { workflowId: wf.id, key: "solicitar_certidao", label: "Solicitar certidão", ordem: 1, slaDays: 0, cardinalidade: "PROCESSO", diasParaIniciar: 2 },
    select: { id: true },
  })
  // MESMA FORMA da Emissão Documental real: 4 subtarefas, a 3ª define o
  // prazo da Tarefa (nunca a criação).
  const SUBTAREFAS = [
    { key: "enviar", label: "Enviar requerimento", ordem: 1, dependeDe: [] as string[] },
    { key: "confirmar", label: "Confirmar pedido", ordem: 2, dependeDe: ["enviar"], esperaExternaAoLiberar: true, acompanhamentoAtivo: true, acompanhamentoPrimeiroDias: 1 },
    { key: "receber", label: "Receber certidão", ordem: 3, dependeDe: ["confirmar"], esperaExternaAoLiberar: true, definePrazoDaTarefa: true, prazoDaTarefaDias: 10 },
    { key: "conferir", label: "Conferir e validar", ordem: 4, dependeDe: ["receber"] },
  ]
  for (const s of SUBTAREFAS) {
    const criada = await prisma.stepSubtaskDefinition.create({
      data: {
        stepId: step.id, key: s.key, label: s.label, ordem: s.ordem, dependeDe: s.dependeDe,
        esperaExternaAoLiberar: s.esperaExternaAoLiberar ?? false,
        acompanhamentoAtivo: s.acompanhamentoAtivo ?? false,
        acompanhamentoPrimeiroDias: s.acompanhamentoPrimeiroDias ?? null,
        definePrazoDaTarefa: s.definePrazoDaTarefa ?? false,
        prazoDaTarefaDias: s.prazoDaTarefaDias ?? null,
      },
      select: { id: true },
    })
    await prisma.stepAction.create({
      data: { stepId: step.id, subtaskId: criada.id, key: "concluir", label: "Concluir", ordem: 1, effectKey: "COMPLETE_STEP" },
    })
  }
  const pub = await publicarWorkflow({ workflowId: wf.id, actorId: null, pularCompetenciaDeEfeito: true })
  ok("0.1) publicação sucede", pub.ok === true, JSON.stringify(pub).slice(0, 150))

  // ══════════════════════════════════════════════════════════════════════
  secao("1) criarProcessoV2 — a porta REAL (a mesma de POST /api/processos)")
  // ══════════════════════════════════════════════════════════════════════
  const res = await criarProcessoV2({
    nome: `${MARCA} proc`, pais: pais.countryKey, tipoProcessoMotorId: tipo.id, modalidadeId: habilitacao.modalidadeId,
  })
  ok("1.1) criação sucede", res.success === true, JSON.stringify(res).slice(0, 300))
  if (!res.success) { await limpar(); process.exit(1) }
  ok("1.2) fase inicial é a nossa", res.currentPhaseKey === PHASE_KEY, res.currentPhaseKey)
  ok("1.3) 1 tarefa inicial", res.tarefasIniciais === 1, String(res.tarefasIniciais))

  const stepInst = await prisma.phaseWorkflowStepInstance.findFirstOrThrow({
    where: { workflowInstanceId: res.currentPhaseInstanceId }, select: { id: true },
  })
  const tarefa = await prisma.tarefa.findFirstOrThrow({ where: { workflowStepInstanceId: stepInst.id }, select: { id: true, dataPrazo: true } })

  // ══════════════════════════════════════════════════════════════════════
  secao("2) 4 SubtaskExecution materializadas, dataPrazo nulo")
  // ══════════════════════════════════════════════════════════════════════
  const execs = await prisma.subtaskExecution.findMany({ where: { stepInstanceId: stepInst.id }, select: { subtaskKey: true, status: true } })
  ok("2.1) 4 SubtaskExecution existem", execs.length === 4, `${execs.length}: ${execs.map((e) => `${e.subtaskKey}=${e.status}`).join(", ")}`)
  ok("2.2) 'enviar' (entrada) está DISPONIVEL", execs.find((e) => e.subtaskKey === "enviar")?.status === "DISPONIVEL")
  ok("2.3) Tarefa.dataPrazo é null (nasce só na subtarefa 'receber')", tarefa.dataPrazo === null, String(tarefa.dataPrazo))

  // ══════════════════════════════════════════════════════════════════════
  secao("3) a projeção (mesma que /api/operacao/tarefas usa) devolve aIniciar=true")
  // ══════════════════════════════════════════════════════════════════════
  const { linhas } = await visaoGerencial({ processoId: res.processId }, new Date())
  const linha = linhas.find((l) => l.titulo === "Solicitar certidão")
  ok("3.1) a tarefa existe na projeção", linha != null, `titulos=${linhas.map((l) => l.titulo).join(", ")}`)
  ok("3.2) aIniciar=true", linha?.aIniciar === true)
  ok("3.3) estadoOperacao=FILA", linha?.estadoOperacao === "FILA", linha?.estadoOperacao)
  ok("3.4) passoCorrente é 'enviar'", linha?.passoCorrente?.chave === "enviar", JSON.stringify(linha?.passoCorrente))
  ok("3.5) acao='Iniciar' (mesma derivação da tela Operação v3)", linha != null && acaoDe(linha as never).label === "Iniciar", linha ? acaoDe(linha as never).label : "—")

  await limpar()

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${passou} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch(async (e) => { console.error(e); await limpar().catch(() => {}); process.exit(1) }).finally(() => prisma.$disconnect())

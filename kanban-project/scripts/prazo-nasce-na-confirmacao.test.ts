// scripts/prazo-nasce-na-confirmacao.test.ts
// ============================================================================
// BUG 1 (rodada de ajustes Operação v3, 26/09/2026) — o prazo da Tarefa de
// Emissão Documental só pode nascer quando o passo 2 ("Receber confirmação
// do pedido") CONCLUI (o cartório confirmou o requerimento) — nunca antes,
// nunca na criação.
//
// ACHADO EM PRODUÇÃO: `StepSubtaskDefinition` (Biblioteca de Tarefas,
// "Solicitar certidão") nunca teve `definePrazoDaTarefa`/`prazoDaTarefaDias`
// configurado em NENHUMA subtarefa (todas `false`/`null`) — não é bug de
// código, é cadastro nunca preenchido. Sem isso, `garantirTarefaDePasso`
// cai no regime incondicional antigo (`calcularPrazo(new Date(), sla)`,
// sla=10 do PASSO) e grava `dataPrazo` = criação + 10 dias — antes de
// QUALQUER subtarefa rodar. 10 tarefas em produção tinham esse valor
// indevido enquanto ainda estavam no passo 1 ou 2 (corrigido em
// scripts/prazo-nasce-na-confirmacao-backfill.ts).
//
// Este teste prova o MECANISMO correto (com cadastro configurado
// corretamente na própria fixture — reproduz o que a Biblioteca de Tarefas
// devia ter desde o início): `receber_certidao` (passo 3) marcado
// `definePrazoDaTarefa: true, prazoDaTarefaDias: 10`. Por causa da ordem
// em que `aplicarPrazoDaTarefaSeConfigurado` é chamada (depois que a
// subtarefa concluída libera a PRÓXIMA, que passa a ser "corrente"), isso
// é o que faz o prazo nascer exatamente quando o passo 2 termina — nunca
// antes, porque até lá a subtarefa que define prazo (passo 3) nem é
// corrente ainda.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { publicarWorkflow } from "@/src/services/publicacao-de-workflow"
import { criarProcessoV2 } from "@/src/services/criar-processo"
import { concluirSubtarefaCorrentePeloPasso } from "@/src/services/subtarefas-da-etapa"
import { estadoTemporal } from "@/lib/operacional/tempo-operacional"

const MARCA = "PRAZOCONFIRM"
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
  exigirBancoDeTeste("prazo-nasce-na-confirmacao.test.ts")
  await limpar()
  console.log("BUG 1 — prazo da Tarefa só nasce quando o passo 2 (confirmação) conclui\n")

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
    await prisma.stepAction.create({ data: { stepId: step.id, subtaskId: criada.id, key: "concluir", label: "Concluir", ordem: 1, effectKey: "COMPLETE_STEP" } })
  }
  const pub = await publicarWorkflow({ workflowId: wf.id, actorId: null, pularCompetenciaDeEfeito: true })
  ok("0.1) publicação sucede", pub.ok === true, JSON.stringify(pub).slice(0, 150))

  const res = await criarProcessoV2({ nome: `${MARCA} proc`, pais: pais.countryKey, tipoProcessoMotorId: tipo.id, modalidadeId: habilitacao.modalidadeId })
  ok("0.2) processo criado", res.success === true, JSON.stringify(res).slice(0, 200))
  if (!res.success) { await limpar(); process.exit(1) }
  const stepInst = await prisma.phaseWorkflowStepInstance.findFirstOrThrow({ where: { workflowInstanceId: res.currentPhaseInstanceId }, select: { id: true } })
  const tarefaId = (await prisma.tarefa.findFirstOrThrow({ where: { workflowStepInstanceId: stepInst.id }, select: { id: true } })).id

  // ══════════════════════════════════════════════════════════════════════
  secao("1) PASSO 1 aberto — dataPrazo nulo, 'Sem prazo'")
  // ══════════════════════════════════════════════════════════════════════
  const t1 = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId }, select: { dataPrazo: true, statusTarefa: true, createdAt: true } })
  ok("1.1) dataPrazo é null na criação (não é o regime antigo, apesar de o passo ter slaDays=10)", t1.dataPrazo === null, String(t1.dataPrazo))
  const est1 = estadoTemporal({ dataPrazo: t1.dataPrazo, statusTarefa: t1.statusTarefa, criadaEm: t1.createdAt, agora: new Date() })
  ok("1.2) estadoTemporal reporta semPrazo=true", est1.semPrazo === true, JSON.stringify(est1).slice(0, 150))

  // ══════════════════════════════════════════════════════════════════════
  secao("2) CONCLUIR PASSO 1 ('enviar') — passo 2 corrente, dataPrazo AINDA nulo")
  // ══════════════════════════════════════════════════════════════════════
  const c1 = await concluirSubtarefaCorrentePeloPasso({ stepInstanceId: stepInst.id, executadoPorId: null, payload: {} })
  ok("2.1) 'enviar' concluída", c1.aplicavel === true && c1.subtarefaKey === "enviar", JSON.stringify(c1))
  const t2 = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId }, select: { dataPrazo: true } })
  ok("2.2) dataPrazo continua nulo (passo 2 ainda aberto, cartório não confirmou)", t2.dataPrazo === null, String(t2.dataPrazo))

  // ══════════════════════════════════════════════════════════════════════
  secao("3) CONCLUIR PASSO 2 ('confirmar') — AGORA dataPrazo = confirmação + 10 dias corridos")
  // ══════════════════════════════════════════════════════════════════════
  const antesDeConfirmar = new Date()
  const c2 = await concluirSubtarefaCorrentePeloPasso({ stepInstanceId: stepInst.id, executadoPorId: null, payload: {} })
  ok("3.1) 'confirmar' concluída", c2.aplicavel === true && c2.subtarefaKey === "confirmar", JSON.stringify(c2))
  const t3 = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId }, select: { dataPrazo: true } })
  ok("3.2) dataPrazo agora está preenchido", t3.dataPrazo !== null, String(t3.dataPrazo))
  const dias = t3.dataPrazo ? Math.round((t3.dataPrazo.getTime() - antesDeConfirmar.getTime()) / 86_400_000) : null
  ok("3.3) dataPrazo é confirmação + 10 dias corridos (não a criação da Tarefa)", dias === 10, `${dias} dia(s)`)

  await limpar()

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${passou} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch(async (e) => { console.error(e); await limpar().catch(() => {}); process.exit(1) }).finally(() => prisma.$disconnect())

// scripts/prova-prazo-unico-subtarefa.test.ts
// ============================================================================
// PROVA PONTA A PONTA — decisão definitiva (23/09/2026): existe um único
// prazo final por Tarefa. Fases e subtarefas não têm vencimento próprio.
// Acompanhamentos de terceiros permanecem como lembretes separados.
//
// Complementa scripts/tempo-operacional.test.ts §97 (prova de AUSÊNCIA do
// mecanismo antigo no código/schema) e scripts/subtarefas-canonicas.test.ts/
// controle-temporal-espera-e2e.test.ts (cobertura geral de subtarefa) — aqui
// é a prova de COMPORTAMENTO, com Tarefa e subtarefas reais materializadas:
//
//   1) uma tarefa com subtarefas mantém um único prazo (Tarefa.dataPrazo),
//      mesmo com várias subtarefas nascendo/avançando;
//   2) acompanhamento de terceiro continua funcionando (proximoAcompanhamentoEm
//      calculado corretamente) SEM alterar/duplicar o prazo da tarefa;
//   3) nenhuma cobrança pelo relógio antigo: subtarefa sem execução nunca
//      aparece como "atrasada" em lugar nenhum (nem SubtaskExecution nem a
//      classificação de atenção têm de onde tirar isso).
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("prova-prazo-unico-subtarefa")

import { prisma } from "../lib/prisma"
import { prazoOperacional } from "../lib/operacional/tempo-operacional"
import { congelarVersaoVigente } from "../src/services/versao-publicada"
import { subtarefasDaEtapa, materializarSubtarefas, concluirSubtarefaCorrentePeloPasso } from "../src/services/subtarefas-da-etapa"
import { garantirTentativa, MOTIVOS_DE_TENTATIVA } from "../src/services/execucao-do-passo"
import { garantirTarefaDePasso, carregarPreCondicoes } from "../src/services/passo-tarefa"
import { classificarAtencaoOperacional, type LinhaComAtencao } from "../lib/operacional/atencao-operacional"

const MARCA = "PRAZOUNICO"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

async function limpar() {
  const wfs = await prisma.phaseInternalWorkflow.findMany({ where: { phaseKey: { startsWith: MARCA.toLowerCase() } }, select: { id: true } })
  const wfIds = wfs.map((w) => w.id)
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })
  const procIds = procs.map((p) => p.id)
  await prisma.tarefa.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.subtaskExecution.deleteMany({ where: { stepInstance: { processoId: { in: procIds } } } })
  await prisma.stepExecution.deleteMany({ where: { stepInstance: { processoId: { in: procIds } } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.processo.deleteMany({ where: { id: { in: procIds } } })
  await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: { in: wfIds } } })
  await prisma.stepSubtaskDefinition.deleteMany({ where: { stepId: { in: (await prisma.phaseInternalWorkflowStep.findMany({ where: { workflowId: { in: wfIds } }, select: { id: true } })).map((s) => s.id) } } })
  await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: { in: wfIds } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { id: { in: wfIds } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
}

async function main() {
  console.log(`\n=== PROVA — prazo único da Tarefa, subtarefa sem relógio próprio (${MARCA}) ===\n`)
  await limpar()

  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${MARCA.toLowerCase()}-wf`, name: `[${MARCA}] Workflow`, phaseKey: `${MARCA.toLowerCase()}_fase`, tipoProcessoId: null, execucao: "SEQUENCIAL", versao: 1, active: true },
    select: { id: true },
  })
  const passo = await prisma.phaseInternalWorkflowStep.create({
    data: {
      workflowId: wf.id, key: "passo_unico", label: "Passo único", ordem: 1, createsTask: true, required: true,
      slaDays: 7, regraDeConclusao: "ACAO_DO_PASSO", cardinalidade: "PROCESSO", dependeDe: [] as never,
    },
    select: { id: true },
  })
  // Subtarefa A: ação interna comum, sem acompanhamento, sem regra temporal.
  await prisma.stepSubtaskDefinition.create({
    data: { stepId: passo.id, key: "sub_acao", label: "Ação comum", ordem: 1, obrigatoria: false, modoExecucao: "MANUAL", responsavelRegra: "HERDA", fonteDeCanais: "NENHUMA", dependeDe: [] as never },
  })
  // Subtarefa B: espera de terceiro, com acompanhamento em 3 dias — depende
  // de A (só vira corrente/materializa a espera depois de A concluída).
  await prisma.stepSubtaskDefinition.create({
    data: {
      stepId: passo.id, key: "sub_espera", label: "Aguardar cartório", ordem: 2, obrigatoria: false, modoExecucao: "MANUAL", responsavelRegra: "HERDA",
      fonteDeCanais: "NENHUMA", dependeDe: ["sub_acao"] as never, esperaExternaAoLiberar: true,
      acompanhamentoAtivo: true, acompanhamentoPrimeiroDias: 3,
    },
  })
  await congelarVersaoVigente(wf.id, "CRIACAO")

  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arvore` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} processo`, arvoreId: arv.id }, select: { id: true } })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: wf.id.toString(), ciclo: 1, status: "ATIVO", workflowDefinitionId: wf.id, workflowVersion: 1, chaveIdempotencia: `${MARCA}-inst` },
    select: { id: true },
  })
  const antes = new Date()
  const si = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: wf.id.toString(), ciclo: 1,
      stepKey: "passo_unico", ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
      status: "DISPONIVEL", slaDays: 7, dependeDeStepKeys: [] as never,
      stepDefinitionId: passo.id, stepDefinitionVersion: 1, chaveIdempotencia: `${MARCA}-passo`,
    },
    select: { id: true },
  })
  await garantirTentativa(si.id, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "DISPONIVEL" })
  const preCond = await carregarPreCondicoes(proc.id)
  const gt = await garantirTarefaDePasso({ stepInstanceId: si.id, origem: "workflow", preCondicoes: preCond })
  if (!gt.success) throw new Error(`tarefa não criada: ${JSON.stringify(gt)}`)
  const tarefaId = gt.tarefa.id

  console.log("1) UM ÚNICO PRAZO — a tarefa, mesmo com subtarefas nascendo")
  const tarefaAntes = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId } })
  const esperado = prazoOperacional(7, antes)
  ok("a tarefa nasceu com o prazo do PASSO (7 dias úteis)",
    tarefaAntes.dataPrazo != null && esperado != null && Math.abs(tarefaAntes.dataPrazo.getTime() - esperado.getTime()) < 60_000,
    tarefaAntes.dataPrazo?.toISOString())

  const mat = await materializarSubtarefas({ stepInstanceId: si.id })
  ok("as duas subtarefas foram materializadas", mat.criadas === 2, `${mat.criadas}`)

  const subs1 = await subtarefasDaEtapa({ stepInstanceId: si.id })
  ok("nenhuma subtarefa expõe slaDays (campo eliminado do schema)", subs1.every((s) => !("slaDays" in s)))
  ok("nenhuma subtarefa expõe situacaoTemporal (a subtarefa não tem estado temporal próprio)", subs1.every((s) => !("situacaoTemporal" in s)))

  const tarefaDepoisMat = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId } })
  ok("o prazo da tarefa NÃO mudou ao materializar subtarefas",
    tarefaDepoisMat.dataPrazo?.getTime() === tarefaAntes.dataPrazo?.getTime())

  console.log("\n2) ACOMPANHAMENTO continua funcionando, sem tocar no prazo único")
  // Porta canônica de produção (concluirSubtarefaCorrentePeloPasso): conclui
  // a subtarefa CORRENTE ("sub_acao") e, na mesma composição, reconcilia as
  // dependentes e aplica a espera externa automática de quem virou corrente
  // em seguida ("sub_espera") — a MESMA sequência que a execução real usa,
  // nunca uma orquestração própria do teste.
  const antesEspera = new Date()
  const concluida = await concluirSubtarefaCorrentePeloPasso({ stepInstanceId: si.id, executadoPorId: null, payload: {} })
  ok("a porta canônica concluiu 'sub_acao' (a corrente antes)", concluida.aplicavel && concluida.subtarefaKey === "sub_acao", JSON.stringify(concluida))

  const subs2 = await subtarefasDaEtapa({ stepInstanceId: si.id })
  const espera = subs2.find((s) => s.key === "sub_espera")!
  const esperadoAcompanhamento = prazoOperacional(3, antesEspera)
  ok("o acompanhamento foi calculado (3 dias úteis a partir da liberação)",
    espera.execucao?.proximoAcompanhamentoEm != null && esperadoAcompanhamento != null
    && Math.abs(espera.execucao.proximoAcompanhamentoEm.getTime() - esperadoAcompanhamento.getTime()) < 60_000,
    espera.execucao?.proximoAcompanhamentoEm?.toISOString())

  const tarefaDepoisAcompanhamento = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId } })
  ok("o prazo da tarefa continua EXATAMENTE o mesmo — acompanhamento não gera nem move o vencimento",
    tarefaDepoisAcompanhamento.dataPrazo?.getTime() === tarefaAntes.dataPrazo?.getTime())
  ok("o acompanhamento não é (nem se aproxima d)o prazo da tarefa — campos inteiramente separados",
    Math.abs(espera.execucao!.proximoAcompanhamentoEm!.getTime() - tarefaDepoisAcompanhamento.dataPrazo!.getTime()) > 24 * 3600_000)

  console.log("\n3) NENHUMA COBRANÇA PELO RELÓGIO ANTIGO")
  ok("a execução da subtarefa não tem mais campo 'prazo' (coluna eliminada do schema)",
    !("prazo" in (espera.execucao as object)))
  // Simula a classificação de atenção com uma tarefa cujo ÚNICO fato de
  // atraso seria o antigo relógio de subtarefa (que não existe mais) — sem
  // atrasoInterno/atrasoTerceiro/acompanhamentoVencido reais, a classificação
  // tem que cair em "outras"/"aguardandoTerceiros", nunca inventar atraso.
  const linha: LinhaComAtencao = {
    taskId: tarefaId, coluna: "AGUARDANDO_TERCEIRO", dataPrazo: tarefaDepoisAcompanhamento.dataPrazo?.toISOString() ?? null,
    atrasada: false, venceHoje: false, executavelAgora: false, atribuidaEm: null,
    acompanhamentoVencido: false, atrasoInterno: false, atrasoTerceiro: false, retornoRecebido: false, emRisco: false,
  }
  ok("sem relógio de subtarefa para consultar, a classificação nunca inventa atrasoInterno",
    classificarAtencaoOperacional(linha) !== "atrasoInterno", classificarAtencaoOperacional(linha))

  console.log(`\n══════════════════════════════════════\nTotal: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhas.length) { console.log("\nFalhas:"); for (const f of falhas) console.log(`  · ${f}`) }

  await limpar()
  await prisma.$disconnect()
  if (falhou > 0) process.exit(1)
}

main().catch(async (e) => {
  console.error(e)
  try { await limpar() } catch { /* melhor esforço */ }
  await prisma.$disconnect()
  process.exit(1)
})

// scripts/controle-temporal-espera-e2e.test.ts
// ============================================================================
// TESTE PONTA-A-PONTA OBRIGATÓRIO (mandato "correção definitiva do modelo
// temporal", 19-20/09/2026) — o caso de prova completo, sem hardcode de
// negócio no motor (nenhum "if cartório"/"if certidão" em código — tudo vem
// do cadastro desta suíte, que só por coincidência de nomenclatura imita o
// caso real).
//
//   Passo 1 — Enviar requerimento (ação interna)
//   Passo 2 — Receber confirmação do pedido (AGUARDANDO_TERCEIRO,
//             acompanhamento PRÓPRIO + regra temporal PRÓPRIA, gatilho =
//             conclusão do passo 1)
//   Passo 3 — Receber certidão (AGUARDANDO_TERCEIRO, acompanhamento PRÓPRIO
//             + regra temporal PRÓPRIA de 7 dias, gatilho = conclusão do
//             passo 2)
//   Passo 4 — Conferir e validar (ação interna)
//
// Prova, com dado real materializado (nunca só unitário sobre struct):
//   - prazo oficial da Tarefa nunca se move;
//   - cada espera tem acompanhamento E regra temporal PRÓPRIOS,
//     independentes um do outro e entre os dois passos;
//   - terceiro atrasado (passo 3) != tarefa atrasada;
//   - zero duplicação de Tarefa/StepInstance/SubtaskExecution/notificação.
//
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/controle-temporal-espera-e2e.test.ts
// ============================================================================

import { PrismaClient } from "@prisma/client"
import { congelarVersaoVigente } from "../src/services/versao-publicada"
import { validarWorkflowParaPublicar } from "../src/services/validacao-de-publicacao"
import { subtarefasDaEtapa } from "../src/services/subtarefas-da-etapa"
import { execucaoVigente } from "../src/services/execucao-da-subtarefa"
import { executarAcaoCadastrada } from "../src/services/executar-acao-cadastrada"
import { garantirTentativa, MOTIVOS_DE_TENTATIVA } from "../src/services/execucao-do-passo"
import { prazoOperacional, diaOperacional } from "../lib/operacional/tempo-operacional"
import { minhaFila } from "../lib/operacional/tarefa-projecoes"
import { calcularAtencaoOperacional } from "../lib/operacional/atencao-operacional"
import { exigirBancoDeTeste } from "./_banco-de-teste"

const prisma = new PrismaClient()
const M = "E2ETEMPO"

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: `${M} ` } }, select: { id: true } })
  for (const p of procs) {
    await prisma.subtaskExecution.deleteMany({ where: { stepInstance: { processoId: p.id } } })
    await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: p.id } })
    await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: p.id } })
    await prisma.notificacaoOperacional.deleteMany({ where: { OR: [{ processoId: p.id }] } })
    await prisma.tarefa.deleteMany({ where: { processoId: p.id } })
    await prisma.processo.delete({ where: { id: p.id } }).catch(() => null)
  }
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: `${M} ` } } })
  const wf = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid: `${M}::wf` }, select: { id: true } })
  if (wf) {
    await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })
  }
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: `${M}_fase` } })
}

async function main() {
  exigirBancoDeTeste("prova o fluxo completo de acompanhamento + regra temporal, sem duplicação")
  await limpar()
  console.log("TESTE PONTA-A-PONTA — CONTROLE TEMPORAL DA ESPERA (mandato 19-20/09/2026)\n")

  const daniela = await prisma.usuario.findFirst({ orderBy: { id: "asc" }, select: { id: true } })
    ?? await prisma.usuario.create({ data: { nome: "Daniela E2ETEMPO", email: `${M}@teste.local`, senha: "x", tipo: "assistente" }, select: { id: true } })
  const UID = daniela.id
  const PERMS = ["tarefas.editar", "documentos.editar", "processos.editar", "workflow.concluirPasso"]

  const fase = await prisma.catalogoFase.create({
    data: {
      phaseKey: `${M}_fase`, label: "Fase de Teste E2E Temporal", escopo: "PROCESSO", ordemPadrao: 97,
      efeitosPermitidos: ["COMPLETE_STEP", "REGISTER_ONLY", "PAUSE_FOR_EXTERNAL_WAIT", "RESUME"],
    },
    select: { phaseKey: true },
  })
  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${M}::wf`, phaseKey: fase.phaseKey, name: "Workflow E2E temporal", versao: 1, execucao: "SEQUENCIAL" },
    select: { id: true, versao: true },
  })
  const passo = await prisma.phaseInternalWorkflowStep.create({
    data: {
      workflowId: wf.id, key: "solicitar_certidao", label: "Solicitar certidão", ordem: 1, createsTask: true,
      required: true, cardinalidade: "DOCUMENTO", executorKey: "padrao", dependeDe: [] as never, slaDays: 8,
      regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS",
    },
    select: { id: true, key: true },
  })

  // ── PASSO 1 — Enviar requerimento (ação interna) ──────────────────────────
  const sub1 = await prisma.stepSubtaskDefinition.create({
    data: {
      stepId: passo.id, key: "enviar_requerimento", label: "Enviar requerimento", ordem: 1,
      obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA",
      fonteDeCanais: "NENHUMA", dependeDe: [] as never, slaDays: 1,
    },
    select: { id: true, key: true },
  })
  await prisma.stepAction.create({
    data: { stepId: passo.id, subtaskId: sub1.id, key: "enviado", label: "Enviado", effectKey: "REGISTER_ONLY", ordem: 1 },
  })

  // ── PASSO 2 — Receber confirmação do pedido (AGUARDANDO_TERCEIRO) ────────
  // Acompanhamento PRÓPRIO (2 dias) + regra temporal PRÓPRIA (5 dias),
  // gatilho = conclusão do passo 1. Números de TESTE — o mandato pediu para
  // não inventar quantidade de dias como REGRA DE NEGÓCIO real; aqui são só
  // valores de fixture, para provar o mecanismo.
  const sub2 = await prisma.stepSubtaskDefinition.create({
    data: {
      stepId: passo.id, key: "receber_confirmacao_do_pedido", label: "Receber confirmação do pedido", ordem: 2,
      obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA",
      fonteDeCanais: "NENHUMA", dependeDe: ["enviar_requerimento"] as never,
      esperaExternaAoLiberar: true,
      acompanhamentoAtivo: true, acompanhamentoPrimeiroDias: 2,
      regraTemporalAtiva: true, regraTemporalDias: 5, regraTemporalGatilhoChave: "enviar_requerimento",
    },
    select: { id: true, key: true },
  })
  await prisma.stepAction.create({
    data: { stepId: passo.id, subtaskId: sub2.id, key: "confirmado", label: "Confirmado", effectKey: "REGISTER_ONLY", ordem: 1 },
  })

  // ── PASSO 3 — Receber certidão (AGUARDANDO_TERCEIRO) ─────────────────────
  // Acompanhamento PRÓPRIO (3 dias) + regra temporal de 7 dias (o número
  // EXATO do exemplo do mandato), gatilho = conclusão do passo 2.
  const sub3 = await prisma.stepSubtaskDefinition.create({
    data: {
      stepId: passo.id, key: "receber_certidao", label: "Receber certidão", ordem: 3,
      obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA",
      fonteDeCanais: "NENHUMA", dependeDe: ["receber_confirmacao_do_pedido"] as never,
      esperaExternaAoLiberar: true,
      acompanhamentoAtivo: true, acompanhamentoPrimeiroDias: 3,
      regraTemporalAtiva: true, regraTemporalDias: 7, regraTemporalGatilhoChave: "receber_confirmacao_do_pedido",
    },
    select: { id: true, key: true },
  })
  await prisma.stepAction.create({
    data: { stepId: passo.id, subtaskId: sub3.id, key: "recebido", label: "Recebido", effectKey: "REGISTER_ONLY", ordem: 1 },
  })

  // ── PASSO 4 — Conferir e validar (ação interna) ───────────────────────────
  const sub4 = await prisma.stepSubtaskDefinition.create({
    data: {
      stepId: passo.id, key: "conferir_e_validar", label: "Conferir e validar", ordem: 4,
      obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA",
      fonteDeCanais: "NENHUMA", dependeDe: ["receber_certidao"] as never, slaDays: 1,
    },
    select: { id: true, key: true },
  })
  await prisma.stepAction.create({
    data: { stepId: passo.id, subtaskId: sub4.id, key: "validado", label: "Validado", effectKey: "COMPLETE_STEP", ordem: 1 },
  })

  const probs = await validarWorkflowParaPublicar(wf.id)
  check("a configuração (4 passos + controle temporal) é publicável", probs.length === 0, JSON.stringify(probs))
  await congelarVersaoVigente(wf.id, "CRIACAO")

  const arv = await prisma.arvore.create({ data: { nome: `${M} árvore` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${M} processo`, arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: fase.phaseKey },
    select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: fase.phaseKey, ciclo: 1, status: "ATIVO", workflowDefinitionId: wf.id, workflowVersion: 1, chaveIdempotencia: `${M}-i1` },
    select: { id: true },
  })
  const si = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: fase.phaseKey, ciclo: 1,
      stepKey: passo.key, ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
      status: "EM_ANDAMENTO", dependeDeStepKeys: [] as never,
      stepDefinitionId: passo.id, stepDefinitionVersion: 1, chaveIdempotencia: `${M}-p1`,
    },
    select: { id: true },
  })
  await garantirTentativa(si.id, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "DISPONIVEL" })

  // O PRAZO OFICIAL DA TAREFA — 30 dias, DELIBERADAMENTE longe de qualquer
  // regra temporal desta espera (5 ou 7 dias). É a prova viva de "terceiro
  // atrasado != tarefa atrasada": ele nunca deveria se mexer no teste inteiro.
  const prazoOficial = new Date()
  prazoOficial.setDate(prazoOficial.getDate() + 30)
  const tarefa = await prisma.tarefa.create({
    data: {
      titulo: `${M} tarefa`, processoId: proc.id, workflowStepInstanceId: si.id, workflowInstanceId: inst.id,
      chaveIdempotencia: `${M}-t1`, statusTarefa: "NAO_INICIADA", responsavelId: daniela.id, dataPrazo: prazoOficial,
    },
    select: { id: true },
  })

  // ══════════════════════════════════════════════════════════════
  console.log("\nD0 — passo 1 disponível: PARA_AGIR_AGORA")
  // ══════════════════════════════════════════════════════════════
  const projD0 = await subtarefasDaEtapa({ stepInstanceId: si.id })
  check("sub1 (enviar_requerimento) está disponível", projD0.find((s) => s.key === "enviar_requerimento")?.disponivel === true)
  const filaD0 = (await minhaFila(UID)).find((l) => l.taskId === tarefa.id)
  check("D0) a tarefa aparece na fila de Daniela", filaD0 != null)
  check("D0) classificação = PARA_AGIR_AGORA", Boolean(filaD0 && calcularAtencaoOperacional(filaD0).categoriaPrincipal === "paraAgirAgora"),
    filaD0 ? calcularAtencaoOperacional(filaD0).categoriaPrincipal : "—")

  // ══════════════════════════════════════════════════════════════
  console.log("\nD1 — Daniela envia o requerimento: passo 1 concluído, passo 2 entra em espera")
  // ══════════════════════════════════════════════════════════════
  const r1 = await executarAcaoCadastrada(si.id, "enviado", {}, {
    usuarioId: UID, permissoes: PERMS, correlationId: `${M}-a1`, subtaskKey: "enviar_requerimento", fornecedorId: null,
  })
  check("D1) ação executa", r1.ok, JSON.stringify(r1))
  const exec1 = await execucaoVigente(si.id, "enviar_requerimento")
  check("D1) sub1 concluída, com completedAt registrado (é o gatilho do passo 2)", exec1?.status === "CONCLUIDO" && exec1?.completedAt != null)

  const exec2 = await execucaoVigente(si.id, "receber_confirmacao_do_pedido")
  check("D1) sub2 nasceu AGUARDANDO_EXTERNO automaticamente", exec2?.status === "AGUARDANDO_EXTERNO")
  const previstoParaEsperado2 = prazoOperacional(5, exec1!.completedAt!)
  check(
    "D1) regra temporal de sub2 (5 dias) parte da CONCLUSÃO do passo 1 — gatilho genérico, não hardcoded",
    exec2?.previstoPara != null && diaOperacional(exec2.previstoPara) === diaOperacional(previstoParaEsperado2!),
    `previstoPara=${exec2?.previstoPara?.toISOString()} esperado=${previstoParaEsperado2?.toISOString()}`,
  )
  check("D1) acompanhamento de sub2 também materializado, PRÓPRIO (não é o mesmo valor da regra temporal)",
    exec2?.proximoAcompanhamentoEm != null && exec2.proximoAcompanhamentoEm.getTime() !== exec2.previstoPara!.getTime())

  const tarefaD1 = await prisma.tarefa.findUnique({ where: { id: tarefa.id }, select: { dataPrazo: true } })
  check("D1) prazo oficial da Tarefa NÃO se moveu", tarefaD1?.dataPrazo?.getTime() === prazoOficial.getTime())

  const filaD1 = (await minhaFila(UID)).find((l) => l.taskId === tarefa.id)
  check("D1) classificação = aguardandoTerceiros (nem acompanhamento nem regra temporal venceram ainda)",
    Boolean(filaD1 && calcularAtencaoOperacional(filaD1).categoriaPrincipal === "aguardandoTerceiros"),
    filaD1 ? calcularAtencaoOperacional(filaD1).categoriaPrincipal : "—")

  // ══════════════════════════════════════════════════════════════
  console.log("\nAcompanhamento de sub2 vence: ACOMPANHAR_HOJE, sem tocar na regra temporal")
  // ══════════════════════════════════════════════════════════════
  const ontem = new Date(); ontem.setDate(ontem.getDate() - 1)
  await prisma.subtaskExecution.update({ where: { id: exec2!.id }, data: { proximoAcompanhamentoEm: ontem } })
  const filaAcomp = (await minhaFila(UID)).find((l) => l.taskId === tarefa.id)
  check("acompanhamento vencido → ACOMPANHAR_HOJE", Boolean(filaAcomp && calcularAtencaoOperacional(filaAcomp).categoriaPrincipal === "acompanharHoje"),
    filaAcomp ? calcularAtencaoOperacional(filaAcomp).categoriaPrincipal : "—")
  check("motivo ACOMPANHAMENTO_DEVIDO presente, TERCEIRO_ATRASADO ausente (regra temporal ainda não venceu)",
    Boolean(filaAcomp
      && calcularAtencaoOperacional(filaAcomp).motivos.includes("ACOMPANHAMENTO_DEVIDO")
      && !calcularAtencaoOperacional(filaAcomp).motivos.includes("TERCEIRO_ATRASADO")))

  // ══════════════════════════════════════════════════════════════
  console.log("\nCartório confirma: passo 2 concluído, passo 3 entra em espera com 7 dias a partir DESTA confirmação")
  // ══════════════════════════════════════════════════════════════
  const r2 = await executarAcaoCadastrada(si.id, "confirmado", {}, {
    usuarioId: UID, permissoes: PERMS, correlationId: `${M}-a2`, subtaskKey: "receber_confirmacao_do_pedido", fornecedorId: null,
  })
  check("confirmação executa", r2.ok, JSON.stringify(r2))
  const exec2Depois = await execucaoVigente(si.id, "receber_confirmacao_do_pedido")
  check("sub2 concluída, completedAt registrado (é o gatilho do passo 3)", exec2Depois?.status === "CONCLUIDO" && exec2Depois?.completedAt != null)
  check(
    "o acompanhamento vencido de sub2 (histórico) continua no banco — não foi apagado, só deixou de ser acionável (relógio encerrado)",
    exec2Depois?.proximoAcompanhamentoEm != null,
  )

  const exec3 = await execucaoVigente(si.id, "receber_certidao")
  check("sub3 nasceu AGUARDANDO_EXTERNO automaticamente", exec3?.status === "AGUARDANDO_EXTERNO")
  const previstoParaEsperado3 = prazoOperacional(7, exec2Depois!.completedAt!)
  check(
    "regra temporal de sub3 = EXATAMENTE 7 dias a partir da conclusão do passo 2 (o exemplo literal do mandato)",
    exec3?.previstoPara != null && diaOperacional(exec3.previstoPara) === diaOperacional(previstoParaEsperado3!),
    `previstoPara=${exec3?.previstoPara?.toISOString()} esperado=${previstoParaEsperado3?.toISOString()}`,
  )
  check(
    "regra temporal de sub3 é INDEPENDENTE da de sub2 (gatilhos e janelas diferentes)",
    exec3!.previstoPara!.getTime() !== exec2Depois!.previstoPara?.getTime(),
  )
  check("acompanhamento de sub3 também materializado, PRÓPRIO",
    exec3?.proximoAcompanhamentoEm != null && exec3.proximoAcompanhamentoEm.getTime() !== exec3.previstoPara!.getTime())

  const filaAntesDoLimite = (await minhaFila(UID)).find((l) => l.taskId === tarefa.id)
  check("ANTES dos 7 dias: nem terceirosAtrasados, nem tarefa atrasada",
    Boolean(filaAntesDoLimite
      && calcularAtencaoOperacional(filaAntesDoLimite).categoriaPrincipal !== "terceirosAtrasados"
      && filaAntesDoLimite.atrasada === false))

  // ══════════════════════════════════════════════════════════════
  console.log("\nApós o limite de 7 dias: TERCEIRO_ATRASADO — e a Tarefa continua NÃO atrasada")
  // ══════════════════════════════════════════════════════════════
  const passado = new Date(); passado.setDate(passado.getDate() - 1)
  await prisma.subtaskExecution.update({ where: { id: exec3!.id }, data: { previstoPara: passado } })
  const filaAposLimite = (await minhaFila(UID)).find((l) => l.taskId === tarefa.id)
  check("DEPOIS do limite: categoria = terceirosAtrasados", Boolean(filaAposLimite && calcularAtencaoOperacional(filaAposLimite).categoriaPrincipal === "terceirosAtrasados"),
    filaAposLimite ? calcularAtencaoOperacional(filaAposLimite).categoriaPrincipal : "—")
  check("MAS a Tarefa NÃO está atrasada — prazo oficial (30 dias) é outro relógio",
    Boolean(filaAposLimite && filaAposLimite.atrasada === false && filaAposLimite.dataPrazo === prazoOficial.toISOString()))

  // Devolve previstoPara pro futuro antes de concluir — o teste real de
  // "chegou a certidão" não deveria depender de já estar atrasada.
  const futuro = new Date(); futuro.setDate(futuro.getDate() + 5)
  await prisma.subtaskExecution.update({ where: { id: exec3!.id }, data: { previstoPara: futuro } })

  // ══════════════════════════════════════════════════════════════
  console.log("\nCertidão chega: passo 3 concluído, passo 4 liberado — PARA_AGIR_AGORA de novo")
  // ══════════════════════════════════════════════════════════════
  const r3 = await executarAcaoCadastrada(si.id, "recebido", {}, {
    usuarioId: UID, permissoes: PERMS, correlationId: `${M}-a3`, subtaskKey: "receber_certidao", fornecedorId: null,
  })
  check("recebimento executa", r3.ok, JSON.stringify(r3))
  const projPosCertidao = await subtarefasDaEtapa({ stepInstanceId: si.id })
  check("sub4 (conferir e validar) liberada", projPosCertidao.find((s) => s.key === "conferir_e_validar")?.disponivel === true)
  check("e a Tarefa foi DESBLOQUEADA automaticamente — a espera acabou, a próxima é ação interna",
    (await prisma.tarefa.findUnique({ where: { id: tarefa.id }, select: { statusTarefa: true, motivoCodigo: true } }))?.statusTarefa === "NAO_INICIADA")
  const filaFinal1 = (await minhaFila(UID)).find((l) => l.taskId === tarefa.id)
  check("classificação = paraAgirAgora (ação interna disponível de novo)",
    Boolean(filaFinal1 && calcularAtencaoOperacional(filaFinal1).categoriaPrincipal === "paraAgirAgora"),
    filaFinal1 ? calcularAtencaoOperacional(filaFinal1).categoriaPrincipal : "—")

  // ══════════════════════════════════════════════════════════════
  console.log("\nDaniela confere e valida: a Tarefa conclui")
  // ══════════════════════════════════════════════════════════════
  const r4 = await executarAcaoCadastrada(si.id, "validado", {}, {
    usuarioId: UID, permissoes: PERMS, correlationId: `${M}-a4`, subtaskKey: "conferir_e_validar", fornecedorId: null,
  })
  check("validação executa e conclui o passo", r4.ok && r4.concluiuPasso === true, JSON.stringify(r4))
  const tarefaFinal = await prisma.tarefa.findUnique({ where: { id: tarefa.id }, select: { statusTarefa: true, concluida: true } })
  check("a Tarefa está concluída", tarefaFinal?.concluida === true, tarefaFinal?.statusTarefa)

  // ══════════════════════════════════════════════════════════════
  console.log("\nPROVA DE NÃO DUPLICAÇÃO — o fluxo inteiro, uma unidade só")
  // ══════════════════════════════════════════════════════════════
  const tarefasDoProcesso = await prisma.tarefa.count({ where: { processoId: proc.id } })
  check("exatamente 1 Tarefa do início ao fim (4 passos, 1 obrigação)", tarefasDoProcesso === 1, String(tarefasDoProcesso))
  const stepInstancesDoProcesso = await prisma.phaseWorkflowStepInstance.count({ where: { processoId: proc.id } })
  check("exatamente 1 PhaseWorkflowStepInstance", stepInstancesDoProcesso === 1, String(stepInstancesDoProcesso))
  const execucoesVigentes = await prisma.subtaskExecution.count({ where: { stepInstanceId: si.id, supersededAt: null } })
  check("exatamente 4 SubtaskExecution vigentes — uma por subtarefa, nunca duplicada", execucoesVigentes === 4, String(execucoesVigentes))
  const notificacoes = await prisma.notificacaoOperacional.count({ where: { OR: [{ tarefaId: tarefa.id }, { processoId: proc.id }] } })
  check("nenhuma notificação duplicada por relógio (0 ou 1 evento de atribuição — nunca N por dimensão temporal)", notificacoes <= 1, String(notificacoes))

  console.log(`\n${ok} passaram, ${falhas.length} falharam`)
  if (falhas.length > 0) { console.log("Falhas:", falhas.join(" | ")); process.exitCode = 1 }
  await limpar()
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})

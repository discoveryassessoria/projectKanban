// scripts/prova-biblioteca-propaga-processos-em-andamento.test.ts
// ============================================================================
// PROVA — publicar uma versão nova na Biblioteca de Tarefas propaga
// AUTOMATICAMENTE para os processos em andamento, respeitando a posição de
// cada um (decisão definitiva/"regra crucial", 23/09/2026):
//
//   fase JÁ ULTRAPASSADA — não altera nada.
//   fase FUTURA (processo ainda não chegou)  — passa a usar a versão nova
//     quando chegar lá (o ponteiro do vínculo já está atualizado).
//   fase ATUAL (instância já aberta) — aplica automaticamente à Tarefa já
//     materializada: recalcula o vencimento a partir da data ORIGINAL da
//     Tarefa (nunca da data da publicação), sem duplicar, sem apagar
//     trabalho, sem reiniciar a contagem.
//
// Cenário sintético (marca BIBPROP), banco de teste. Reaproveita 100% do
// mecanismo já existente e já testado (reconciliarNovaVersaoNaInstanciaAtual
// + o outbox de enqueueReconciliacaoWorkflowInternoFaseAtual/
// enqueueReconciliacaoCatalogoFase) — este teste prova só a PARTE NOVA: que
// publicar o MODELO da Biblioteca dispara esse mecanismo para toda fase real
// que o selecionou, sem exigir um "republicar" manual do Workflow Interno.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("prova-biblioteca-propaga-processos-em-andamento.test.ts")

import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { criarModelo, publicarModelo } from "../src/services/biblioteca-tarefas/modelo"
import { processarOutbox } from "../src/services/outbox-dispatcher"
import { garantirTarefaDePasso, carregarPreCondicoes } from "../src/services/passo-tarefa"
import { prazoOperacional } from "../lib/operacional/tempo-operacional"

const MARCA = "BIBPROP"
const PHASE_KEY = `${MARCA.toLowerCase()}_fase`

let ok = 0, falhou = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.error(`  ❌ ${nome}${detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""}`) }
}

async function chamar(handler: (req: NextRequest, ctx?: any) => Promise<Response>, method: string, path: string, token: string, body?: unknown, params?: Record<string, string>) {
  const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } }
  if (body !== undefined) init.body = JSON.stringify(body)
  const req = new NextRequest(`http://localhost${path}`, init)
  return params ? handler(req, { params: Promise.resolve(params) }) : handler(req)
}

async function limpar() {
  const modelos = await prisma.bibliotecaModeloTarefa.findMany({ where: { chave: { startsWith: `${MARCA.toLowerCase()}_` } }, select: { id: true, workflowId: true } })
  const wfsDaFase = await prisma.phaseInternalWorkflow.findMany({ where: { phaseKey: PHASE_KEY }, select: { id: true } })
  const wfIds = [...modelos.map((m) => m.workflowId), ...wfsDaFase.map((w) => w.id)]
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })
  const procIds = procs.map((p) => p.id)
  await prisma.domainOutbox.deleteMany({ where: { aggregateType: "Processo", aggregateId: { in: procIds } } })
  // DEBRIS DE RODADAS ANTERIORES: um outbox de reconciliação desta MESMA fase
  // sintética, apontando para um processo/usuário já apagado por uma limpeza
  // anterior, sobrevive entre execuções (nunca casa com `procIds` desta
  // rodada, que são IDs novos). `processarOutbox({forcar:true})` no passo 5
  // varre TUDO que está pendente no banco — sem isto, ele reprocessaria essa
  // sobra e quebraria com FK em `usuarioId`/`aggregateId` já inexistente.
  const outboxRestante = await prisma.domainOutbox.findMany({
    where: { tipo: "workflow-interno.fase-atual.reconciliar" }, select: { id: true, payload: true },
  })
  const idsParaLimpar = outboxRestante
    .filter((o) => (o.payload as { phaseKey?: string } | null)?.phaseKey === PHASE_KEY)
    .map((o) => o.id)
  if (idsParaLimpar.length) await prisma.domainOutbox.deleteMany({ where: { id: { in: idsParaLimpar } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.processo.deleteMany({ where: { id: { in: procIds } } })
  await prisma.phaseInternalWorkflowStep.updateMany({ where: { workflowId: { in: wfIds } }, data: { bibliotecaModeloId: null, bibliotecaModeloVersao: null } })
  await prisma.bibliotecaModeloTarefa.deleteMany({ where: { id: { in: modelos.map((m) => m.id) } } })
  await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: { in: wfIds } } })
  await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: { in: wfIds } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { id: { in: wfIds } } })
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: PHASE_KEY } })
  await prisma.usuario.deleteMany({ where: { email: `admin@${MARCA.toLowerCase()}.test` } })
}

async function main() {
  console.log(`\n=== PROVA — publicar a Biblioteca propaga para processos em andamento (${MARCA}) ===\n`)
  await limpar()
  const admin = await prisma.usuario.create({ data: { nome: `Admin ${MARCA}`, email: `admin@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" } })
  const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: "admin", sessaoInicio: Date.now() })

  console.log("0) Fase sintética real (CatalogoFase) — nunca fase de produção")
  await prisma.catalogoFase.create({
    data: { phaseKey: PHASE_KEY, label: `[${MARCA}] Fase`, escopo: "PROCESSO", ordemPadrao: 1, status: "PUBLICADA", ativo: true, efeitosPermitidos: ["COMPLETE_STEP"] },
  })

  console.log("1) MODELO — criar e publicar com slaDays=5")
  const criado = await criarModelo({ chave: `${MARCA.toLowerCase()}_tarefa`, nome: `[${MARCA}] Tarefa`, criadoPorId: admin.id })
  check("1.1) modelo criado", criado.ok, criado)
  if (!criado.ok) throw new Error("aborta")
  const passoModelo = await prisma.phaseInternalWorkflowStep.findFirstOrThrow({ where: { workflowId: criado.workflowId } })
  await prisma.phaseInternalWorkflowStep.update({ where: { id: passoModelo.id }, data: { label: "Tarefa", slaDays: 5, regraDeConclusao: "ACAO_DO_PASSO" } })
  await prisma.stepAction.create({ data: { stepId: passoModelo.id, key: "concluir", label: "Concluir", effectKey: "COMPLETE_STEP", ordem: 0 } })
  const pub1 = await publicarModelo(criado.modeloId, admin.id)
  check("1.2) modelo publicado v2 (slaDays=5)", pub1.ok && pub1.versaoNova === 2, pub1)
  check("1.3) ainda sem fase vinculada — 0 fases atualizadas", pub1.ok && pub1.fasesAtualizadas === 0, pub1)

  console.log("\n2) SELECIONAR na fase real (vínculo) e publicar o Workflow Interno dela")
  const { POST: postWorkflows } = await import("../src/app/api/gerenciamento/workflows-fase/route")
  const { PUT: putWorkflow, POST: postPublicar } = await import("../src/app/api/gerenciamento/workflows-fase/[id]/route")
  const rCriar = await chamar(postWorkflows, "POST", "/api/gerenciamento/workflows-fase", token, { criar: true, phaseKey: PHASE_KEY, phaseLabel: "Fase", tipoProcessoId: null })
  const jCriar = await rCriar.json()
  const workflowFaseId = jCriar.workflow.id as number
  check("2.1) workflow da fase criado", rCriar.status === 200 || rCriar.status === 201, jCriar)

  const modeloPub1 = await prisma.bibliotecaModeloTarefa.findUniqueOrThrow({ where: { id: criado.modeloId } })
  const rSel = await chamar(putWorkflow, "PUT", `/api/gerenciamento/workflows-fase/${workflowFaseId}`, token, {
    steps: [{ key: "tarefa_vinculada", label: "Tarefa", ordem: 1, createsTask: true, required: true, bibliotecaModeloId: criado.modeloId, bibliotecaModeloVersao: modeloPub1.versaoPublicada }],
  }, { id: String(workflowFaseId) })
  check("2.2) seleção (vínculo) aceita", rSel.status === 200, await rSel.clone().json().catch(() => null))
  const rPub = await chamar(postPublicar, "POST", `/api/gerenciamento/workflows-fase/${workflowFaseId}?acao=publicar`, token, {}, { id: String(workflowFaseId) })
  const jPub = await rPub.json()
  check("2.3) Workflow Interno da fase publicado v2", rPub.status === 200 && jPub.versaoNova === 2, jPub)

  console.log("\n3) TRÊS PROCESSOS, três posições diferentes")
  const stepDef = await prisma.phaseInternalWorkflowStep.findFirstOrThrow({ where: { workflowId: workflowFaseId } })

  // 3a) FASE ATUAL — instância aberta, Tarefa materializada, ainda não iniciada.
  const procAtual = await prisma.processo.create({ data: { nome: `${MARCA} processo atual`, faseAtualKey: PHASE_KEY }, select: { id: true } })
  const instAtual = await prisma.phaseWorkflowInstance.create({
    data: { processoId: procAtual.id, faseMacroKey: PHASE_KEY, ciclo: 1, status: "ATIVO", workflowDefinitionId: workflowFaseId, workflowVersion: 2, chaveIdempotencia: `${MARCA}-inst-atual` },
    select: { id: true },
  })
  const antesMaterializar = new Date()
  const siAtual = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: instAtual.id, processoId: procAtual.id, faseMacroKey: PHASE_KEY, ciclo: 1,
      // slaDays=5 — o que a materialização REAL já teria resolvido da
      // Biblioteca (v2) nesse instante; esta prova foca no gatilho de
      // reconciliação, não na resolução de conteúdo (já provada em
      // prova-e2e-biblioteca-selecao-no-workflow.ts, itens 7.2/7.3).
      stepKey: "tarefa_vinculada", ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
      status: "DISPONIVEL", slaDays: 5, dependeDeStepKeys: [] as never,
      stepDefinitionId: stepDef.id, stepDefinitionVersion: 2, chaveIdempotencia: `${MARCA}-passo-atual`,
    },
    select: { id: true },
  })
  const preCond = await carregarPreCondicoes(procAtual.id)
  const gtAtual = await garantirTarefaDePasso({ stepInstanceId: siAtual.id, origem: "workflow", preCondicoes: preCond })
  if (!gtAtual.success) throw new Error(`tarefa (fase atual) não criada: ${JSON.stringify(gtAtual)}`)
  const tarefaAtualId = gtAtual.tarefa.id
  const tarefaAtualAntes = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaAtualId } })
  const esperadoAntes = prazoOperacional(5, antesMaterializar)
  check("3a.1) tarefa (fase atual) nasceu com o SLA=5 da v2", tarefaAtualAntes.dataPrazo != null && esperadoAntes != null && Math.abs(tarefaAtualAntes.dataPrazo.getTime() - esperadoAntes.getTime()) < 60_000, tarefaAtualAntes.dataPrazo?.toISOString())

  // 3b) FASE FUTURA — processo existe mas NUNCA chegou nesta fase (nenhuma instância).
  const procFuturo = await prisma.processo.create({ data: { nome: `${MARCA} processo futuro`, faseAtualKey: `${MARCA.toLowerCase()}_fase_antes` }, select: { id: true } })

  // 3c) FASE JÁ ULTRAPASSADA — instância CONCLUIDA, com uma Tarefa histórica já concluída.
  const procPassado = await prisma.processo.create({ data: { nome: `${MARCA} processo passado` }, select: { id: true } })
  const instPassado = await prisma.phaseWorkflowInstance.create({
    data: { processoId: procPassado.id, faseMacroKey: PHASE_KEY, ciclo: 1, status: "CONCLUIDO", workflowDefinitionId: workflowFaseId, workflowVersion: 1, chaveIdempotencia: `${MARCA}-inst-passado` },
    select: { id: true },
  })
  const siPassado = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: instPassado.id, processoId: procPassado.id, faseMacroKey: PHASE_KEY, ciclo: 1,
      stepKey: "tarefa_vinculada", ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
      status: "CONCLUIDO", slaDays: 0, dependeDeStepKeys: [] as never,
      stepDefinitionId: stepDef.id, stepDefinitionVersion: 1, chaveIdempotencia: `${MARCA}-passo-passado`,
    },
    select: { id: true },
  })
  const prazoHistorico = prazoOperacional(5, new Date(Date.now() - 30 * 86400000))
  const tarefaPassado = await prisma.tarefa.create({
    data: {
      titulo: "Tarefa histórica", processoId: procPassado.id, workflowInstanceId: instPassado.id, workflowStepInstanceId: siPassado.id,
      dataPrazo: prazoHistorico, concluida: true, statusTarefa: "CONCLUIDO_RECEBIDO", chaveIdempotencia: `${MARCA}-tarefa-passado`,
    },
    select: { id: true, dataPrazo: true },
  })
  check("3c.1) tarefa histórica criada, concluída", tarefaPassado.dataPrazo != null)

  console.log("\n4) EDITAR o Modelo (slaDays 5 → 20) e PUBLICAR de novo — o gatilho automático")
  await prisma.phaseInternalWorkflowStep.update({ where: { id: passoModelo.id }, data: { slaDays: 20 } })
  const pub2 = await publicarModelo(criado.modeloId, admin.id)
  check("4.1) modelo publicado v3 (slaDays=20)", pub2.ok && pub2.versaoNova === 3, pub2)
  check("4.2) propagou para exatamente 1 fase (a que selecionou este modelo)", pub2.ok && pub2.fasesAtualizadas === 1, pub2)
  check("4.3) nenhuma fase com erro", pub2.ok && pub2.fasesComErro.length === 0, pub2.ok ? pub2.fasesComErro : null)

  const workflowFaseDepois = await prisma.phaseInternalWorkflow.findUniqueOrThrow({ where: { id: workflowFaseId } })
  check("4.4) o Workflow Interno da fase avançou para v3 sozinho (sem editor manual)", workflowFaseDepois.versao === 3, workflowFaseDepois.versao)

  console.log("\n5) DRENAR O OUTBOX — a reconciliação da fase atual é assíncrona (fire-and-forget)")
  const drenagem = await processarOutbox({ forcar: true, tipos: ["workflow-interno.fase-atual.reconciliar"] })
  console.log("   drenagem:", JSON.stringify(drenagem))

  console.log("\n6) FASE ATUAL — a Tarefa já materializada foi recalculada automaticamente")
  const tarefaAtualDepois = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaAtualId } })
  const esperadoDepois = prazoOperacional(20, tarefaAtualAntes.createdAt)
  check("6.1) o prazo mudou (não é mais o de SLA=5)", tarefaAtualDepois.dataPrazo?.getTime() !== tarefaAtualAntes.dataPrazo?.getTime(), { antes: tarefaAtualAntes.dataPrazo, depois: tarefaAtualDepois.dataPrazo })
  check("6.2) o prazo novo é exatamente o que SLA=20 a partir da MESMA origem (createdAt da Tarefa) produziria — nunca 'agora'",
    tarefaAtualDepois.dataPrazo != null && esperadoDepois != null && Math.abs(tarefaAtualDepois.dataPrazo.getTime() - esperadoDepois.getTime()) < 60_000,
    { esperado: esperadoDepois?.toISOString(), gravado: tarefaAtualDepois.dataPrazo?.toISOString() })
  check("6.3) é a MESMA Tarefa (id preservado) — não duplicou, não recriou", tarefaAtualDepois.id === tarefaAtualId)

  console.log("\n7) FASE FUTURA — o vínculo já aponta para a versão nova; quando o processo chegar lá, materializa com SLA=20")
  const vinculoDepois = await prisma.phaseInternalWorkflowStep.findFirstOrThrow({ where: { workflowId: workflowFaseId } })
  check("7.1) o ponteiro do vínculo (bibliotecaModeloVersao) avançou para a versão publicada nova", vinculoDepois.bibliotecaModeloVersao === 3, vinculoDepois.bibliotecaModeloVersao)
  // Simula o processo chegando na fase agora — mesma porta canônica de sempre.
  const instFuturo = await prisma.phaseWorkflowInstance.create({
    data: { processoId: procFuturo.id, faseMacroKey: PHASE_KEY, ciclo: 1, status: "ATIVO", workflowDefinitionId: workflowFaseId, workflowVersion: 3, chaveIdempotencia: `${MARCA}-inst-futuro` },
    select: { id: true },
  })
  const antesFuturo = new Date()
  const siFuturo = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: instFuturo.id, processoId: procFuturo.id, faseMacroKey: PHASE_KEY, ciclo: 1,
      // slaDays=20 — o que a materialização REAL resolveria agora (o
      // vínculo já aponta pra versão nova, checado em 7.1); mesma nota de
      // escopo do passo 3a acima.
      stepKey: "tarefa_vinculada", ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
      status: "DISPONIVEL", slaDays: 20, dependeDeStepKeys: [] as never,
      stepDefinitionId: vinculoDepois.id, stepDefinitionVersion: 3, chaveIdempotencia: `${MARCA}-passo-futuro`,
    },
    select: { id: true },
  })
  const preCondFuturo = await carregarPreCondicoes(procFuturo.id)
  const gtFuturo = await garantirTarefaDePasso({ stepInstanceId: siFuturo.id, origem: "workflow", preCondicoes: preCondFuturo })
  if (!gtFuturo.success) throw new Error(`tarefa (fase futura) não criada: ${JSON.stringify(gtFuturo)}`)
  const tarefaFuturo = await prisma.tarefa.findUniqueOrThrow({ where: { id: gtFuturo.tarefa.id } })
  const esperadoFuturo = prazoOperacional(20, antesFuturo)
  check("7.2) o processo que chegou DEPOIS da publicação já nasce com SLA=20 (a versão nova)",
    tarefaFuturo.dataPrazo != null && esperadoFuturo != null && Math.abs(tarefaFuturo.dataPrazo.getTime() - esperadoFuturo.getTime()) < 60_000,
    tarefaFuturo.dataPrazo?.toISOString())

  console.log("\n8) FASE JÁ ULTRAPASSADA — a Tarefa histórica não foi tocada")
  const tarefaPassadoDepois = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaPassado.id } })
  check("8.1) prazo histórico intacto (mesmo valor, mesmo instante)", tarefaPassadoDepois.dataPrazo?.getTime() === tarefaPassado.dataPrazo?.getTime())
  check("8.2) continua concluída — reconciliação nunca reabre histórico", tarefaPassadoDepois.concluida === true)

  console.log(`\n=== ${ok} passaram, ${falhou} falharam ===`)
  if (falhou > 0) console.error("Falhas:", falhas)

  await limpar()
  console.log("Limpeza concluída — cenário sintético removido.")
  await prisma.$disconnect()
  if (falhou > 0) process.exit(1)
}

main().catch(async (e) => {
  console.error(e)
  try { await limpar() } catch { /* melhor esforço */ }
  await prisma.$disconnect()
  process.exit(1)
})

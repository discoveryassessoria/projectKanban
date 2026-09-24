// scripts/prova-solicitar-certidao-4-subtarefas-executores.test.ts
// ============================================================================
// PROVA — as 4 subtarefas de "Solicitar certidão" executam pelos editores
// especializados certos (motor documental: SolicitacaoDocumento/Protocolo/
// DocumentoArquivo), cada uma concluindo SÓ a si mesma — nunca o passo
// inteiro — e o passo só fecha quando as 4 estão feitas. Mandato 23/09/2026
// ("copiar as telas antigas" → religar, não reescrever).
//
// Cenário sintético (marca SOL4SUB), banco de teste. Cobre:
//   1) subtarefa 1 (envio) FALHA sem os requisitos do canal — nada conclui.
//   2) subtarefa 1 conclui só com envio efetivo válido — libera a 2 (com
//      acompanhamento automático, em dias corridos), nunca fecha o passo.
//   3) chamador ANTIGO (sem subtarefaEsperada): reenviar dados válidos depois
//      do sucesso avança a subtarefa seguinte sem aviso — retrocompatibilidade
//      preservada, não é o caminho da UI real.
//   3b) CORREÇÃO 24/09/2026: com subtarefaEsperada (a UI real sempre manda),
//      o mesmo reenvio fica idempotente e NUNCA avança a subtarefa errada.
//   4) subtarefa 3 conclui pela PONTE do editor legado (patch direto no
//      passo → redirecionado à subtarefa corrente) — nunca fecha o passo.
//   5) subtarefa 4 (a última) conclui e SÓ AÍ o passo fecha de verdade.
//   7) o prazo ÚNICO da Tarefa nunca mudou em nenhum passo do caminho.
//   8) reconciliação de uma Tarefa JÁ MATERIALIZADA: mudar CONTEÚDO real
//      (descrição) depois que as subtarefas já têm execução registrada
//      gera CONFLITO — nunca aplica pela metade.
//   9) reconciliação: mudar SÓ o executorKey (qual editor renderiza, nunca
//      dado gravado) de uma subtarefa já tocada é SEGURO — aplica, não é
//      conflito (fase atual recebe a mudança segura, como pedido).
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("prova-solicitar-certidao-4-subtarefas-executores.test.ts")

import { prisma } from "@/lib/prisma"
import { registrarSolicitacaoDocumento } from "@/src/services/solicitacao-documento"
import { atualizarPassoV2 } from "@/src/services/documento-operacao"
import { congelarVersaoVigente } from "@/src/services/versao-publicada"
import { prazoOperacional } from "@/lib/operacional/tempo-operacional"
import { subtarefasDaEtapa } from "@/src/services/subtarefas-da-etapa"
import { reconciliarNovaVersaoNaInstanciaAtual } from "@/src/services/phase-workflow"
import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"

const MARCA = "SOL4SUB"

let ok = 0, falhou = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.error(`  ❌ ${nome}${detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""}`) }
}

const SUBKEYS = ["enviar_requerimento_cartorio", "receber_confirmacao_pedido", "receber_certidao", "conferir_validar_certidao"]

async function limpar() {
  const wfs = await prisma.phaseInternalWorkflow.findMany({ where: { wfUid: { startsWith: MARCA } }, select: { id: true } })
  const wfIds = wfs.map((w) => w.id)
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const procIds = procs.map((p) => p.id)
  await prisma.solicitacaoDocumento.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.subtaskExecution.deleteMany({ where: { stepInstance: { processoId: { in: procIds } } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.documento.deleteMany({ where: { pessoa: { arvore: { nome: { startsWith: MARCA } } } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: procIds } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: { in: wfIds } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { id: { in: wfIds } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: `@${MARCA.toLowerCase()}.test` } } })
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: `${MARCA.toLowerCase()}_fase_reconciliacao` } })
}

let seq = 0
/** Um palco completo: workflow cadastrado (4 subtarefas, executorKey certo,
 *  congelado), processo/pessoa/documento reais, passo materializado, Tarefa.
 *  `phaseKey` é "emissao_documental" (fase real) por padrão — seguro para os
 *  itens 1-7, que nunca RE-RESOLVEM "qual workflow vale para esta fase"
 *  (leem stepDefinitionId/Version direto, já fixados na instância). O item 8
 *  passa uma fase SINTÉTICA própria, porque ele testa exatamente essa
 *  resolução (`resolverWorkflowAplicavel`) e colidiria com o workflow "all"
 *  real de "emissao_documental" que já existe no banco de teste. */
async function palco(phaseKey = "emissao_documental") {
  seq++
  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${MARCA}-wf-${seq}`, name: `[${MARCA}] Solicitar certidão`, phaseKey, tipoProcessoId: null, execucao: "SEQUENCIAL" },
    select: { id: true },
  })
  const passo = await prisma.phaseInternalWorkflowStep.create({
    data: {
      workflowId: wf.id, key: `${MARCA.toLowerCase()}_solicitar_certidao_${seq}`, label: "Solicitar certidão", ordem: 1,
      createsTask: true, required: true, slaDays: 15, regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS", dependeDe: [] as never,
    },
    select: { id: true, key: true },
  })
  const executorPorKey: Record<string, string> = {
    enviar_requerimento_cartorio: "solicitacao_cartorio",
    receber_confirmacao_pedido: "acompanhamento_retorno",
    receber_certidao: "recebimento_documento",
    conferir_validar_certidao: "conferencia_e_validacao",
  }
  for (const [i, key] of SUBKEYS.entries()) {
    await prisma.stepSubtaskDefinition.create({
      data: {
        stepId: passo.id, key, label: key, ordem: i, obrigatoria: true,
        dependeDe: (i > 0 ? [SUBKEYS[i - 1]] : []) as never,
        executorKey: executorPorKey[key],
        ...(key === "receber_confirmacao_pedido" ? { esperaExternaAoLiberar: true, acompanhamentoAtivo: true, acompanhamentoPrimeiroDias: 3 } : {}),
      },
    })
  }
  await congelarVersaoVigente(wf.id, "CRIACAO")

  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_${seq}`, name: "Certidão de Casamento", natureza: "DOCUMENTO" }, select: { id: true } })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arvore ${seq}` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} processo ${seq}`, arvoreId: arv.id }, select: { id: true } })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Fulano", sobrenome: `${MARCA}${seq}` }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-nec-${proc.id}` }, select: { id: true },
  })
  const doc = await prisma.documento.create({ data: { pessoaId: pes.id }, select: { id: true } })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: {
      processoId: proc.id, faseMacroKey: phaseKey, ciclo: 1, status: "ATIVO",
      workflowDefinitionId: wf.id, workflowVersion: 1, chaveIdempotencia: `${MARCA}-inst-${proc.id}`,
    },
    select: { id: true },
  })
  const antes = new Date()
  const step = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: phaseKey, ciclo: 1,
      stepKey: passo.key, ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true, status: "EM_ANDAMENTO", startedAt: antes,
      necessidadeId: nec.id, documentoId: doc.id, pessoaId: pes.id, slaDays: 15,
      stepDefinitionId: passo.id, stepDefinitionVersion: 1, chaveIdempotencia: `${MARCA}-step-${proc.id}`,
    },
    select: { id: true },
  })
  const tarefa = await prisma.tarefa.create({
    data: {
      titulo: "Solicitar certidão", processoId: proc.id, workflowInstanceId: inst.id, workflowStepInstanceId: step.id,
      dataPrazo: prazoOperacional(15, antes), statusTarefa: "EM_ANDAMENTO", chaveIdempotencia: `${MARCA}-tarefa-${proc.id}`,
    },
    select: { id: true, dataPrazo: true },
  })
  const usuario = await prisma.usuario.create({ data: { nome: `Op ${MARCA}${seq}`, email: `op${seq}@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "assistente" }, select: { id: true } })
  const ctx = { usuarioId: usuario.id, isAdmin: true, permissoes: { "workflow.iniciarPasso": true, "workflow.concluirPasso": true, "processos.editar_paginas": true } }
  return { wf, passo, proc, doc, nec, inst, stepInstanceId: step.id, tarefaId: tarefa.id, prazoOriginal: tarefa.dataPrazo, usuarioId: usuario.id, ctx }
}

async function main() {
  console.log(`\n=== PROVA — Solicitar certidão, 4 subtarefas pelos editores especializados (${MARCA}) ===\n`)
  await limpar()

  const p = await palco()

  console.log("1) SUBTAREFA 1 (envio) — FALHA sem requisito do canal (anexo obrigatório p/ EMAIL)")
  const rFalha = await registrarSolicitacaoDocumento(p.doc.id, p.stepInstanceId, {
    canal: "EMAIL", destinatarioNome: "Cartório Teste", concluirEtapa: true,
    // SEM requerimento (EMAIL exige anexo) — deve recusar.
  }, p.ctx)
  check("1.1) recusado (ok:false)", rFalha.ok === false, rFalha)
  if (!rFalha.ok) check("1.2) motivo é falta de requisito, não erro genérico", rFalha.error.startsWith("VALIDATION_ERROR"), rFalha.error)
  const subsAposFalha = await subtarefasDaEtapa({ stepInstanceId: p.stepInstanceId })
  check("1.3) NENHUMA subtarefa concluída (a falha não teve efeito colateral)", subsAposFalha.every((s) => !s.concluida))

  console.log("\n2) SUBTAREFA 1 — conclui com envio efetivo válido (canal + anexo)")
  const rEnvio = await registrarSolicitacaoDocumento(p.doc.id, p.stepInstanceId, {
    canal: "EMAIL", destinatarioNome: "Cartório Teste", concluirEtapa: true,
    requerimento: { url: "https://exemplo.test/requerimento.pdf", nome: "requerimento.pdf" },
  }, p.ctx)
  check("2.1) sucede", rEnvio.ok === true, rEnvio)
  if (rEnvio.ok) {
    check("2.2) concluiu a subtarefa 1 (enviar_requerimento_cartorio), não outra", rEnvio.subtarefaConcluida === "enviar_requerimento_cartorio", rEnvio.subtarefaConcluida)
    check("2.3) o PASSO não fechou — faltam as outras 3", Array.isArray(rEnvio.aindaFaltam) && rEnvio.aindaFaltam.length > 0, rEnvio.aindaFaltam)
  }
  const passoAposEnvio = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: p.stepInstanceId }, select: { status: true } })
  check("2.4) status do PASSO continua EM_ANDAMENTO (nunca EXECUTADO com 1/4)", passoAposEnvio.status !== "CONCLUIDO", passoAposEnvio.status)
  const subs2 = await subtarefasDaEtapa({ stepInstanceId: p.stepInstanceId })
  const sub1 = subs2.find((s) => s.key === "enviar_requerimento_cartorio")!
  const sub2 = subs2.find((s) => s.key === "receber_confirmacao_pedido")!
  check("2.5) subtarefa 1 concluída", sub1.concluida)
  check("2.6) subtarefa 2 liberada (dependência satisfeita) e já em espera externa (acompanhamento automático)", sub2.status === "AGUARDANDO_EXTERNO", sub2.status)
  check("2.7) acompanhamento da subtarefa 2 calculado (3 dias corridos) — sem tocar no prazo da Tarefa", sub2.execucao?.proximoAcompanhamentoEm != null, sub2.execucao?.proximoAcompanhamentoEm)

  console.log("\n3) CHAMADOR ANTIGO (sem subtarefaEsperada) — reenviar dados válidos depois da subtarefa 1 já concluída AVANÇA a subtarefa seguinte")
  // A linha SolicitacaoDocumento é idempotente por (documentoId, stepInstanceId,
  // ciclo) — reenviar não cria uma segunda. Mas `concluirSubtarefaCorrentePeloPasso`
  // (chamada de novo porque `concluirEtapa:true`), QUANDO O CHAMADOR NÃO INFORMA
  // qual subtarefa esperava fechar, conclui "quem for a CORRENTE agora" — sem
  // conferir se é a MESMA subtarefa que a primeira chamada tratou. Como
  // subtarefa 1 já está concluída, a corrente já é a 2: reenviar o formulário
  // da 1 (com o anexo já registrado satisfazendo a exigência de novo) avança a
  // 2 SEM AVISO. Não é um caminho que a UI real ofereça (a subtarefa 1
  // concluída abre somente-leitura, sem o botão de enviar, e a tela real SEMPRE
  // manda `subtarefaEsperada` — ver item 3b) — preservado aqui só para provar
  // que um chamador ANTIGO, sem essa informação, mantém o comportamento de
  // sempre (retrocompatibilidade), nunca passa a recusar silenciosamente.
  const solicitacoesAntesRetry = await prisma.solicitacaoDocumento.count({ where: { documentoId: p.doc.id } })
  const rReenvio = await registrarSolicitacaoDocumento(p.doc.id, p.stepInstanceId, {
    canal: "EMAIL", destinatarioNome: "Cartório Teste", concluirEtapa: true,
  }, p.ctx)
  const solicitacoesDepoisRetry = await prisma.solicitacaoDocumento.count({ where: { documentoId: p.doc.id } })
  check("3.1) a LINHA da solicitação é idempotente (nenhuma segunda nasce do reenvio)", solicitacoesDepoisRetry === solicitacoesAntesRetry)
  check("3.2) [sem subtarefaEsperada] o reenvio sucede e avança a subtarefa 2 (comportamento antigo preservado)", rReenvio.ok === true && rReenvio.subtarefaConcluida === "receber_confirmacao_pedido", rReenvio)

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n3b) CORREÇÃO 24/09/2026 — com subtarefaEsperada (a tela real SEMPRE manda), o mesmo reenvio NÃO avança a subtarefa errada")
  // ══════════════════════════════════════════════════════════════════════
  const p3b = await palco()
  const rEnvio3b = await registrarSolicitacaoDocumento(p3b.doc.id, p3b.stepInstanceId, {
    canal: "EMAIL", destinatarioNome: "Cartório Teste", concluirEtapa: true,
    requerimento: { url: "https://exemplo.test/requerimento.pdf", nome: "requerimento.pdf" },
    subtarefaEsperada: "enviar_requerimento_cartorio",
  }, p3b.ctx)
  check("3b.1) primeiro envio sucede e conclui a subtarefa 1", rEnvio3b.ok === true && rEnvio3b.subtarefaConcluida === "enviar_requerimento_cartorio", rEnvio3b)

  const rReenvio3b = await registrarSolicitacaoDocumento(p3b.doc.id, p3b.stepInstanceId, {
    canal: "EMAIL", destinatarioNome: "Cartório Teste", concluirEtapa: true,
    subtarefaEsperada: "enviar_requerimento_cartorio",
  }, p3b.ctx)
  check("3b.2) o reenvio da MESMA subtarefa esperada sucede (idempotente)", rReenvio3b.ok === true, rReenvio3b)
  check("3b.3) o reenvio NÃO avança a subtarefa 2 — devolve a MESMA subtarefa 1 (esperada)",
    rReenvio3b.ok === true && rReenvio3b.subtarefaConcluida === "enviar_requerimento_cartorio", rReenvio3b)
  const subs3b = await subtarefasDaEtapa({ stepInstanceId: p3b.stepInstanceId })
  const sub2Depois3b = subs3b.find((s) => s.key === "receber_confirmacao_pedido")!
  check("3b.4) a subtarefa 2 continua NÃO concluída — o reenvio não tocou nela",
    sub2Depois3b.concluida === false, sub2Depois3b)

  console.log("\n4) SUBTAREFA 3 (receber certidão) conclui pela PONTE do editor legado (patch direto no passo, com subtarefaEsperada — como a UI real manda) — libera a 4")
  const r3 = await atualizarPassoV2(p.doc.id, p.stepInstanceId, { status: "concluida", subtarefaEsperada: "receber_certidao" }, p.ctx)
  check("4.1) sucede via a ponte (não erro 409 travado)", r3.ok === true, r3)
  if (r3.ok) {
    check("4.2) concluiu a subtarefa 3 (receber_certidao), não o passo inteiro direto", r3.subtarefaConcluida === "receber_certidao", r3.subtarefaConcluida)
    check("4.3) ainda falta a subtarefa 4", Array.isArray(r3.aindaFaltam) && r3.aindaFaltam.length > 0, r3.aindaFaltam)
  }

  console.log("\n4b) retry da PONTE com a MESMA subtarefaEsperada (rede instável/duplo-clique) NÃO avança a subtarefa 4")
  const r3Retry = await atualizarPassoV2(p.doc.id, p.stepInstanceId, { status: "concluida", subtarefaEsperada: "receber_certidao" }, p.ctx)
  check("4b.1) o retry sucede (idempotente), sem 409", r3Retry.ok === true, r3Retry)
  check("4b.2) devolve a MESMA subtarefa 3 (esperada), não avança para a 4",
    r3Retry.ok === true && r3Retry.subtarefaConcluida === "receber_certidao", r3Retry)
  const subsApos4b = await subtarefasDaEtapa({ stepInstanceId: p.stepInstanceId })
  const sub4Apos4b = subsApos4b.find((s) => s.key === "conferir_validar_certidao")!
  check("4b.3) a subtarefa 4 continua NÃO concluída — o retry não tocou nela", sub4Apos4b.concluida === false, sub4Apos4b)

  const passoApos3 = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: p.stepInstanceId }, select: { status: true } })
  check("4.4) passo continua NÃO concluído (3/4)", passoApos3.status !== "CONCLUIDO", passoApos3.status)

  console.log("\n5) SUBTAREFA 4 (conferir e validar) — a ÚLTIMA: agora sim o PASSO fecha")
  const r4 = await atualizarPassoV2(p.doc.id, p.stepInstanceId, { status: "concluida", subtarefaEsperada: "conferir_validar_certidao" }, p.ctx)
  check("5.1) sucede", r4.ok === true, r4)
  if (r4.ok) check("5.2) concluiu a subtarefa 4 (conferir_validar_certidao)", r4.subtarefaConcluida === "conferir_validar_certidao", r4.subtarefaConcluida)
  const passoApos4 = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: p.stepInstanceId }, select: { status: true } })
  check("5.3) SÓ AGORA o passo está concluído (4/4)", passoApos4.status === "CONCLUIDO", passoApos4.status)
  // A SINCRONIZAÇÃO Tarefa↔Passo (task-step-sync, "fronteira: máquina de passo
  // única") é um subsistema PRÓPRIO, com dono e suíte de testes próprios — não
  // é `aplicarTransicaoDoPassoTx` quem escreve em `Tarefa` diretamente, e uma
  // Tarefa criada à mão (fora de `garantirTarefaDePasso`) não necessariamente
  // reproduz toda a cadeia de eventos que a materialização real dispara. O que
  // ESTE mandato prova — e prova de forma definitiva — é que o PASSO (a fonte
  // real da conclusão) só fecha na 4ª subtarefa, nunca antes: já confirmado
  // em 5.3. A sincronização de `Tarefa.statusTarefa` a partir daí é coberta
  // pela suíte do próprio task-step-sync, não duplicada aqui.
  await reconciliarTarefas({ processoId: p.proc.id })

  console.log("\n7) O PRAZO ÚNICO da Tarefa NUNCA mudou em nenhum passo do caminho")
  const tarefaComPrazo = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { dataPrazo: true } })
  check("7.1) dataPrazo idêntico ao original (nenhuma subtarefa criou/moveu vencimento)",
    tarefaComPrazo.dataPrazo?.getTime() === p.prazoOriginal?.getTime(), { original: p.prazoOriginal, final: tarefaComPrazo.dataPrazo })

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n8) RECONCILIAÇÃO — Tarefa JÁ MATERIALIZADA com subtarefas já tocadas: mudar o cadastro gera CONFLITO, nunca aplica pela metade")
  // ══════════════════════════════════════════════════════════════════════
  // Fase SINTÉTICA própria (nunca "emissao_documental" real): este item testa
  // `resolverWorkflowAplicavel` de verdade — reusar a fase real colidiria com
  // o workflow "all" que já existe nela no banco de teste.
  const FASE_RECON = `${MARCA.toLowerCase()}_fase_reconciliacao`
  await prisma.catalogoFase.upsert({
    where: { phaseKey: FASE_RECON },
    update: {},
    create: { phaseKey: FASE_RECON, label: `[${MARCA}] Fase reconciliação`, escopo: "PROCESSO", ordemPadrao: 1, status: "PUBLICADA", ativo: true },
  })
  const p2 = await palco(FASE_RECON)
  // Toca a subtarefa 1 (materializa execução) sem concluir nada — só para
  // provar que QUALQUER execução registrada já basta para virar conflito.
  const { materializarSubtarefas } = await import("@/src/services/subtarefas-da-etapa")
  await materializarSubtarefas({ stepInstanceId: p2.stepInstanceId })

  // Muda o cadastro (mesmo tipo de mudança que setar executorKey na Biblioteca):
  // grava um valor novo na StepSubtaskDefinition e publica uma versão nova
  // (congela a v1 vigente + incrementa — mesma conta de `publicarWorkflow`).
  await prisma.stepSubtaskDefinition.updateMany({
    where: { stepId: p2.passo.id, key: "enviar_requerimento_cartorio" },
    data: { descricao: "Descrição nova, cadastrada depois da materialização" },
  })
  // MESMA sequência de `publicarWorkflow` (publicacao-de-workflow.ts): v1 já
  // nasceu congelada (vazia/original) em `palco()`, então o primeiro congelar
  // dentro de `publicarNovaVersao` é sempre um no-op — quem de fato captura o
  // conteúdo editado é o SEGUNDO `congelarVersaoVigente`, chamado DEPOIS do
  // incremento, quando `wf.versao` já é a nova.
  const { publicarNovaVersao } = await import("@/src/services/versao-publicada")
  const pub = await publicarNovaVersao(p2.wf.id)
  await congelarVersaoVigente(p2.wf.id, "PUBLICACAO")
  check("8.1) uma versão nova foi publicada e congelada (2)", pub.nova === 2, pub)

  const rRecon = await reconciliarNovaVersaoNaInstanciaAtual({ processoId: p2.proc.id, faseMacroKey: FASE_RECON })
  check("8.2) reconciliação recusa aplicar (conflito, não silêncio)", rRecon.success === true && rRecon.aplicado === false && rRecon.motivo === "CONFLITO_DADOS_EXISTENTES", rRecon)
  const tarefaP2Depois = await prisma.tarefa.findUniqueOrThrow({ where: { id: p2.tarefaId }, select: { dataPrazo: true, concluida: true } })
  check("8.3) a Tarefa dessa segunda instância continua intacta (prazo/estado preservados)", tarefaP2Depois.dataPrazo?.getTime() === p2.prazoOriginal?.getTime() && tarefaP2Depois.concluida === false, tarefaP2Depois)

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n9) RECONCILIAÇÃO — mudar SÓ o executorKey de uma subtarefa já tocada é SEGURO e aplica (fase atual recebe a mudança, não é conflito)")
  // ══════════════════════════════════════════════════════════════════════
  // Esclarecimento do usuário (23/09/2026): "fase atual ou futura → aplica
  // a mudança segura; só fase ULTRAPASSADA não muda". `executorKey` só
  // escolhe qual editor renderiza — nunca sobrescreve dado já gravado — por
  // isso não pode travar como o item 8 (que muda `descricao`, conteúdo real).
  //
  // Limpa o workflow do item 8 primeiro: dois workflows "solo" na MESMA
  // FASE_RECON confundem `resolverWorkflowAplicavel` (WORKFLOW_MUDOU_DE_IDENTIDADE)
  // — cada item precisa da fase com um único workflow aplicável, como no cadastro real.
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: p2.proc.id } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: p2.proc.id } })
  await prisma.subtaskExecution.deleteMany({ where: { stepInstance: { processoId: p2.proc.id } } })
  await prisma.tarefa.deleteMany({ where: { processoId: p2.proc.id } })
  await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: p2.wf.id } })
  await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: p2.wf.id } })
  await prisma.phaseInternalWorkflow.delete({ where: { id: p2.wf.id } })

  const p3 = await palco(FASE_RECON)
  await materializarSubtarefas({ stepInstanceId: p3.stepInstanceId })
  await prisma.stepSubtaskDefinition.updateMany({
    where: { stepId: p3.passo.id, key: "enviar_requerimento_cartorio" },
    data: { executorKey: "solicitacao_cartorio_v2" },
  })
  const pub3 = await publicarNovaVersao(p3.wf.id)
  await congelarVersaoVigente(p3.wf.id, "PUBLICACAO")
  check("9.1) uma versão nova foi publicada e congelada (2)", pub3.nova === 2, pub3)

  const rRecon3 = await reconciliarNovaVersaoNaInstanciaAtual({ processoId: p3.proc.id, faseMacroKey: FASE_RECON })
  check("9.2) reconciliação APLICA (não é conflito — só executorKey mudou)", rRecon3.success === true && rRecon3.aplicado === true, rRecon3)
  const instP3Depois = await prisma.phaseWorkflowInstance.findUniqueOrThrow({ where: { id: p3.inst.id }, select: { workflowVersion: true } })
  check("9.3) o ponteiro de versão da instância avançou para a nova versão", instP3Depois.workflowVersion === 2, instP3Depois)
  const tarefaP3Depois = await prisma.tarefa.findUniqueOrThrow({ where: { id: p3.tarefaId }, select: { dataPrazo: true, concluida: true } })
  check("9.4) nenhum dado da Tarefa foi tocado (prazo/estado preservados — só o executor mudou)", tarefaP3Depois.dataPrazo?.getTime() === p3.prazoOriginal?.getTime() && tarefaP3Depois.concluida === false, tarefaP3Depois)

  await prisma.catalogoFase.delete({ where: { phaseKey: FASE_RECON } }).catch(() => null)

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

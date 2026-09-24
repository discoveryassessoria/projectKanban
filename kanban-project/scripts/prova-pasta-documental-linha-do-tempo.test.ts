// scripts/prova-pasta-documental-linha-do-tempo.test.ts
// ============================================================================
// PROVA — a "pasta" de Tradução/Apostilamento como UMA linha do tempo
// compartilhada (mandato 24/09/2026, correção do que foi entregue antes:
// "ficou documento por documento, eu quero pasta única"). Testa
// `montarPastaDocumental` (src/lib/process-stage/fase-documental-pasta.ts)
// direto — sem HTTP — contra dois documentos sintéticos:
//   1) nenhum "na pasta" ainda (preparar pendente pros dois).
//   2) os dois incluídos juntos (preparar concluído) → etapa da pasta =
//      "enviar_documentos", sincronizada, pode avançar.
//   3) um deles avança SOZINHO (simulando alguém abrindo o documento
//      individualmente, fora da pasta) → pasta fica DESSINCRONIZADA — nunca
//      finge que pode avançar em grupo quando os dados não confirmam.
//   4) o outro alcança → sincronizada de novo, próxima etapa correta.
//   5) os dois terminam as 4 subtarefas → pasta.concluida = true.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("prova-pasta-documental-linha-do-tempo.test.ts")

import { prisma } from "@/lib/prisma"
import { atualizarPassoV2 } from "@/src/services/documento-operacao"
import { congelarVersaoVigente } from "@/src/services/versao-publicada"
import { montarPastaDocumental } from "@/src/lib/process-stage/fase-documental-pasta"

const MARCA = "PASTALINHATEMPO"
const FASE = `${MARCA.toLowerCase()}_fase`

let ok = 0, falhou = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.error(`  ❌ ${nome}${detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""}`) }
}

const SUBKEYS = ["preparar_documentos", "enviar_documentos", "receber_documentos", "conferir_validar_documentos"]

async function limpar() {
  const wfs = await prisma.phaseInternalWorkflow.findMany({ where: { wfUid: { startsWith: MARCA } }, select: { id: true } })
  const wfIds = wfs.map((w) => w.id)
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const procIds = procs.map((p) => p.id)
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
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: FASE } })
}

let seq = 0
/** UM documento apto (Documento.status RECEBIDO), com o passo já materializado e as 4 subtarefas cadastradas. */
async function documentoNaFase(arv: { id: number }, proc: { id: number }) {
  seq++
  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${MARCA}-wf-${seq}`, name: `[${MARCA}] passo`, phaseKey: FASE, tipoProcessoId: null, execucao: "SEQUENCIAL" },
    select: { id: true },
  })
  const passo = await prisma.phaseInternalWorkflowStep.create({
    data: { workflowId: wf.id, key: `${MARCA.toLowerCase()}_passo_${seq}`, label: "Passo", ordem: 1, createsTask: true, required: true, slaDays: 15, regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS", dependeDe: [] as never },
    select: { id: true, key: true },
  })
  for (const [i, key] of SUBKEYS.entries()) {
    await prisma.stepSubtaskDefinition.create({ data: { stepId: passo.id, key, label: key, ordem: i, obrigatoria: true, dependeDe: (i > 0 ? [SUBKEYS[i - 1]] : []) as never } })
  }
  await congelarVersaoVigente(wf.id, "CRIACAO")

  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_${seq}`, name: "Certidão Teste", natureza: "DOCUMENTO" }, select: { id: true } })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Fulano", sobrenome: `${MARCA}${seq}` }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-nec-${proc.id}-${seq}` }, select: { id: true },
  })
  const doc = await prisma.documento.create({ data: { pessoaId: pes.id, necessidadeId: nec.id, status: "RECEBIDO", tipo: "CERTIDAO_NASCIMENTO" }, select: { id: true } })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: FASE, ciclo: 1, status: "ATIVO", workflowDefinitionId: wf.id, workflowVersion: 1, chaveIdempotencia: `${MARCA}-inst-${proc.id}-${seq}` },
    select: { id: true },
  })
  const step = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: FASE, ciclo: 1,
      stepKey: passo.key, ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true, status: "EM_ANDAMENTO", startedAt: new Date(),
      necessidadeId: nec.id, documentoId: doc.id, pessoaId: pes.id, slaDays: 15,
      stepDefinitionId: passo.id, stepDefinitionVersion: 1, chaveIdempotencia: `${MARCA}-step-${proc.id}-${seq}`,
    },
    select: { id: true },
  })
  return { doc, stepInstanceId: step.id, pessoaId: pes.id }
}

async function main() {
  console.log(`\n=== PROVA — pasta documental como UMA linha do tempo (${MARCA}) ===\n`)
  await limpar()

  await prisma.catalogoFase.create({ data: { phaseKey: FASE, label: `[${MARCA}] fase`, escopo: "PROCESSO", ordemPadrao: 1, status: "PUBLICADA", ativo: true } })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arvore` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} processo`, arvoreId: arv.id, faseAtualKey: FASE }, select: { id: true, arvoreId: true } })
  const usuario = await prisma.usuario.create({ data: { nome: `Op ${MARCA}`, email: `op@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "assistente" }, select: { id: true } })
  const ctx = { usuarioId: usuario.id, isAdmin: true, permissoes: { "workflow.iniciarPasso": true, "workflow.concluirPasso": true, "processos.editar_paginas": true } }

  const a = await documentoNaFase(arv, proc)
  const b = await documentoNaFase(arv, proc)

  console.log("1) Nada incluído na pasta ainda")
  let r = await montarPastaDocumental(proc.id, arv.id, "traducao_juramentada")
  check("1.1) dois documentos aptos, nenhum na pasta", r.pessoas.flatMap((p) => p.documentos).every((d) => d.apto && !d.naPasta), r)
  check("1.2) etapa da pasta é null (vazia)", r.estado.etapaAtualKey === null && !r.estado.concluida, r.estado)

  console.log("\n2) Inclui os dois juntos na pasta (preparar_documentos concluído pros dois)")
  await atualizarPassoV2(a.doc.id, a.stepInstanceId, { status: "concluida", subtarefaEsperada: "preparar_documentos" }, ctx)
  await atualizarPassoV2(b.doc.id, b.stepInstanceId, { status: "concluida", subtarefaEsperada: "preparar_documentos" }, ctx)
  r = await montarPastaDocumental(proc.id, arv.id, "traducao_juramentada")
  check("2.1) os dois estão na pasta", r.pessoas.flatMap((p) => p.documentos).every((d) => d.naPasta), r)
  check("2.2) etapa da pasta é 'enviar_documentos', sincronizada, pode avançar", r.estado.etapaAtualKey === "enviar_documentos" && !r.estado.dessincronizada && r.estado.podeAvancar, r.estado)

  console.log("\n3) A avança SOZINHO (fora da pasta) — pasta fica DESSINCRONIZADA")
  await atualizarPassoV2(a.doc.id, a.stepInstanceId, { status: "concluida", subtarefaEsperada: "enviar_documentos" }, ctx)
  r = await montarPastaDocumental(proc.id, arv.id, "traducao_juramentada")
  check("3.1) dessincronizada = true", r.estado.dessincronizada === true, r.estado)
  check("3.2) não pode avançar em grupo", r.estado.podeAvancar === false, r.estado)

  console.log("\n4) B alcança A — sincronizada de novo, próxima etapa correta")
  await atualizarPassoV2(b.doc.id, b.stepInstanceId, { status: "concluida", subtarefaEsperada: "enviar_documentos" }, ctx)
  r = await montarPastaDocumental(proc.id, arv.id, "traducao_juramentada")
  check("4.1) sincronizada de novo", r.estado.dessincronizada === false, r.estado)
  check("4.2) etapa da pasta é 'receber_documentos'", r.estado.etapaAtualKey === "receber_documentos", r.estado)

  console.log("\n5) Os dois terminam as 4 subtarefas — pasta concluída")
  await atualizarPassoV2(a.doc.id, a.stepInstanceId, { status: "concluida", subtarefaEsperada: "receber_documentos" }, ctx)
  await atualizarPassoV2(b.doc.id, b.stepInstanceId, { status: "concluida", subtarefaEsperada: "receber_documentos" }, ctx)
  await atualizarPassoV2(a.doc.id, a.stepInstanceId, { status: "concluida", subtarefaEsperada: "conferir_validar_documentos" }, ctx)
  await atualizarPassoV2(b.doc.id, b.stepInstanceId, { status: "concluida", subtarefaEsperada: "conferir_validar_documentos" }, ctx)
  r = await montarPastaDocumental(proc.id, arv.id, "traducao_juramentada")
  check("5.1) pasta concluída", r.estado.concluida === true, r.estado)
  check("5.2) etapa atual é null (nada mais pendente)", r.estado.etapaAtualKey === null, r.estado)

  console.log(`\n=== ${ok} passaram, ${falhou} falharam ===`)
  if (falhou > 0) console.error("Falhas:", falhas)

  await limpar()
  console.log("Limpeza concluída.")
  await prisma.$disconnect()
  if (falhou > 0) process.exit(1)
}

main().catch(async (e) => {
  console.error(e)
  try { await limpar() } catch { /* melhor esforço */ }
  await prisma.$disconnect()
  process.exit(1)
})

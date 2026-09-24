// scripts/prova-avancar-lote-fase-documental.test.ts
// ============================================================================
// PROVA — a ação em lote (POST .../fase-documental-kpis/[stepKey]/avancar-lote,
// mandato 24/09/2026) conclui a subtarefa CORRENTE de cada documento
// independentemente, nunca a subtarefa errada, nunca mais de uma por vez.
// Testa a MESMA sequência de chamadas que a rota faz (subtarefasDaEtapa →
// atualizarPassoV2 com subtarefaEsperada) contra dois documentos sintéticos,
// um deles já um passo à frente do outro — prova que o lote não confunde o
// estado de um documento com o do outro.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("prova-avancar-lote-fase-documental.test.ts")

import { prisma } from "@/lib/prisma"
import { atualizarPassoV2 } from "@/src/services/documento-operacao"
import { subtarefasDaEtapa } from "@/src/services/subtarefas-da-etapa"
import { congelarVersaoVigente } from "@/src/services/versao-publicada"

const MARCA = "LOTEFASEDOC"

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
}

let seq = 0
async function palco() {
  seq++
  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${MARCA}-wf-${seq}`, name: `[${MARCA}] fase documental`, phaseKey: "emissao_documental", tipoProcessoId: null, execucao: "SEQUENCIAL" },
    select: { id: true },
  })
  const passo = await prisma.phaseInternalWorkflowStep.create({
    data: {
      workflowId: wf.id, key: `${MARCA.toLowerCase()}_passo_${seq}`, label: "Passo com 4 subtarefas", ordem: 1,
      createsTask: true, required: true, slaDays: 15, regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS", dependeDe: [] as never,
    },
    select: { id: true, key: true },
  })
  for (const [i, key] of SUBKEYS.entries()) {
    await prisma.stepSubtaskDefinition.create({
      data: { stepId: passo.id, key, label: key, ordem: i, obrigatoria: true, dependeDe: (i > 0 ? [SUBKEYS[i - 1]] : []) as never },
    })
  }
  await congelarVersaoVigente(wf.id, "CRIACAO")

  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_${seq}`, name: "Certidão Teste", natureza: "DOCUMENTO" }, select: { id: true } })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arvore ${seq}` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} processo ${seq}`, arvoreId: arv.id }, select: { id: true } })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Fulano", sobrenome: `${MARCA}${seq}` }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-nec-${proc.id}` }, select: { id: true },
  })
  const doc = await prisma.documento.create({ data: { pessoaId: pes.id, necessidadeId: nec.id, status: "RECEBIDO" }, select: { id: true } })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "emissao_documental", ciclo: 1, status: "ATIVO", workflowDefinitionId: wf.id, workflowVersion: 1, chaveIdempotencia: `${MARCA}-inst-${proc.id}` },
    select: { id: true },
  })
  const step = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "emissao_documental", ciclo: 1,
      stepKey: passo.key, ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true, status: "EM_ANDAMENTO", startedAt: new Date(),
      necessidadeId: nec.id, documentoId: doc.id, pessoaId: pes.id, slaDays: 15,
      stepDefinitionId: passo.id, stepDefinitionVersion: 1, chaveIdempotencia: `${MARCA}-step-${proc.id}`,
    },
    select: { id: true },
  })
  const usuario = await prisma.usuario.create({ data: { nome: `Op ${MARCA}${seq}`, email: `op${seq}@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "assistente" }, select: { id: true } })
  const ctx = { usuarioId: usuario.id, isAdmin: true, permissoes: { "workflow.iniciarPasso": true, "workflow.concluirPasso": true, "processos.editar_paginas": true } }
  return { proc, doc, stepInstanceId: step.id, ctx }
}

/** Mesma sequência que a rota .../avancar-lote faz para UM documento. */
async function avancarUm(documentoId: number, stepInstanceId: number, ctx: unknown) {
  const subs = await subtarefasDaEtapa({ stepInstanceId })
  const corrente = subs.find((s) => !s.concluida && s.disponivel)
  if (!corrente) return { ok: false as const, motivo: "sem subtarefa disponível" }
  return atualizarPassoV2(documentoId, stepInstanceId, { status: "concluida", subtarefaEsperada: corrente.key }, ctx as never)
}

async function main() {
  console.log(`\n=== PROVA — avançar em lote não confunde documentos (${MARCA}) ===\n`)
  await limpar()

  const a = await palco()
  const b = await palco()

  console.log("1) B já adiantou uma subtarefa sozinho (preparar_documentos concluída); A ainda não tocou em nada")
  const rB1 = await avancarUm(b.doc.id, b.stepInstanceId, b.ctx)
  check("1.1) B concluiu preparar_documentos", rB1.ok === true && rB1.subtarefaConcluida === "preparar_documentos", rB1)

  console.log("\n2) LOTE — avança A e B juntos, cada um na SUA subtarefa corrente")
  const rA2 = await avancarUm(a.doc.id, a.stepInstanceId, a.ctx)
  const rB2 = await avancarUm(b.doc.id, b.stepInstanceId, b.ctx)
  check("2.1) A concluiu preparar_documentos (a corrente DELE)", rA2.ok === true && rA2.subtarefaConcluida === "preparar_documentos", rA2)
  check("2.2) B concluiu enviar_documentos (a corrente DELE — não preparar de novo)", rB2.ok === true && rB2.subtarefaConcluida === "enviar_documentos", rB2)

  const subsA = await subtarefasDaEtapa({ stepInstanceId: a.stepInstanceId })
  const subsB = await subtarefasDaEtapa({ stepInstanceId: b.stepInstanceId })
  check("3.1) A: só preparar_documentos concluída (1/4)", subsA.filter((s) => s.concluida).map((s) => s.key).join(",") === "preparar_documentos", subsA.map(s => ({k:s.key,c:s.concluida})))
  check("3.2) B: preparar_documentos e enviar_documentos concluídas (2/4) — nada além disso", subsB.filter((s) => s.concluida).map((s) => s.key).join(",") === "preparar_documentos,enviar_documentos", subsB.map(s => ({k:s.key,c:s.concluida})))

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

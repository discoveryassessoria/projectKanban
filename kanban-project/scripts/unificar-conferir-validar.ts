// scripts/unificar-conferir-validar.ts
// ============================================================================
// CORREÇÃO FINAL OBRIGATÓRIA — decisão de negócio do Administrador (14/09/2026):
// Emissão Documental deve ter EXATAMENTE 4 passos operacionais, não 5.
//
// Une os passos `conferir_certidao` + `validar_certidao` num ÚNICO passo
// publicado `conferir_e_validar_certidao` (ordem 4), com DUAS subtarefas
// (mecanismo canônico já existente e já usado em produção pelo passo
// `solicitar_certidao` — StepSubtaskDefinition/SubtaskExecution,
// regraDeConclusao="TODAS_SUBTAREFAS_OBRIGATORIAS"):
//   1. "conferencia"         — conferência operacional (checklist de 5 itens,
//                              ação "aprovado", efeito COMPLETE_STEP).
//   2. "validacao_juridica"  — decisão final VALIDADA/NÃO VALIDADA (campo
//                              "parecer" obrigatório, ações "aprovado"
//                              [APPROVE_FOR_ANALYSIS] e "nova_via"
//                              [REQUEST_NEW_COPY]). depende de "conferencia".
//
// A autoridade de Marco/Admin na validação final é preservada por HANDOFF
// INTERNO (reatribuir a MESMA Tarefa — mesma taskId, mesmo stepInstanceId,
// mesmo progresso "4/4" — via atribuirTarefa/transferirTarefa, o mecanismo
// já provado nesta sessão), NUNCA por uma quinta subtarefa/Step. Não criamos
// nenhuma permissão nova: em produção, HOJE, ambas as ações já usam a mesma
// permissão "documentos.editar" (catálogo de efeitos) — a distinção
// Daniela/Marco já era, e continua sendo, organizacional (quem está com a
// Tarefa), não uma trava técnica nova.
//
// IDEMPOTENTE: rodar de novo não duplica. Detecta o workflow "Solicitar
// Certidão" (Emissão Documental) por phaseKey+active+arquivado (produção)
// ou aceita um workflowId explícito (teste).
//
// USO:
//   PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/unificar-conferir-validar.ts --workflow-id=<id>
//   npx tsx scripts/unificar-conferir-validar.ts --producao   (usa o .env real — SÓ depois de tudo validado)
// ============================================================================
import { prisma } from "@/lib/prisma"

export async function unificarConferirValidar(workflowId: number) {
  const conferir = await prisma.phaseInternalWorkflowStep.findFirst({
    where: { workflowId, key: "conferir_certidao" },
    select: {
      id: true, ordem: true, slaDays: true, priority: true, cardinalidade: true,
      reaberturaPermitida: true, reaberturaEstrategia: true, reaberturaExigeJustificativa: true, reaberturaPermissao: true,
      checkItens: { select: { key: true, label: true, obrigatorio: true, ordem: true } },
      campos: { select: { key: true, label: true, tipo: true, obrigatorio: true, ordem: true } },
    },
  })
  const validar = await prisma.phaseInternalWorkflowStep.findFirst({
    where: { workflowId, key: "validar_certidao" },
    select: {
      id: true, campos: { select: { key: true, label: true, tipo: true, obrigatorio: true, ordem: true } },
    },
  })
  const unificado = await prisma.phaseInternalWorkflowStep.findFirst({ where: { workflowId, key: "conferir_e_validar_certidao" }, select: { id: true } })

  if (unificado) {
    console.log(`[unificar] já existe (stepId=${unificado.id}) — nada a fazer.`)
    return { jaExistia: true, stepId: unificado.id }
  }
  if (!conferir || !validar) {
    console.log(`[unificar] conferir_certidao/validar_certidao não encontrados no workflow ${workflowId} — nada a fazer (já convergido ou workflow diferente).`)
    return { jaExistia: false, stepId: null }
  }

  const novo = await prisma.phaseInternalWorkflowStep.create({
    data: {
      workflowId,
      key: "conferir_e_validar_certidao",
      label: "Conferir e validar certidão",
      ordem: conferir.ordem, // 4 — o mesmo lugar de conferir_certidao; validar_certidao (5) some.
      createsTask: true,
      required: true,
      priority: conferir.priority,
      slaDays: conferir.slaDays,
      cardinalidade: conferir.cardinalidade,
      executorKey: "conferencia_e_validacao", // novo kind de editor (frontend)
      reaberturaPermitida: conferir.reaberturaPermitida,
      reaberturaEstrategia: conferir.reaberturaEstrategia,
      reaberturaExigeJustificativa: conferir.reaberturaExigeJustificativa,
      reaberturaPermissao: conferir.reaberturaPermissao,
      // A REGRA CENTRAL: o passo só conclui quando AMBAS as subtarefas
      // obrigatórias concluírem — nunca por uma ação isolada.
      regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS",
    },
    select: { id: true },
  })

  const subConferencia = await prisma.stepSubtaskDefinition.create({
    data: {
      stepId: novo.id, key: "conferencia", label: "Conferência da certidão", ordem: 1,
      obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA",
    },
    select: { id: true },
  })
  const subValidacao = await prisma.stepSubtaskDefinition.create({
    data: {
      stepId: novo.id, key: "validacao_juridica", label: "Validação jurídica", ordem: 2,
      obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA",
      // SÓ FICA DISPONÍVEL DEPOIS DA CONFERÊNCIA — a ordem que o mandato exige
      // ("dependeDe" é o mecanismo canônico já existente, nunca hardcode de UI).
      dependeDe: ["conferencia"] as never,
    },
    select: { id: true },
  })

  // ── CONFERÊNCIA: checklist (migrado 1:1) + campo observação + ação "aprovado" ──
  for (const c of conferir.checkItens) {
    await prisma.stepChecklistItem.create({
      data: { stepId: novo.id, subtaskId: subConferencia.id, key: c.key, label: c.label, obrigatorio: c.obrigatorio, ordem: c.ordem },
    })
  }
  for (const c of conferir.campos) {
    await prisma.stepField.create({
      data: { stepId: novo.id, subtaskId: subConferencia.id, key: c.key, label: c.label, tipo: c.tipo, obrigatorio: c.obrigatorio, ordem: c.ordem },
    })
  }
  await prisma.stepAction.create({
    data: { stepId: novo.id, subtaskId: subConferencia.id, key: "aprovado", label: "Conferência aprovada", effectKey: "COMPLETE_STEP", ordem: 1 },
  })

  // ── VALIDAÇÃO JURÍDICA: campos (parecer/motivo) + ações aprovado/nova_via ──
  for (const c of validar.campos) {
    await prisma.stepField.create({
      data: { stepId: novo.id, subtaskId: subValidacao.id, key: c.key, label: c.label, tipo: c.tipo, obrigatorio: c.obrigatorio, ordem: c.ordem },
    })
  }
  await prisma.stepAction.create({
    data: { stepId: novo.id, subtaskId: subValidacao.id, key: "aprovado", label: "Validado — enviar para a Análise", effectKey: "APPROVE_FOR_ANALYSIS", ordem: 1 },
  })
  // REQUEST_NEW_COPY exige "motivo" (catálogo de efeitos, camposObrigatorios).
  // Se o passo de origem não tinha esse campo cadastrado, criar aqui é
  // indispensável para a ação publicar — nunca hardcode a exigência sem a
  // peça que ela referencia.
  if (!validar.campos.some((c) => c.key === "motivo")) {
    await prisma.stepField.create({
      data: { stepId: novo.id, subtaskId: subValidacao.id, key: "motivo", label: "Motivo", tipo: "textarea", obrigatorio: false, ordem: validar.campos.length + 1 },
    })
  }
  await prisma.stepAction.create({
    data: { stepId: novo.id, subtaskId: subValidacao.id, key: "nova_via", label: "Solicitar nova via", effectKey: "REQUEST_NEW_COPY", requerCampos: ["motivo"] as never, ordem: 2 },
  })

  // ── OS DOIS PASSOS ANTIGOS SAEM DO CADASTRO VIVO (a versão publicada antiga
  //    que os continha permanece imutável e rastreável — PhaseInternalWorkflowVersao
  //    nunca é tocada aqui). Deletar é seguro: nenhuma linha de
  //    PhaseWorkflowStepInstance referencia stepId com FK forte (ver
  //    versaoDaInstancia — o ponteiro por id já era conhecidamente frágil).
  await prisma.phaseInternalWorkflowStep.delete({ where: { id: validar.id } })
  await prisma.phaseInternalWorkflowStep.delete({ where: { id: conferir.id } })

  console.log(`[unificar] criado passo unificado id=${novo.id} (conferencia=${subConferencia.id}, validacao_juridica=${subValidacao.id}); conferir_certidao(${conferir.id})/validar_certidao(${validar.id}) removidos do cadastro vivo.`)
  return { jaExistia: false, stepId: novo.id, subConferenciaId: subConferencia.id, subValidacaoId: subValidacao.id }
}

async function main() {
  const arg = process.argv.find((a) => a.startsWith("--workflow-id="))
  const producao = process.argv.includes("--producao")
  if (!arg && !producao) {
    console.error("uso: --workflow-id=<id> (teste) ou --producao (usa o workflow real, phaseKey=emissao_documental)")
    process.exit(1)
  }
  let workflowId: number
  if (producao) {
    const wf = await prisma.phaseInternalWorkflow.findFirstOrThrow({
      where: { phaseKey: "emissao_documental", active: true, arquivado: false, tipoProcessoId: null },
      select: { id: true },
    })
    workflowId = wf.id
  } else {
    workflowId = Number(arg!.split("=")[1])
  }
  const r = await unificarConferirValidar(workflowId)
  console.log(JSON.stringify(r))
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
}

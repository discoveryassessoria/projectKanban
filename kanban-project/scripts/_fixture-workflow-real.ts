// Recria, no banco de TESTE, uma cópia FIEL do cadastro real de produção do
// workflow "Solicitar Certidão" (5 passos, ações/campos/checklist reais
// capturados de produção) — para testar a unificação conferir+validar contra
// uma réplica fiel, não contra o seed vazio do banco de teste.
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"

const MARCA = "REALWF"

export async function montarWorkflowReal(): Promise<number> {
  exigirBancoDeTeste("_fixture-workflow-real.ts")
  const existente = await prisma.phaseInternalWorkflow.findFirst({ where: { wfUid: `${MARCA}::emissao` }, select: { id: true } })
  if (existente) return existente.id

  const wf = await prisma.phaseInternalWorkflow.create({
    data: {
      wfUid: `${MARCA}::emissao`, phaseKey: "emissao_documental_realwf", name: `${MARCA} Emissão Documental`,
      versao: 1, execucao: "SEQUENCIAL", escopoExecucao: "DOCUMENTO", active: true,
      passos: {
        create: [
          { key: "solicitar_certidao", label: "Solicitar certidão", ordem: 1, createsTask: true, required: true, slaDays: 7, cardinalidade: "DOCUMENTO", executorKey: "solicitacao_cartorio" },
          { key: "aguardar_retorno_do_cartorio", label: "Aguardar retorno do cartório", ordem: 2, createsTask: true, required: true, slaDays: 15, cardinalidade: "DOCUMENTO", executorKey: "acompanhamento_retorno" },
          { key: "receber_certidao", label: "Receber certidão", ordem: 3, createsTask: true, required: true, slaDays: 2, cardinalidade: "DOCUMENTO", executorKey: "recebimento_documento" },
          { key: "conferir_certidao", label: "Conferir certidão", ordem: 4, createsTask: true, required: true, slaDays: 0, cardinalidade: "DOCUMENTO", executorKey: "conferencia_documento" },
          { key: "validar_certidao", label: "Validar certidão", ordem: 5, createsTask: true, required: true, slaDays: 0, cardinalidade: "DOCUMENTO", executorKey: "validacao_juridica" },
        ],
      },
    },
    select: { id: true, passos: { select: { id: true, key: true } } },
  })
  const porChave = new Map(wf.passos.map((p) => [p.key, p.id]))

  await prisma.stepAction.createMany({
    data: [
      { stepId: porChave.get("solicitar_certidao")!, key: "enviado", label: "Enviar solicitação ao cartório", effectKey: "COMPLETE_STEP", ordem: 1 },
    ],
  })
  await prisma.stepAction.createMany({
    data: [
      { stepId: porChave.get("aguardar_retorno_do_cartorio")!, key: "retorno_chegou", label: "Retorno chegou", effectKey: "COMPLETE_STEP", ordem: 1 },
      { stepId: porChave.get("aguardar_retorno_do_cartorio")!, key: "ainda_aguardando", label: "Ainda aguardando", effectKey: "PAUSE_FOR_EXTERNAL_WAIT", ordem: 2 },
    ],
  })
  await prisma.stepAction.createMany({
    data: [{ stepId: porChave.get("receber_certidao")!, key: "recebido", label: "Recebido", effectKey: "MARK_DOCUMENT_RECEIVED", ordem: 1 }],
  })

  // ── conferir_certidao — réplica fiel do cadastro real de produção ──
  const conferirId = porChave.get("conferir_certidao")!
  await prisma.stepAction.createMany({
    data: [
      { stepId: conferirId, key: "aprovado", label: "Conferência aprovada", effectKey: "COMPLETE_STEP", ordem: 1 },
      { stepId: conferirId, key: "nova_via", label: "Solicitar nova via", effectKey: "REQUEST_NEW_COPY", requerCampos: ["motivo"] as never, ordem: 2 },
    ],
  })
  await prisma.stepField.createMany({
    data: [
      { stepId: conferirId, key: "observacao", label: "Observação da conferência", tipo: "textarea", obrigatorio: false, ordem: 1 },
      { stepId: conferirId, key: "motivo", label: "Motivo", tipo: "textarea", obrigatorio: false, ordem: 2 },
    ],
  })
  await prisma.stepChecklistItem.createMany({
    data: [
      { stepId: conferirId, key: "legivel", label: "Legibilidade", obrigatorio: true, ordem: 1 },
      { stepId: conferirId, key: "integro", label: "Integridade do documento", obrigatorio: true, ordem: 2 },
      { stepId: conferirId, key: "dados_minimos", label: "Dados mínimos presentes", obrigatorio: true, ordem: 3 },
      { stepId: conferirId, key: "apostila_ok", label: "Apostila de Haia (se exigida)", obrigatorio: true, ordem: 4 },
      { stepId: conferirId, key: "traducao_ok", label: "Tradução juramentada (se exigida)", obrigatorio: true, ordem: 5 },
    ],
  })

  // ── validar_certidao — réplica fiel ──
  const validarId = porChave.get("validar_certidao")!
  await prisma.stepAction.createMany({
    data: [
      { stepId: validarId, key: "aprovado", label: "Validado — enviar para a Análise", effectKey: "APPROVE_FOR_ANALYSIS", ordem: 1 },
      { stepId: validarId, key: "nova_via", label: "Solicitar nova via", effectKey: "REQUEST_NEW_COPY", requerCampos: ["motivo"] as never, ordem: 2 },
    ],
  })
  await prisma.stepField.createMany({
    data: [
      { stepId: validarId, key: "parecer", label: "Parecer", tipo: "textarea", obrigatorio: true, ordem: 1 },
      { stepId: validarId, key: "motivo", label: "Motivo", tipo: "textarea", obrigatorio: false, ordem: 2 },
    ],
  })

  return wf.id
}

if (require.main === module) {
  montarWorkflowReal().then((id) => { console.log("workflowId:", id); process.exit(0) }).catch((e) => { console.error(e); process.exit(1) })
}

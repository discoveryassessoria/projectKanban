// src/services/invariante-documental.ts
//
// A INVARIANTE DOCUMENTAL — passo e tarefa de workflow documental não existem
// sem documento.
//
// O QUE ELA IMPEDE
// ----------------
// O processo 505 tem hoje cinco StepInstances de "Emissão Documental" com
// `documentoId` NULL, e oito tarefas na mesma situação. Eles chegaram lá por dois
// caminhos: nasceram antes de o contrato existir, e depois perderam o vínculo por
// `ON DELETE SET NULL` quando o documento foi excluído junto com a pessoa.
//
// O primeiro caminho esta invariante fecha: com o workflow declarando
// `exigeDocumento`, materializar um passo documental sem documento passa a
// ABORTAR a transação inteira, em vez de gravar um passo órfão que a Central não
// consegue agrupar e o operador não consegue executar.
//
// O segundo caminho ela NÃO fecha, e é honesto dizer: `SET NULL` continua sendo o
// comportamento do banco quando um documento é apagado. Trocar isso por CASCADE
// apagaria o histórico do passo junto; trocar por RESTRICT impediria excluir
// pessoa da árvore. As duas alternativas são piores que o vínculo nulo — o que se
// ganha aqui é que o estado deixa de ser CRIADO, e passa a ser só uma
// consequência declarada de uma exclusão deliberada.
//
// FALHA FECHADA: aborta com erro estruturado, sem criar estado parcial e sem
// fallback. Materializar "quase certo" é o que produz os órfãos.

export type MotivoViolacao =
  | "PASSO_DOCUMENTAL_SEM_DOCUMENTO"
  | "TAREFA_DOCUMENTAL_SEM_DOCUMENTO"
  | "TAREFA_E_PASSO_DIVERGEM"
  | "TAREFA_DE_WORKFLOW_SEM_PASSO"

export interface DetalheViolacao {
  motivo: MotivoViolacao
  stepKey?: string
  stepInstanceId?: number
  documentoIdDoPasso?: number | null
  documentoIdDaTarefa?: number | null
  processoId?: number
}

/** Erro de contrato do motor. Carrega o que se precisa para diagnosticar. */
export class ViolacaoContratoDocumental extends Error {
  readonly codigo = "CONTRATO_DOCUMENTAL_VIOLADO"
  constructor(
    readonly detalhe: DetalheViolacao,
  ) {
    super(
      `CONTRATO_DOCUMENTAL_VIOLADO:${detalhe.motivo}` +
        (detalhe.stepKey ? ` passo=${detalhe.stepKey}` : "") +
        (detalhe.stepInstanceId ? ` stepInstance=${detalhe.stepInstanceId}` : "") +
        (detalhe.processoId ? ` processo=${detalhe.processoId}` : ""),
    )
    this.name = "ViolacaoContratoDocumental"
  }
}

/**
 * O workflow exige documento e o alvo não tem? Aborta.
 *
 * `exigeDocumento` vem do cadastro (Fatia 1). Workflow que não declarou nada
 * continua exatamente como antes — a invariante só vale para quem assinou o
 * contrato, e é isso que a torna aplicável sem migrar o motor inteiro de uma vez.
 */
export function exigirDocumentoNoPasso(args: {
  workflowExigeDocumento: boolean
  stepKey: string
  documentoId: number | null
  processoId: number
}): void {
  if (!args.workflowExigeDocumento) return
  if (args.documentoId != null) return
  throw new ViolacaoContratoDocumental({
    motivo: "PASSO_DOCUMENTAL_SEM_DOCUMENTO",
    stepKey: args.stepKey,
    documentoIdDoPasso: null,
    processoId: args.processoId,
  })
}

/**
 * A tarefa HERDA o documento do passo — nunca o escolhe. Se o passo tem
 * documento, a tarefa tem o mesmo; divergir é erro, não preferência.
 */
export function documentoDaTarefa(args: {
  workflowExigeDocumento: boolean
  stepKey: string
  stepInstanceId: number
  documentoIdDoPasso: number | null
  documentoIdInformado?: number | null
  processoId: number
}): number | null {
  const { documentoIdDoPasso, documentoIdInformado } = args

  if (
    documentoIdInformado != null &&
    documentoIdDoPasso != null &&
    documentoIdInformado !== documentoIdDoPasso
  ) {
    throw new ViolacaoContratoDocumental({
      motivo: "TAREFA_E_PASSO_DIVERGEM",
      stepKey: args.stepKey,
      stepInstanceId: args.stepInstanceId,
      documentoIdDoPasso,
      documentoIdDaTarefa: documentoIdInformado,
      processoId: args.processoId,
    })
  }

  const documentoId = documentoIdDoPasso ?? documentoIdInformado ?? null

  if (args.workflowExigeDocumento && documentoId == null) {
    throw new ViolacaoContratoDocumental({
      motivo: "TAREFA_DOCUMENTAL_SEM_DOCUMENTO",
      stepKey: args.stepKey,
      stepInstanceId: args.stepInstanceId,
      documentoIdDoPasso,
      processoId: args.processoId,
    })
  }
  return documentoId
}

/**
 * Tarefa cuja ORIGEM é um passo de workflow tem de apontar para o passo.
 *
 * As sete tarefas soltas do processo 505 são exatamente isto: nasceram por fase,
 * sem `workflowStepInstanceId`, e por isso a Central não consegue dizer de qual
 * documento elas tratam nem o motor consegue sincronizar conclusão. Daqui em
 * diante, quem declara origem de workflow declara o passo.
 */
export function exigirPassoNaTarefaDeWorkflow(args: {
  origemEhWorkflow: boolean
  workflowStepInstanceId: number | null
  processoId: number
}): void {
  if (!args.origemEhWorkflow) return
  if (args.workflowStepInstanceId != null) return
  throw new ViolacaoContratoDocumental({
    motivo: "TAREFA_DE_WORKFLOW_SEM_PASSO",
    processoId: args.processoId,
  })
}

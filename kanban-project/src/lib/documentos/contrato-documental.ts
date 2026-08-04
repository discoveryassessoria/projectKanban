// src/lib/documentos/contrato-documental.ts
//
// GUARDS DO CONTRATO DOCUMENTAL — a validação administrativa, em um lugar só.
//
// O contrato existe desde a migration 20260804c: o Tipo de Documento declara
// família, natureza e perfil; o Workflow Interno declara escopo, exigeDocumento e
// exigePessoa; o passo declara cardinalidade. Declarar não basta — sem guard, a
// próxima gravação pela tela devolve o cadastro ao estado que o contrato veio
// impedir: documento que se processa sem perfil, perfil apontando para nada,
// workflow documental que não exige documento.
//
// PURO de propósito: recebe o retrato do que se quer gravar e devolve o que está
// errado. Sem Prisma, sem I/O — a rota resolve os IDs e chama; o teste chama
// direto. Uma regra, dois consumidores, zero divergência.
//
// NUNCA CORRIGE. Devolve motivo nomeado e a gravação é recusada. Corrigir em
// silêncio é como o cadastro chegou onde chegou.

export const MOTIVO_CONTRATO = {
  DOC_SEM_PERFIL: "DOCUMENTO_COM_NATUREZA_OPERACIONAL_SEM_PERFIL",
  PERFIL_SEM_WORKFLOW: "PERFIL_ATIVO_SEM_WORKFLOW_PUBLICADO",
  WF_DOC_SEM_EXIGE_DOCUMENTO: "WORKFLOW_DOCUMENTAL_SEM_EXIGE_DOCUMENTO",
  WF_DOC_SEM_ESCOPO: "WORKFLOW_DOCUMENTAL_SEM_ESCOPO",
  PASSO_SEM_CARDINALIDADE: "PASSO_PUBLICADO_SEM_CARDINALIDADE",
  WF_TIPO_PROCESSO_INEXISTENTE: "WORKFLOW_COM_TIPO_PROCESSO_INEXISTENTE",
} as const

export type MotivoContrato = (typeof MOTIVO_CONTRATO)[keyof typeof MOTIVO_CONTRATO]

/** Frase que o administrador lê. Diz o que fazer, não só o que está errado. */
export const EXPLICACAO_CONTRATO: Record<MotivoContrato, string> = {
  [MOTIVO_CONTRATO.DOC_SEM_PERFIL]:
    "A natureza operacional escolhida exige workflow, então este tipo de documento precisa de um Perfil Operacional. Sem perfil, a materialização não sabe qual workflow processa o documento.",
  [MOTIVO_CONTRATO.PERFIL_SEM_WORKFLOW]:
    "Perfil operacional ativo precisa apontar para um Workflow Interno publicado e ativo. Um perfil sem workflow não materializa nada.",
  [MOTIVO_CONTRATO.WF_DOC_SEM_EXIGE_DOCUMENTO]:
    "Workflow com escopo DOCUMENTO tem de exigir documento. Sem isso o motor poderia criar execução documental sem documento — exatamente o estado que o contrato veio impedir.",
  [MOTIVO_CONTRATO.WF_DOC_SEM_ESCOPO]:
    "Workflow que exige documento precisa declarar o escopo de execução. Sem escopo, o motor cai no padrão da fase e o contrato deixa de valer.",
  [MOTIVO_CONTRATO.PASSO_SEM_CARDINALIDADE]:
    "Passo de workflow documental publicado precisa declarar a cardinalidade. NULL faz o passo herdar o escopo da fase, e o vínculo com o documento deixa de ser garantido.",
  [MOTIVO_CONTRATO.WF_TIPO_PROCESSO_INEXISTENTE]:
    "O workflow aponta para um tipo de processo que não existe no cadastro oficial. Ele nunca será aplicado a processo nenhum.",
}

export interface FalhaContrato {
  motivo: MotivoContrato
  campo: string
  explicacao: string
}

const falha = (motivo: MotivoContrato, campo: string): FalhaContrato => ({
  motivo,
  campo,
  explicacao: EXPLICACAO_CONTRATO[motivo],
})

// ── Tipo de Documento ───────────────────────────────────────────────────────

export interface RetratoTipoDocumento {
  /** A natureza escolhida exige workflow? (NaturezaOperacionalDocumento.exigeWorkflow) */
  naturezaExigeWorkflow: boolean
  perfilOperacionalId: number | null
}

/**
 * Um tipo documental cuja natureza EXIGE workflow não pode ficar sem perfil.
 * Natureza que não exige (evidência, recebido do cliente) passa sem perfil — é o
 * caso do requerimento, que se anexa e não se emite.
 */
export function conferirTipoDocumento(r: RetratoTipoDocumento): FalhaContrato[] {
  const f: FalhaContrato[] = []
  if (r.naturezaExigeWorkflow && r.perfilOperacionalId == null) {
    f.push(falha(MOTIVO_CONTRATO.DOC_SEM_PERFIL, "perfilOperacionalId"))
  }
  return f
}

// ── Perfil Operacional ──────────────────────────────────────────────────────

export interface RetratoPerfil {
  ativo: boolean
  workflowId: number | null
  /** O workflow apontado existe, está ativo e não arquivado? */
  workflowPublicado: boolean
}

export function conferirPerfil(r: RetratoPerfil): FalhaContrato[] {
  const f: FalhaContrato[] = []
  if (r.ativo && (r.workflowId == null || !r.workflowPublicado)) {
    f.push(falha(MOTIVO_CONTRATO.PERFIL_SEM_WORKFLOW, "workflowId"))
  }
  return f
}

// ── Workflow Interno ────────────────────────────────────────────────────────

export interface RetratoWorkflow {
  escopoExecucao: string | null
  exigeDocumento: boolean
  tipoProcessoId: number | null
  /** O tipoProcessoId apontado existe no cadastro oficial? (null = vale para todos) */
  tipoProcessoExiste: boolean
  /** Cardinalidade de cada passo publicado do workflow. */
  cardinalidadeDosPassos: Array<string | null>
}

export function conferirWorkflow(r: RetratoWorkflow): FalhaContrato[] {
  const f: FalhaContrato[] = []
  const documental = r.escopoExecucao === "DOCUMENTO"

  if (documental && !r.exigeDocumento) {
    f.push(falha(MOTIVO_CONTRATO.WF_DOC_SEM_EXIGE_DOCUMENTO, "exigeDocumento"))
  }
  if (r.exigeDocumento && !r.escopoExecucao) {
    f.push(falha(MOTIVO_CONTRATO.WF_DOC_SEM_ESCOPO, "escopoExecucao"))
  }
  // Só cobra cardinalidade de workflow que JÁ declarou escopo documental: os
  // demais continuam herdando da fase, como sempre fizeram.
  if (documental && r.cardinalidadeDosPassos.some((c) => c == null)) {
    f.push(falha(MOTIVO_CONTRATO.PASSO_SEM_CARDINALIDADE, "passos.cardinalidade"))
  }
  if (r.tipoProcessoId != null && !r.tipoProcessoExiste) {
    f.push(falha(MOTIVO_CONTRATO.WF_TIPO_PROCESSO_INEXISTENTE, "tipoProcessoId"))
  }
  return f
}

/** Resposta HTTP padronizada de recusa. Sem valor cru, sem stack, sem segredo. */
export function respostaDeRecusa(falhas: FalhaContrato[]): { error: string; contrato: FalhaContrato[] } {
  return { error: `CONTRATO_DOCUMENTAL:${falhas.map((f) => f.motivo).join(",")}`, contrato: falhas }
}

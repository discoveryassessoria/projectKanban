// src/lib/operacoes/tipos.ts
//
// CATÁLOGO OPERACIONAL — contrato dos ADAPTADORES de operação. A Operação Antecipada é
// agnóstica a tipos: NUNCA conhece "documento", "serviço", "tradução". Ela resolve tudo por
// ESTE contrato + registro (catalogo.ts). Um novo tipo operacional = um novo adaptador
// registrado; nenhuma alteração no núcleo, na Central ou na UI.

export type ResultadoAvaliacao = "SIM" | "PARCIAL" | "NAO" | "CANCELAR"

/** Contexto para o adaptador criar/vincular a operação OFICIAL (não a antecipada). */
export interface AdapterCriarContexto {
  processoId: number
  pessoaId: number | null
  necessidadeId: number | null
  targetPhaseCode: string | null
  /** Parâmetros livres vindos do catálogo/UI (ex.: tipoDocumentoId). */
  params?: Record<string, unknown>
}

/** Referência para abrir a MESMA tela oficial da operação (sem tela paralela). */
export interface UiRef {
  kind: string // "documento", "servico", ...
  id: number | null
  necessidadeId?: number | null
}

export interface OperacaoStatus {
  statusRaw: string
  statusLabel: string
  concluida: boolean
  uiRef: UiRef
}

/** Metadados do catálogo (o que a tela de criação consome). Sem lista fixa. */
export interface CatalogoItem {
  operationType: string
  label: string
  canRunOutsidePhase: boolean
  allowAdvanceExecution: boolean
  workflowDefinitionId: string | null
}

/**
 * ADAPTADOR de execução — a ponte entre a Operação Antecipada e o WORKFLOW OFICIAL.
 * O workflow/etapas pertencem exclusivamente à operação oficial; o adaptador apenas cria,
 * lê status, interpreta resultado e reconcilia. Não copia nem duplica etapas.
 */
export interface ExecutionAdapter {
  operationType: string
  label: string
  canRunOutsidePhase: boolean
  allowAdvanceExecution: boolean
  workflowDefinitionId: string | null
  resultInterpreter: string
  reconciliationStrategy: string
  active: boolean

  /** Cria/vincula a operação oficial. Retorna o id oficial (ex.: documentoId) ou null (lazy). */
  criarOperacao(ctx: AdapterCriarContexto): Promise<{ targetOperationId: number | null }>

  /** Status atual da operação oficial (rótulo + se o workflow oficial concluiu). */
  getStatus(targetOperationId: number | null, ctx: { necessidadeId: number | null }): Promise<OperacaoStatus>

  /** Efeitos na ENTIDADE-ALVO ao avaliar (não na necessidade — isso é do núcleo). Opcional. */
  interpretarResultado?(targetOperationId: number | null, resultado: ResultadoAvaliacao): Promise<void>

  /** Reaproveita o trabalho quando a fase oficial chega (idempotente, sem duplicar). Opcional. */
  reconciliar?(op: { targetOperationId: number | null; necessidadeId: number | null; processoId: number }, faseMacroKey: string): Promise<void>
}

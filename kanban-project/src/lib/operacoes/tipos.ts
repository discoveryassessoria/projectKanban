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

/** Descritor de um campo adicional do formulário — o form é GERADO por estes metadados
 *  (nunca condicionado a nomes de fase). type direciona qual seletor/endpoint a UI usa. */
export interface CampoAdicional {
  key: string        // vira params[key]
  label: string
  type: "tipoDocumento" | "pais" | "pessoa" | "text"
  required: boolean
}

/** Metadados do catálogo (o que a tela de criação consome). Sem lista fixa. */
export interface CatalogoItem {
  operationType: string
  label: string
  canRunOutsidePhase: boolean
  allowAdvanceExecution: boolean
  workflowDefinitionId: string | null
  exigeTipoDocumento: boolean
  exigePessoa: boolean
  permiteReutilizarExistente: boolean
  permiteCriarNovo: boolean
  camposAdicionais: CampoAdicional[]
  resultStrategy: string
  reconciliationStrategy: string
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
  // Metadados que GERAM o formulário de criação (sem lista fixa / sem condicionar por fase).
  exigeTipoDocumento: boolean
  exigePessoa: boolean
  permiteReutilizarExistente: boolean
  permiteCriarNovo: boolean
  camposAdicionais: CampoAdicional[]

  /** Cria/vincula a operação oficial (idempotente). Retorna o id oficial (ex.: documentoId).
   *  DEVE lançar erro funcional se a configuração obrigatória faltar (nunca null silencioso). */
  criarOperacao(ctx: AdapterCriarContexto): Promise<{ targetOperationId: number | null }>

  /** Status atual da operação oficial (rótulo + se o workflow oficial concluiu). */
  getStatus(targetOperationId: number | null, ctx: { necessidadeId: number | null }): Promise<OperacaoStatus>

  /** A operação-alvo pode ser vinculada como documento OFICIAL da necessidade de origem?
   *  (só quando o tipo documental for compatível + mesma pessoa + sem equivalente já vinculado). */
  podeVincularNecessidade?(targetOperationId: number | null, necessidadeId: number | null): Promise<boolean>

  /** Vincula a operação-alvo à necessidade (documento oficial). Só chamar após podeVincular=true. */
  vincularNecessidade?(targetOperationId: number | null, necessidadeId: number | null): Promise<void>

  /** INTERPRETADOR DO RESULTADO na ORIGEM: propaga o resultado obtido para a operação oficial da
   *  necessidade de origem (conclui seus passos obrigatórios abertos na fase vigente, anexando os
   *  dados registrais capturados). É isto que faz o gate/progresso refletir o trabalho antecipado.
   *  Genérico (por necessidade → documento → passo); NÃO conhece fase/tipo específico. Opcional. */
  aplicarResultadoNaOrigem?(ctx: { necessidadeId: number; processoId: number; resultadoDados?: Record<string, unknown> | null }): Promise<{ concluidos: number }>

  /** Efeitos na ENTIDADE-ALVO ao avaliar (não na necessidade — isso é do núcleo). Opcional. */
  interpretarResultado?(targetOperationId: number | null, resultado: ResultadoAvaliacao): Promise<void>

  /** Reaproveita o trabalho quando a fase oficial chega (idempotente, sem duplicar). Opcional. */
  reconciliar?(op: { targetOperationId: number | null; necessidadeId: number | null; processoId: number }, faseMacroKey: string): Promise<void>
}

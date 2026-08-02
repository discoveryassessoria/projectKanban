// ============================================================================
// CONTRATO DO SLA OPERACIONAL
// ----------------------------------------------------------------------------
// O SLA já é CONFIGURADO no cadastro (FaseMacro.slaDays, por Workflow Macro do
// Tipo de Processo — tela Processos › Configurações › SLA). Este contrato é a
// LEITURA OPERACIONAL dessa configuração aplicada a um processo real: quanto já
// correu, quanto falta, se venceu e qual fase consumiu o prazo.
//
// FONTE ÚNICA: tudo aqui nasce de src/lib/motor/sla-core.ts (núcleo puro), com
// I/O em src/lib/process-stage/sla-projection.ts. Central Operacional, listagem
// de processos e detalhe do processo consomem ESTE objeto — nenhum deles
// recalcula prazo, dias ou cor.
//
// NADA é persistido: a projeção é derivada na leitura, então ela já nasce
// correta na criação do processo, na mudança de fase, na alteração do workflow,
// na listagem e na abertura do processo — sem cache a invalidar e sem segunda
// fonte de verdade.
// ============================================================================

/**
 * Situação do prazo.
 *   • no_prazo            (🟢) ainda dentro do prazo, com folga
 *   • proximo_vencimento  (🟡) faltam até 7 dias
 *   • atrasado            (🔴) prazo vencido
 *   • sem_prazo           o Tipo de Processo não tem SLA configurado — não é
 *                         cor nenhuma: é ausência de configuração, e mentir
 *                         "no prazo" esconderia a lacuna do cadastro.
 */
export type StatusSla = "no_prazo" | "proximo_vencimento" | "atrasado" | "sem_prazo"

/** Faixa operacional usada pelos cards da Central Operacional. */
export type FaixaSla = "atrasados" | "vencem-hoje" | "proximos-7" | "no-prazo"

/** SLA da fase que o processo está executando agora. */
export interface SlaFaseAtual {
  phaseKey: string
  label: string
  /** prazo configurado da fase (FaseMacro.slaDays) */
  slaDias: number
  /** ISO — início da instância da fase (startedAt, ou a criação da instância) */
  inicio: string | null
  /** ISO — inicio + slaDias */
  prazo: string | null
  diasDecorridos: number
  /** assinado: negativo = vencido */
  diasParaVencimento: number | null
  diasRestantes: number
  diasAtraso: number
  status: StatusSla
}

/** Fase que estourou o próprio SLA — a responsável pelo atraso acumulado. */
export interface SlaFaseResponsavel {
  phaseKey: string
  label: string
  ordem: number
  slaDias: number
  /** dias civis realmente consumidos na fase (soma de todos os ciclos) */
  diasConsumidos: number
  /** diasConsumidos - slaDias (sempre > 0 aqui) */
  diasExcedidos: number
  /** true quando a fase ainda está correndo (o excedente continua crescendo) */
  emAndamento: boolean
}

/** Prazo mais próximo a vencer — o da fase atual ou o do processo. */
export interface ProximoVencimentoSla {
  /** ISO */
  data: string
  origem: "fase" | "processo"
  rotulo: string
  diasRestantes: number
}

/** Projeção de SLA de UM processo. Objeto único consumido por toda a aplicação. */
export interface SlaProcesso {
  processoId: number
  /** false quando o Tipo de Processo não tem Workflow Macro ou soma de SLA = 0 */
  configurado: boolean
  /** true quando o processo já encerrou — o SLA congela na conclusão */
  concluido: boolean
  status: StatusSla
  /** faixa da Central Operacional; null quando não entra em nenhuma (sem SLA/concluído) */
  faixa: FaixaSla | null

  /** ISO — Processo.dataInicio */
  inicio: string | null
  /** ISO — inicio + prazoTotalDias */
  prazoPrevisto: string | null
  /** soma dos SLAs das fases OBRIGATÓRIAS do Workflow Macro, na ordem do fluxo */
  prazoTotalDias: number

  diasDecorridos: number
  /** assinado: negativo = vencido. null quando não há SLA configurado */
  diasParaVencimento: number | null
  diasRestantes: number
  diasAtraso: number

  faseAtual: SlaFaseAtual | null
  faseResponsavelAtraso: SlaFaseResponsavel | null
  proximoVencimento: ProximoVencimentoSla | null

  /** texto curto para a coluna "Dias" da listagem ("12 dias atrasado", "Vence em 3 dias") */
  rotuloDias: string
  /** texto curto do status ("No prazo", "Próximo do vencimento", "Atrasado") */
  rotuloStatus: string
}

/** Contagem por faixa — bloco de SLA da Central Operacional. */
export interface ResumoSla {
  atrasados: number
  vencemHoje: number
  proximos7: number
  noPrazo: number
  /** processos sem SLA configurado no Tipo de Processo (não entram nas faixas) */
  semPrazo: number
  /** total de processos operacionais avaliados (exclui concluídos) */
  avaliados: number
}

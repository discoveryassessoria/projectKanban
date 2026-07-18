// src/lib/process-stage/fases-catalog.ts
//
// CATÁLOGO DE FASES — fonte única da verdade sobre as etapas de cada fase
// e a ordem do fluxo. Só DADOS + tipos. Não toca no banco.

import type { FaseCode } from "@prisma/client"

/**
 * ESCOPO OPERACIONAL DECLARADO da fase (fonte da verdade do progresso/gate).
 * É uma propriedade do WORKFLOW da fase — NUNCA derivada do nome/label. O resolver
 * canônico (resolveOperationalProjection) e o BlockingEngine usam este escopo para
 * decidir sobre QUAIS entidades calcular progresso e bloqueio:
 *   • PROCESSO    — a esteira operacional é do processo (passos genéricos legítimos).
 *   • NECESSIDADE — opera sobre NecessidadeDocumental e suas instâncias (ex.: Genealogia).
 *   • DOCUMENTO   — opera sobre Documento e suas instâncias (ex.: Emissão documental).
 * A classificação data-driven de resolve-passos-bloqueantes.ts continua sendo usada
 * para FILTRAR passos genéricos órfãos quando há passos por-entidade; ela NÃO substitui
 * o escopo declarado (que também vale antes da materialização dos passos).
 */
export type WorkflowScope = "PROCESSO" | "NECESSIDADE" | "DOCUMENTO"

/** Step do workflow POR-DOCUMENTO (Genealogia, Emissão). */
export interface FaseStep {
  ordem: number
  stepKey: string
  title: string
  description: string
  weight: number
  ownerKey: string
  slaDays: number
}

/** Step do checklist POR-PROCESSO (fases que avançam manualmente). */
export interface ProcessFaseStep {
  stepKey: string
  title: string
  description: string
}

export interface FaseDef {
  code: FaseCode
  /** Chave estável usada no banco (Processo.faseAtualKey, PhaseInternalWorkflow.phaseKey,
   *  FaseMacro.phaseKey, Tarefa.faseMacroKey). CANÔNICA: renomear uma fase = mudar SÓ aqui. */
  phaseKey: string
  ordem: number
  label: string
  /** "documento" = workflow por doc (gate automático). "processo" = checklist + avanço manual. */
  kind: "documento" | "processo"
  /** ESCOPO OPERACIONAL declarado — fonte da verdade do progresso/gate (ver WorkflowScope). */
  scope: WorkflowScope
  steps: FaseStep[]
  /** Checklist quando kind === "processo". */
  processSteps?: ProcessFaseStep[]
  next: FaseCode | null
  pendingSpec?: boolean
}

export const FASES: Record<FaseCode, FaseDef> = {
  GENEALOGIA: {
    code: "GENEALOGIA", phaseKey: "genealogia", ordem: 0, label: "Genealogia", kind: "documento", scope: "NECESSIDADE",
    next: "EMISSAO_DOCUMENTAL",
    steps: [
      { ordem: 1, stepKey: "localizar_registro", title: "Localizar registro da certidão",
        description: "Localizar o registro civil e preencher os dados registrais necessários.",
        weight: 100, ownerKey: "equipe_documental", slaDays: 5 },
    ],
  },

  EMISSAO_DOCUMENTAL: {
    code: "EMISSAO_DOCUMENTAL", phaseKey: "emissao_documental", ordem: 1, label: "Emissão documental", kind: "documento", scope: "DOCUMENTO",
    next: "ANALISE_DOCUMENTAL",
    steps: [
      { ordem: 1, stepKey: "solicitar_certidao", title: "Solicitar certidão",
        description: "Enviar requerimento ao cartório e registrar protocolo retornado.",
        weight: 25, ownerKey: "daniela_brait", slaDays: 3 },
      { ordem: 2, stepKey: "aguardar_retorno", title: "Aguardar retorno do cartório",
        description: "Aguardar resposta do cartório · follow-ups manuais e automáticos disponíveis.",
        weight: 10, ownerKey: "daniela_brait", slaDays: 15 },
      { ordem: 3, stepKey: "receber_certidao", title: "Receber certidão",
        description: "Upload do PDF da certidão recebida.",
        weight: 18, ownerKey: "daniela_brait", slaDays: 2 },
      { ordem: 4, stepKey: "conferir_certidao", title: "Conferir certidão",
        description: "Inspeção operacional: legibilidade, integridade, dados mínimos, apostila, tradução.",
        weight: 15, ownerKey: "daniela_brait", slaDays: 2 },
      { ordem: 5, stepKey: "validar_certidao", title: "Validar certidão",
        description: "Decisão jurídica final · marca documento como Recebido.",
        weight: 12, ownerKey: "marco_rovatti", slaDays: 1 },
    ],
  },

  // ANÁLISE — por-processo, mas com painel PRÓPRIO (ProcessoAnalise). Não usa processSteps.
  ANALISE_DOCUMENTAL: {
    code: "ANALISE_DOCUMENTAL", phaseKey: "analise_documental", ordem: 2, label: "Análise Documental", kind: "processo", scope: "PROCESSO",
    next: null, steps: [],
  },

  RETIFICACAO_REGISTROS: {
    code: "RETIFICACAO_REGISTROS", phaseKey: "retificacao_registros", ordem: 3, label: "Retificação de registros", kind: "processo", scope: "PROCESSO",
    next: "EMISSAO_DOCUMENTAL_RETIFICADA", steps: [],
    processSteps: [
      { stepKey: "definir_estrategia", title: "Definir estratégia", description: "Definir a via (judicial ou administrativa) e a estratégia da retificação." },
      { stepKey: "montar_dossie", title: "Montar dossiê", description: "Reunir os documentos e provas do pedido de retificação." },
      { stepKey: "protocolar", title: "Protocolar retificação", description: "Dar entrada do pedido de retificação no órgão competente." },
      { stepKey: "acompanhar", title: "Acompanhar andamento", description: "Registrar movimentações e exigências até a decisão." },
      { stepKey: "receber_decisao", title: "Receber decisão / averbação", description: "Registrar a decisão ou averbação recebida." },
      { stepKey: "validar_registros", title: "Validar registros corrigidos", description: "Confirmar que os registros foram corrigidos." },
    ],
  },

  EMISSAO_DOCUMENTAL_RETIFICADA: {
    code: "EMISSAO_DOCUMENTAL_RETIFICADA", phaseKey: "emissao_documental_retificada", ordem: 4, label: "Emissão documental retificada", kind: "processo", scope: "PROCESSO",
    next: "TRADUCAO_JURAMENTADA", steps: [],
    processSteps: [
      { stepKey: "enviar_pedido_averbacao", title: "Enviar pedido de averbação ao cartório", description: "Enviar ao cartório a decisão/mandado para lançar a averbação no registro." },
      { stepKey: "solicitar_certidao_retificada", title: "Solicitar certidão retificada", description: "Pedir a nova certidão já com a correção averbada." },
      { stepKey: "aguardar_retorno_cartorio_retificado", title: "Aguardar retorno do cartório", description: "Aguardar o retorno do cartório." },
      { stepKey: "receber_certidao_retificada", title: "Receber certidão retificada", description: "Upload da certidão retificada recebida." },
      { stepKey: "conferir_certidao_retificada", title: "Conferir certidão retificada", description: "Verificar se a correção foi aplicada corretamente." },
      { stepKey: "validar_certidao_retificada", title: "Validar certidão retificada", description: "Validação jurídica da certidão retificada." },
    ],
  },

  TRADUCAO_JURAMENTADA: {
    code: "TRADUCAO_JURAMENTADA", phaseKey: "traducao_juramentada", ordem: 5, label: "Tradução juramentada", kind: "processo", scope: "PROCESSO",
    next: "APOSTILAMENTO", steps: [],
    processSteps: [
      { stepKey: "montar_pasta_traducao", title: "Montar pasta de tradução", description: "Reunir os documentos que vão para tradução numa pasta única." },
      { stepKey: "enviar_tradutor_juramentado", title: "Enviar ao tradutor juramentado", description: "Encaminhar a pasta ao tradutor juramentado." },
      { stepKey: "aguardar_retorno_tradutor", title: "Aguardar retorno do tradutor", description: "Acompanhar o prazo e o retorno do tradutor." },
      { stepKey: "receber_traducoes", title: "Receber traduções", description: "Upload das traduções recebidas." },
      { stepKey: "conferir_traducoes", title: "Conferir traduções", description: "Verificar fidelidade e completude das traduções." },
      { stepKey: "validar_pasta_traduzida", title: "Validar pasta traduzida", description: "Validação jurídica da pasta traduzida." },
    ],
  },

  APOSTILAMENTO: {
    code: "APOSTILAMENTO", phaseKey: "apostilamento", ordem: 6, label: "Apostilamento", kind: "processo", scope: "PROCESSO",
    next: "AGUARDANDO_PROTOCOLO", steps: [],
    processSteps: [
      { stepKey: "montar_pasta_apostilamento", title: "Montar pasta de apostilamento", description: "Reunir os documentos finais numa pasta para apostila." },
      { stepKey: "enviar_para_apostilamento", title: "Enviar para apostilamento", description: "Encaminhar para apostila de Haia." },
      { stepKey: "aguardar_retorno_apostilamento", title: "Aguardar retorno", description: "Acompanhar o prazo e o retorno." },
      { stepKey: "receber_documentos_apostilados", title: "Receber documentos apostilados", description: "Upload dos documentos apostilados." },
      { stepKey: "conferir_apostilas", title: "Conferir apostilas", description: "Verificar as apostilas e a legibilidade." },
      { stepKey: "validar_pasta_apostilada", title: "Validar pasta apostilada", description: "Validação final da pasta apostilada." },
    ],
  },

  AGUARDANDO_PROTOCOLO: {
    code: "AGUARDANDO_PROTOCOLO", phaseKey: "aguardando_protocolo", ordem: 7, label: "Aguardando protocolo", kind: "processo", scope: "PROCESSO",
    next: "PROTOCOLADO", steps: [],
    processSteps: [
      { stepKey: "montar_dossie_final", title: "Montar dossiê final", description: "Reúna todos os documentos apostilados e traduzidos em um dossiê único." },
      { stepKey: "agendar_protocolo", title: "Agendar protocolo", description: "Defina o órgão de destino, a data e o canal de protocolo." },
      { stepKey: "protocolar_pedido", title: "Protocolar pedido", description: "Registre o protocolo do pedido no órgão (número/recibo)." },
    ],
  },

  PROTOCOLADO: {
    code: "PROTOCOLADO", phaseKey: "protocolado", ordem: 8, label: "Protocolado", kind: "processo", scope: "PROCESSO",
    next: "FINALIZADO", steps: [],
    processSteps: [
      { stepKey: "registrar_protocolo", title: "Registrar nº do protocolo", description: "Confirme o número/recibo e a data de entrada no órgão." },
      { stepKey: "acompanhar_andamento", title: "Acompanhar andamento", description: "Registre exigências, contatos e movimentações junto ao órgão." },
      { stepKey: "receber_decisao", title: "Receber decisão", description: "Registre o resultado: deferido, exigência ou indeferido." },
    ],
  },

  FINALIZADO: {
    code: "FINALIZADO", phaseKey: "finalizado", ordem: 9, label: "Finalizado", kind: "processo", scope: "PROCESSO",
    next: null, steps: [],
    processSteps: [
      { stepKey: "confirmar_deferimento", title: "Confirmar deferimento", description: "Confirme o reconhecimento da cidadania / deferimento do pedido." },
      { stepKey: "entregar_documentacao", title: "Entregar documentação ao cliente", description: "Registre a entrega da documentação final ao requerente." },
      { stepKey: "encerrar_processo", title: "Encerrar e arquivar", description: "Encerre o processo e arquive toda a documentação." },
    ],
  },
}

// ── Helpers ──────────────────────────────────────────────────────────────
export function getFase(code: FaseCode): FaseDef { return FASES[code] }
export function getStepsForFase(code: FaseCode): FaseStep[] { return FASES[code].steps }
export function getProcessSteps(code: FaseCode): ProcessFaseStep[] { return FASES[code].processSteps ?? [] }
export function getNextFase(code: FaseCode): FaseCode | null { return FASES[code].next }
export function isProcessoFase(code: FaseCode): boolean { return FASES[code].kind === "processo" }
export function isFaseReady(code: FaseCode): boolean {
  const f = FASES[code]
  return !f.pendingSpec && f.steps.length > 0
}
export function getOrdemFase(code: FaseCode): number { return FASES[code].ordem }
export function getFaseByOrdem(ordem: number): FaseCode | null {
  const found = Object.values(FASES).find((f) => f.ordem === ordem)
  return found ? found.code : null
}

// ── Conversão canônica faseCode ⇄ phaseKey ─────────────────────────────────
// ÚNICA fonte da ponte entre o enum FaseCode (Prisma) e a chave estável phaseKey
// usada no banco. NENHUM outro ponto do código deve fazer toUpperCase/toLowerCase
// para converter — sempre passar por aqui. Renomear/adicionar fase = mudar só o
// catálogo acima.

const PHASEKEY_TO_CODE: Record<string, FaseCode> = Object.fromEntries(
  Object.values(FASES).map((f) => [f.phaseKey, f.code])
) as Record<string, FaseCode>

/** faseCode (enum) → phaseKey estável. Fallback tolerante p/ códigos fora do catálogo. */
export function faseCodeToPhaseKey(code: FaseCode | string | null | undefined): string | null {
  if (!code) return null
  return FASES[code as FaseCode]?.phaseKey ?? String(code).toLowerCase()
}

/** phaseKey (ou faseAtualKey do banco) → faseCode do catálogo. null se desconhecido. */
export function phaseKeyToFaseCode(phaseKey: string | null | undefined): FaseCode | null {
  if (!phaseKey) return null
  const k = String(phaseKey)
  return PHASEKEY_TO_CODE[k] ?? PHASEKEY_TO_CODE[k.toLowerCase()] ?? null
}

// ── Compatibilidade de stepKey (legado → passo publicado atual) ─────────────
// FONTE ÚNICA e DETERMINÍSTICA para migração v2: quando um passo publicado é
// renomeado/redesenhado, mapeie aqui o stepKey legado → o atual. Sem adivinhação
// por texto/similaridade. Renomear passo ou limpar junk = ajustar SÓ este mapa.
// Não altera dados legados nem publicados — é só a ponte de resolução do backfill.
const STEP_KEY_ALIASES: Record<string, Record<string, string>> = {
  // Genealogia UNIFICADA: o passo canônico é "localizar_registro" (sem alias). O
  // workflow interno publicado, o editor e a execução usam exatamente este stepKey.
  emissao_documental: {
    aguardar_retorno: "aguardar_retorno_do_cartorio", // rename do mesmo passo
  },
}

/** Resolve o stepKey LEGADO para o stepKey PUBLICADO atual (alias), ou retorna o próprio. */
export function resolveStepKeyCompat(phaseKey: string | null | undefined, stepKey: string): string {
  if (!phaseKey) return stepKey
  return STEP_KEY_ALIASES[String(phaseKey).toLowerCase()]?.[stepKey] ?? stepKey
}
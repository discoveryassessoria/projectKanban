// ============================================================================
// NÚCLEO PURO DA ENGINE DE SLA (sem I/O)
// ----------------------------------------------------------------------------
// ÚNICA fonte de cálculo de prazo do Discovery. Recebe um snapshot já carregado
// (SlaInput) e devolve a SlaProcesso. Não toca no banco, não formata tela, não
// decide permissão. As duas camadas de I/O — resolveSlaProjection (1) e
// resolveSlaProjectionBatch (N), em src/lib/process-stage/sla-projection.ts —
// apenas carregam o snapshot e chamam este núcleo, garantindo contrato e lógica
// IDÊNTICOS na Central Operacional, na listagem e no detalhe do processo.
//
// O QUE ESTA CAMADA **NÃO** FAZ: não escreve, não altera e não reinterpreta a
// CONFIGURAÇÃO de SLA. O cadastro (FaseMacro.slaDays do Workflow Macro do Tipo
// de Processo) continua sendo a única fonte de verdade; aqui ele é apenas
// aplicado ao estado real do processo.
//
// REGRA DO PRAZO TOTAL: soma dos SLAs das fases OBRIGATÓRIAS, na ordem do fluxo
// — exatamente o "acumulado" já exibido em Processos › Configurações › SLA
// (SLAConfiguracaoTab). Fase opcional/condicional não infla o prazo contratado.
//
// SEMÁFORO (regra do negócio):
//   🟢 no prazo             — ainda dentro do prazo
//   🟡 próximo do vencimento — faltam até 7 dias (inclui vencer hoje)
//   🔴 atrasado             — prazo vencido
// ============================================================================

import { diasEntreDatas, somarDiasCivis } from "@/src/lib/date-utils"
import type {
  FaixaSla,
  ProximoVencimentoSla,
  SlaFaseAtual,
  SlaFaseResponsavel,
  SlaProcesso,
  StatusSla,
} from "@/src/types/sla"

/** Janela de atenção: a partir daqui o prazo fica amarelo. */
export const DIAS_ATENCAO_SLA = 7

/** Fase terminal do fluxo — processo nela não é trabalho operacional em curso. */
export const FASE_FINAL_SLA = "finalizado"

/** Instâncias que NÃO consumiram tempo da fase (nunca chegaram a rodar). */
const INSTANCIA_DESCARTADA = new Set(["CANCELADO", "FALHOU"])

// ---------------------------------------------------------------------------
// SNAPSHOT DE ENTRADA (o que o resolver carrega do banco)
// ---------------------------------------------------------------------------

/** Fase do Workflow Macro — a CONFIGURAÇÃO de SLA, lida sem alteração. */
export interface SlaFaseConfig {
  phaseKey: string
  label: string
  ordem: number
  required: boolean
  slaDays: number
}

/** Execução real de uma fase (PhaseWorkflowInstance), incluindo reaberturas. */
export interface SlaInstanciaFase {
  faseMacroKey: string
  ciclo: number
  status: string
  startedAt: Date | null
  completedAt: Date | null
  createdAt: Date
}

export interface SlaInput {
  processoId: number
  /** Processo.dataInicio (fallback: createdAt) */
  inicio: Date | null
  dataConclusao: Date | null
  faseAtualKey: string | null
  /** fases do Workflow Macro do Tipo de Processo, na ordem do fluxo */
  fases: SlaFaseConfig[]
  /** instâncias de fase do processo (todos os ciclos) */
  instancias: SlaInstanciaFase[]
  /** instante de referência da leitura ("agora") */
  hoje: Date
}

// ---------------------------------------------------------------------------
// CLASSIFICAÇÃO
// ---------------------------------------------------------------------------

/** Semáforo a partir dos dias que faltam (assinado). null = sem SLA configurado. */
export function classificarSla(diasParaVencimento: number | null): StatusSla {
  if (diasParaVencimento === null) return "sem_prazo"
  if (diasParaVencimento < 0) return "atrasado"
  if (diasParaVencimento <= DIAS_ATENCAO_SLA) return "proximo_vencimento"
  return "no_prazo"
}

/**
 * Faixa da Central Operacional. É um REFINAMENTO do semáforo (separa "vence
 * hoje" de "vence nos próximos 7 dias"), nunca uma segunda regra: as fronteiras
 * são as mesmas de `classificarSla`.
 * Processo concluído ou sem SLA configurado não entra em faixa nenhuma.
 */
export function faixaSla(p: {
  configurado: boolean
  concluido: boolean
  diasParaVencimento: number | null
}): FaixaSla | null {
  if (!p.configurado || p.concluido || p.diasParaVencimento === null) return null
  if (p.diasParaVencimento < 0) return "atrasados"
  if (p.diasParaVencimento === 0) return "vencem-hoje"
  if (p.diasParaVencimento <= DIAS_ATENCAO_SLA) return "proximos-7"
  return "no-prazo"
}

export const ROTULO_STATUS_SLA: Record<StatusSla, string> = {
  no_prazo: "No prazo",
  proximo_vencimento: "Próximo do vencimento",
  atrasado: "Atrasado",
  sem_prazo: "Sem prazo definido",
}

/** Texto da coluna "Dias" — mesmo vocabulário em toda a aplicação. */
export function rotuloDiasSla(diasParaVencimento: number | null): string {
  if (diasParaVencimento === null) return "—"
  if (diasParaVencimento < 0) {
    const d = Math.abs(diasParaVencimento)
    return d === 1 ? "1 dia atrasado" : `${d} dias atrasado`
  }
  if (diasParaVencimento === 0) return "Vence hoje"
  if (diasParaVencimento === 1) return "Vence amanhã"
  return `Vence em ${diasParaVencimento} dias`
}

// ---------------------------------------------------------------------------
// MOTOR
// ---------------------------------------------------------------------------

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)
const naoNegativo = (n: number) => (n > 0 ? n : 0)

/** Início real de uma instância de fase: quando começou, ou quando foi criada. */
function inicioDaInstancia(i: SlaInstanciaFase): Date {
  return i.startedAt ?? i.createdAt
}

/**
 * Projeção de SLA de um processo. Determinística: mesmo snapshot ⇒ mesmo
 * resultado (o único "agora" é `input.hoje`, sempre injetado).
 */
export function buildSlaProjection(input: SlaInput): SlaProcesso {
  const { processoId, faseAtualKey, fases, instancias, hoje } = input

  const inicio = input.inicio
  const concluido = input.dataConclusao != null || faseAtualKey === FASE_FINAL_SLA

  // Instâncias que efetivamente consumiram tempo, agrupadas por fase.
  const instanciasVivas = instancias.filter((i) => !INSTANCIA_DESCARTADA.has(String(i.status).toUpperCase()))
  const porFase = new Map<string, SlaInstanciaFase[]>()
  for (const i of instanciasVivas) {
    const arr = porFase.get(i.faseMacroKey) ?? []
    arr.push(i)
    porFase.set(i.faseMacroKey, arr)
  }

  // Congelamento na conclusão: um processo encerrado não "atrasa" mais a cada dia.
  const ultimaConclusao = instanciasVivas
    .map((i) => i.completedAt)
    .filter((d): d is Date => d != null)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null
  const referencia = concluido ? (input.dataConclusao ?? ultimaConclusao ?? hoje) : hoje

  // ---- Prazo contratado do processo (configuração, sem reinterpretação) ----
  const prazoTotalDias = fases.reduce((soma, f) => (f.required ? soma + Math.max(0, f.slaDays) : soma), 0)
  const configurado = fases.length > 0 && prazoTotalDias > 0 && inicio != null

  const prazoPrevisto = configurado && inicio ? somarDiasCivis(inicio, prazoTotalDias) : null
  const diasDecorridos = inicio ? naoNegativo(diasEntreDatas(referencia, inicio)) : 0
  const diasParaVencimento = prazoPrevisto ? diasEntreDatas(prazoPrevisto, referencia) : null
  const status = classificarSla(diasParaVencimento)

  // ---- SLA da fase atual ----
  const faseAtual = montarFaseAtual({ faseAtualKey, fases, porFase, referencia })

  // ---- Fase responsável pelo atraso ----
  const faseResponsavelAtraso = acharFaseResponsavel({ fases, porFase, referencia })

  // ---- Próximo vencimento ----
  const proximoVencimento = concluido
    ? null
    : acharProximoVencimento({ prazoPrevisto, faseAtual, referencia })

  return {
    processoId,
    configurado,
    concluido,
    status,
    faixa: faixaSla({ configurado, concluido, diasParaVencimento }),
    inicio: iso(inicio),
    prazoPrevisto: iso(prazoPrevisto),
    prazoTotalDias,
    diasDecorridos,
    diasParaVencimento,
    diasRestantes: naoNegativo(diasParaVencimento ?? 0),
    diasAtraso: naoNegativo(-(diasParaVencimento ?? 0)),
    faseAtual,
    faseResponsavelAtraso,
    proximoVencimento,
    rotuloDias: rotuloDiasSla(diasParaVencimento),
    rotuloStatus: ROTULO_STATUS_SLA[status],
  }
}

function montarFaseAtual(p: {
  faseAtualKey: string | null
  fases: SlaFaseConfig[]
  porFase: Map<string, SlaInstanciaFase[]>
  referencia: Date
}): SlaFaseAtual | null {
  const { faseAtualKey, fases, porFase, referencia } = p
  if (!faseAtualKey) return null

  const cfg = fases.find((f) => f.phaseKey === faseAtualKey) ?? null
  // Instância corrente da fase = maior ciclo ainda sem conclusão; se todas já
  // concluíram (fase encerrada aguardando avanço), vale a de maior ciclo.
  const doProcesso = [...(porFase.get(faseAtualKey) ?? [])].sort((a, b) => b.ciclo - a.ciclo)
  const corrente = doProcesso.find((i) => i.completedAt == null) ?? doProcesso[0] ?? null

  const slaDias = Math.max(0, cfg?.slaDays ?? 0)
  const inicio = corrente ? inicioDaInstancia(corrente) : null
  const fim = corrente?.completedAt ?? referencia
  const prazo = inicio && slaDias > 0 ? somarDiasCivis(inicio, slaDias) : null
  const diasParaVencimento = prazo ? diasEntreDatas(prazo, referencia) : null

  return {
    phaseKey: faseAtualKey,
    label: cfg?.label ?? faseAtualKey.replace(/_/g, " "),
    slaDias,
    inicio: iso(inicio),
    prazo: iso(prazo),
    diasDecorridos: inicio ? naoNegativo(diasEntreDatas(fim, inicio)) : 0,
    diasParaVencimento,
    diasRestantes: naoNegativo(diasParaVencimento ?? 0),
    diasAtraso: naoNegativo(-(diasParaVencimento ?? 0)),
    status: classificarSla(diasParaVencimento),
  }
}

/**
 * Fase que estourou o próprio SLA com a MAIOR sobra. Percorre todas as fases
 * configuradas somando o tempo real gasto em cada uma (todos os ciclos: uma
 * reabertura devolve o processo à fase e o tempo volta a correr).
 * Empate resolve pela ordem do fluxo — a primeira a atrasar é a responsável.
 */
function acharFaseResponsavel(p: {
  fases: SlaFaseConfig[]
  porFase: Map<string, SlaInstanciaFase[]>
  referencia: Date
}): SlaFaseResponsavel | null {
  const { fases, porFase, referencia } = p
  let melhor: SlaFaseResponsavel | null = null

  for (const f of fases) {
    const slaDias = Math.max(0, f.slaDays)
    if (slaDias <= 0) continue
    const execucoes = porFase.get(f.phaseKey) ?? []
    if (execucoes.length === 0) continue

    let diasConsumidos = 0
    let emAndamento = false
    for (const i of execucoes) {
      const fim = i.completedAt ?? referencia
      if (i.completedAt == null) emAndamento = true
      diasConsumidos += naoNegativo(diasEntreDatas(fim, inicioDaInstancia(i)))
    }

    const diasExcedidos = diasConsumidos - slaDias
    if (diasExcedidos <= 0) continue
    if (melhor && (melhor.diasExcedidos > diasExcedidos || (melhor.diasExcedidos === diasExcedidos && melhor.ordem <= f.ordem))) {
      continue
    }
    melhor = {
      phaseKey: f.phaseKey,
      label: f.label,
      ordem: f.ordem,
      slaDias,
      diasConsumidos,
      diasExcedidos,
      emAndamento,
    }
  }

  return melhor
}

/** Prazo mais próximo ainda por vencer: o da fase atual ou o do processo. */
function acharProximoVencimento(p: {
  prazoPrevisto: Date | null
  faseAtual: SlaFaseAtual | null
  referencia: Date
}): ProximoVencimentoSla | null {
  const { prazoPrevisto, faseAtual, referencia } = p
  const candidatos: ProximoVencimentoSla[] = []

  if (faseAtual?.prazo) {
    const dias = diasEntreDatas(new Date(faseAtual.prazo), referencia)
    if (dias >= 0) {
      candidatos.push({
        data: faseAtual.prazo,
        origem: "fase",
        rotulo: `Fase ${faseAtual.label}`,
        diasRestantes: dias,
      })
    }
  }
  if (prazoPrevisto) {
    const dias = diasEntreDatas(prazoPrevisto, referencia)
    if (dias >= 0) {
      candidatos.push({
        data: prazoPrevisto.toISOString(),
        origem: "processo",
        rotulo: "Conclusão do processo",
        diasRestantes: dias,
      })
    }
  }
  if (candidatos.length === 0) return null
  return candidatos.sort((a, b) => a.diasRestantes - b.diasRestantes)[0]
}

/** Projeção "vazia" — processo inexistente. Nunca lança, nunca inventa prazo. */
export function slaVazio(processoId: number): SlaProcesso {
  return {
    processoId,
    configurado: false,
    concluido: false,
    status: "sem_prazo",
    faixa: null,
    inicio: null,
    prazoPrevisto: null,
    prazoTotalDias: 0,
    diasDecorridos: 0,
    diasParaVencimento: null,
    diasRestantes: 0,
    diasAtraso: 0,
    faseAtual: null,
    faseResponsavelAtraso: null,
    proximoVencimento: null,
    rotuloDias: "—",
    rotuloStatus: ROTULO_STATUS_SLA.sem_prazo,
  }
}

// lib/operacional/motor-prazo-sla.ts
// ============================================================================
// MOTOR UNIVERSAL DE CÁLCULO — mandato "Módulo de Prazos, SLA e Políticas de
// Acompanhamento" (22/09/2026). Fonte ÚNICA para calcular prazo geral,
// acompanhamentos e classificar risco a partir de uma Política de Prazo/SLA
// publicada. Não replica cálculo em API/interface/cron/worker — todos devem
// chamar aqui.
//
// FRONTEIRA: este arquivo NÃO decide nada sobre os "dois relógios" de
// StepSubtaskDefinition/SubtaskExecution (`lib/operacional/tempo-operacional.ts`,
// congelado 19-20/09/2026) — são motores irmãos, não um substituindo o outro.
// Este aqui governa o prazoDaTarefa único e o acompanhamento vindos de uma
// Política de Prazo/SLA cadastrada em Gerenciamento; aquele outro governa a
// execução materializada de um Workflow Interno publicado.
//
// PURO — zero Prisma, zero `new Date()` interno (todo "agora" é parâmetro
// explícito), determinístico e testável com relógio controlado. Reaproveita
// o mesmo fuso operacional e o mesmo calendário nacional brasileiro de
// `tempo-operacional.ts`/`diasUteis.ts` — nunca uma segunda régua de dia útil.
// ============================================================================
import { isFimDeSemana, isFeriado as isFeriadoNacional } from "@/src/lib/diasUteis"
import { FUSO_OPERACIONAL, diaOperacional } from "./tempo-operacional"

export type UnidadePrazoSla = "DIAS_CORRIDOS" | "DIAS_UTEIS"
export type TratamentoDia = "PULA" | "CONTA"
export type PoliticaDataNaoUtil = "PROXIMO_DIA_UTIL" | "DIA_UTIL_ANTERIOR"
export type EstadoRiscoPrazoSla = "DENTRO_DO_PRAZO" | "PROXIMO_DO_VENCIMENTO" | "VENCIDO"
export type OrigemDaEspera = "INTERNA" | "TERCEIRO"

/** Um feriado customizado — `"AAAA-MM-DD"` (recorrente) ou instância completa. */
export interface FeriadoCalendarioEntrada {
  data: Date
  recorrenteAnual: boolean
}

/** Parâmetros de contagem de dias — compartilhados pelo prazo geral e pelo acompanhamento. */
export interface ParametrosContagemDias {
  unidade: UnidadePrazoSla
  tratamentoFimDeSemana: TratamentoDia
  tratamentoFeriado: TratamentoDia
  /** `null`/vazio = só o calendário nacional (`diasUteis.ts`). */
  feriadosCustom?: FeriadoCalendarioEntrada[]
}

function mesmoDiaCivil(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function ehFeriadoCustom(d: Date, feriados: FeriadoCalendarioEntrada[] | undefined): boolean {
  if (!feriados || feriados.length === 0) return false
  return feriados.some((f) => {
    if (f.recorrenteAnual) return d.getMonth() === f.data.getMonth() && d.getDate() === f.data.getDate()
    return mesmoDiaCivil(d, f.data)
  })
}

/**
 * Um dia CONTA para a contagem do prazo/acompanhamento? As duas dimensões
 * (unidade × tratamento) são independentes por design — "dias úteis" com
 * `tratamentoFeriado: CONTA` é uma combinação legítima (o cadastro decide,
 * o motor nunca recusa uma combinação por conta própria).
 */
export function diaContaParaPrazo(d: Date, p: ParametrosContagemDias): boolean {
  const fds = isFimDeSemana(d)
  const feriado = isFeriadoNacional(d) || ehFeriadoCustom(d, p.feriadosCustom)
  if (p.unidade === "DIAS_CORRIDOS") {
    if (fds && p.tratamentoFimDeSemana === "PULA") return false
    if (feriado && p.tratamentoFeriado === "PULA") return false
    return true
  }
  // DIAS_UTEIS: só conta se NÃO for fim de semana/feriado, a menos que o
  // tratamento diga explicitamente CONTA (o cadastro pede pra ignorar aquela
  // exceção normalmente aplicada).
  if (fds && p.tratamentoFimDeSemana !== "CONTA") return false
  if (feriado && p.tratamentoFeriado !== "CONTA") return false
  return true
}

export function ehDiaUtilNoCalendario(d: Date, feriadosCustom?: FeriadoCalendarioEntrada[]): boolean {
  return !isFimDeSemana(d) && !isFeriadoNacional(d) && !ehFeriadoCustom(d, feriadosCustom)
}

/** Soma `quantidade` dias que CONTAM (por `diaContaParaPrazo`) a partir de `base`. */
function somarDiasQueContam(base: Date, quantidade: number, p: ParametrosContagemDias): Date {
  const d = new Date(base.getTime())
  let restantes = quantidade
  while (restantes > 0) {
    d.setDate(d.getDate() + 1)
    if (diaContaParaPrazo(d, p)) restantes--
  }
  return d
}

/** Ajusta uma data que caiu em dia não útil para o dia útil vizinho pedido pela política. */
function ajustarDataNaoUtil(d: Date, politica: PoliticaDataNaoUtil, feriadosCustom?: FeriadoCalendarioEntrada[]): Date {
  const resultado = new Date(d.getTime())
  const passo = politica === "DIA_UTIL_ANTERIOR" ? -1 : 1
  while (!ehDiaUtilNoCalendario(resultado, feriadosCustom)) {
    resultado.setDate(resultado.getDate() + passo)
  }
  return resultado
}

function aplicarHorarioLimite(d: Date, horarioLimite: string | null | undefined): Date {
  if (!horarioLimite) return d
  const m = /^(\d{2}):(\d{2})$/.exec(horarioLimite)
  if (!m) return d
  const resultado = new Date(d.getTime())
  resultado.setHours(Number(m[1]), Number(m[2]), 0, 0)
  return resultado
}

export interface ParametrosPrazoGeral extends ParametrosContagemDias {
  quantidade: number
  politicaDataNaoUtil: PoliticaDataNaoUtil
  horarioLimite?: string | null
}

/**
 * O PRAZO GERAL DA TAREFA — o único prazo que existe (mandato: "existe
 * somente UM prazo por tarefa/operação"). `quantidade <= 0` é configuração
 * inválida — o chamador deve ter bloqueado isso na publicação; aqui só
 * devolve `null` em vez de inventar um prazo (mesma honestidade de
 * `prazoOperacional`).
 */
export function calcularPrazoGeral(base: Date, p: ParametrosPrazoGeral): Date | null {
  if (!Number.isFinite(p.quantidade) || p.quantidade <= 0) return null
  const bruto = somarDiasQueContam(base, p.quantidade, p)
  const ajustado = ajustarDataNaoUtil(bruto, p.politicaDataNaoUtil, p.feriadosCustom)
  return aplicarHorarioLimite(ajustado, p.horarioLimite)
}

/** Acompanhamento (primeiro ou seguinte) — MESMA régua de contagem, nunca prazo/SLA. */
export function calcularAcompanhamento(base: Date, quantidade: number, p: ParametrosContagemDias): Date | null {
  if (!Number.isFinite(quantidade) || quantidade <= 0) return null
  return somarDiasQueContam(base, quantidade, p)
}

/**
 * Classifica o risco de um prazo — a régua única de "dentro do prazo /
 * próximo do vencimento / vencido". Compara por DIA OPERACIONAL (fuso
 * `America/Sao_Paulo`), nunca por instante — mesma razão documentada em
 * `tempo-operacional.ts`: um prazo não vence às 14h24, vence NO DIA.
 */
export function classificarRisco(agora: Date, prazo: Date | null, antecedenciaDias: number): EstadoRiscoPrazoSla | null {
  if (!prazo) return null
  const diaAgora = diaOperacional(agora)
  const diaPrazo = diaOperacional(prazo)
  if (diaPrazo < diaAgora) return "VENCIDO"
  if (diaPrazo === diaAgora) return "VENCIDO" // vence NO DIA — dia do prazo já é o limite, não "próximo"
  const limiteRisco = new Date(prazo.getTime())
  limiteRisco.setDate(limiteRisco.getDate() - Math.max(0, antecedenciaDias))
  const diaLimiteRisco = diaOperacional(limiteRisco)
  if (diaAgora >= diaLimiteRisco) return "PROXIMO_DO_VENCIMENTO"
  return "DENTRO_DO_PRAZO"
}

/** O acompanhamento já venceu (chegou a data e ninguém retornou à atenção)? */
export function acompanhamentoVencido(agora: Date, proximoAcompanhamentoEm: Date | null): boolean {
  if (!proximoAcompanhamentoEm) return false
  return diaOperacional(proximoAcompanhamentoEm) <= diaOperacional(agora)
}

export { FUSO_OPERACIONAL, diaOperacional }

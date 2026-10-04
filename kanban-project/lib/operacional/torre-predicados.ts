// lib/operacional/torre-predicados.ts
// ============================================================================
// PREDICADOS PUROS DA TORRE — sem Prisma, importáveis pela tela e pelo servidor.
// A mesma conta nos dois lados é o que faz o "N" de um botão bater com a lista.
// ============================================================================
import { diasEntreDiasOperacionais } from './tempo-operacional'

/** O que a Torre precisa saber de uma linha para decidir "cobrança vencida". */
export interface LinhaParaCobranca {
  acompanhamentoVencido: boolean
  faseMacroKey: string | null
  estadoOperacao: 'FILA' | 'AGUARDANDO' | 'CONCLUIDA'
  /** Data marcada para cobrar (ISO). Hoje ou passada = precisa cobrar, mesmo que o acompanhamento do passo ainda não tenha vencido. */
  cobrarEm?: string | null
}

/**
 * "PRECISA COBRAR" — o ÚNICO predicado: cartão "Cobranças a fazer", botão "Cobrar todos os vencidos", selo "N a cobrar" da aba
 * Terceiros, filtro "Cobranças vencidas" e a lista de pedidos. É verdade quando o acompanhamento do passo venceu OU a data de
 * cobrança é hoje/passou (dia operacional) — fora da Genealogia (lá o "terceiro" é o trabalho de localizar, não um cartório a
 * cobrar), sem tarefa encerrada, e a data só vale para pedido (tarefa AGUARDANDO).
 */
export function ehCobravelVencido(l: LinhaParaCobranca, agora: Date = new Date()): boolean {
  if (l.faseMacroKey === 'genealogia' || l.estadoOperacao === 'CONCLUIDA') return false
  if (l.acompanhamentoVencido) return true
  if (l.estadoOperacao !== 'AGUARDANDO' || !l.cobrarEm) return false
  const alvo = new Date(l.cobrarEm)
  return !Number.isNaN(alvo.getTime()) && diasEntreDiasOperacionais(alvo, agora) <= 0
}

// ─── CARGA POR PESSOA — a conta da Operação, sobre as MESMAS linhas ─────────

export interface LinhaParaCarga {
  responsavelId: number | null
  statusTarefa: string
  atrasada: boolean
  estadoOperacao: 'FILA' | 'AGUARDANDO' | 'CONCLUIDA'
}

export interface CargaDaPessoa {
  /** Tudo o que está aberto e é dela. */
  ativas: number
  /** Ativas que dependem DELA agora — fora as que esperam terceiro/cliente e as bloqueadas (a conta que o limite do cadastro governa). */
  executaveis: number
  atrasadas: number
  /** "Aguard." — as que estão com o cartório (`estadoOperacao: AGUARDANDO`, o "Aguardando terceiros" da Torre). */
  aguardando: number
}

const ESPERA_OU_BLOQUEIO = ['AGUARDANDO_TERCEIRO', 'AGUARDANDO_CLIENTE', 'BLOQUEADA']

/** "Executável" = depende da PESSOA agora (não espera terceiro/cliente nem está bloqueada). O predicado ÚNICO da carga, da sugestão e da simulação. */
export const ehExecutavel = (statusTarefa: string): boolean => !ESPERA_OU_BLOQUEIO.includes(statusTarefa)

/**
 * A CARGA DE CADA PESSOA a partir das linhas da Operação. Uma conta só: a aba
 * Equipe, o item "Carga" e a regra r3 leem daqui — não pode haver duas contas
 * diferentes para o mesmo fato.
 */
export function cargaPorPessoa(linhas: LinhaParaCarga[]): Map<number, CargaDaPessoa> {
  const mapa = new Map<number, CargaDaPessoa>()
  for (const l of linhas) {
    if (l.responsavelId == null || l.estadoOperacao === 'CONCLUIDA') continue
    const c = mapa.get(l.responsavelId) ?? { ativas: 0, executaveis: 0, atrasadas: 0, aguardando: 0 }
    c.ativas++
    if (ehExecutavel(l.statusTarefa)) c.executaveis++
    if (l.atrasada) c.atrasadas++
    if (l.estadoOperacao === 'AGUARDANDO') c.aguardando++
    mapa.set(l.responsavelId, c)
  }
  return mapa
}

// ─── FAIXAS DE COR (regras do mandato H1) ───────────────────────────────────

export type FaixaDaCarga = 'verde' | 'ambar' | 'vermelha'
/** Barra de carga: verde < 70 %, âmbar ≥ 70 %, vermelha ≥ 100 %. */
export const faixaDaCarga = (pct: number): FaixaDaCarga => (pct >= 100 ? 'vermelha' : pct >= 70 ? 'ambar' : 'verde')

export type FaixaDaFila = 'vermelho' | 'ambar' | 'livre' | 'sem_base'
/**
 * Fila em semanas: ≥ 2 vermelho, ≥ 1 âmbar, senão "livre". `null` COM trabalho é
 * "sem base" (nenhuma conclusão medida nas últimas semanas): não há como estimar,
 * e dizer "livre" seria mentir.
 */
export function faixaDaFila(semanas: number | null, ativas: number): FaixaDaFila {
  if (semanas == null) return ativas > 0 ? 'sem_base' : 'livre'
  return semanas >= 2 ? 'vermelho' : semanas >= 1 ? 'ambar' : 'livre'
}

/** Previsão de carga: n ≥ 5 → 3, ≥ 3 → 2, > 0 → 1, senão 0 (a escala do protótipo). */
export const nivelDaPrevisao = (n: number): 0 | 1 | 2 | 3 => (n >= 5 ? 3 : n >= 3 ? 2 : n > 0 ? 1 : 0)

// ─── HÁ QUANTO TEMPO NA FASE ────────────────────────────────────────────────

/** O texto de "há quanto tempo" — `—` sem data (NUNCA "0 d" fingindo precisão), horas até completar 1 dia, depois dias. */
export function textoTempoNaFase(t: { dias: number | null; horas: number | null } | null | undefined): string {
  if (!t || t.dias == null || t.horas == null) return '—'
  if (t.dias >= 1) return `${t.dias} d`
  return t.horas >= 1 ? `${t.horas} h` : '< 1 h'
}

// lib/operacional/torre-kpis.ts
// ============================================================================
// OS 8 KPIs DA TORRE — Bloco J3 (30/09/2026). PURO: sem Prisma, importável pela tela e pelo servidor.
//
// UMA DEFINIÇÃO, TRÊS USOS: o NÚMERO do cartão, a LISTA que o clique filtra e a FOTO DIÁRIA (E10, cron
// `torre-indicadores`) saem das MESMAS funções sobre as MESMAS linhas da Operação. É isso que garante
// "o número bate com a lista que ele filtra" e que a tendência compara coisas iguais.
// ============================================================================
import { ehCobravelVencido } from './torre-predicados'

export type ChaveKpi = 'venc' | 'v7' | 'semdono' | 'aguard' | 'cob' | 'esc' | 'risco' | 'back'

/** O que os KPIs precisam saber de uma linha (subconjunto de `LinhaDaTorre`). */
export interface LinhaParaKpi {
  processoId: number | null
  responsavelId: number | null
  atrasada: boolean
  diasParaPrazo: number | null
  estadoOperacao: 'FILA' | 'AGUARDANDO' | 'CONCLUIDA'
  acompanhamentoVencido: boolean
  escalada: boolean
  /** O processo desta linha está em risco CRÍTICO (score ≥ 6 do "Precisa de você" — o mesmo do Radar e da aba Processos). Anotado pela rota. */
  processoEmRisco?: boolean
  faseMacroKey: string | null
}

export interface DefinicaoDeKpi {
  chave: ChaveKpi
  rotulo: string
  cor: 'red' | 'amb' | 'blu'
  /** `false` = agregado, não filtra a lista (Decisão 5 do Passo 0: o Backlog). */
  filtra: boolean
}

/** Na ordem do protótipo. */
export const KPIS: DefinicaoDeKpi[] = [
  { chave: 'venc', rotulo: 'Atrasadas', cor: 'red', filtra: true },
  { chave: 'v7', rotulo: 'Vencem em 7 dias', cor: 'amb', filtra: true },
  { chave: 'semdono', rotulo: 'Sem responsável', cor: 'red', filtra: true },
  { chave: 'aguard', rotulo: 'Com o cartório', cor: 'blu', filtra: true },
  { chave: 'cob', rotulo: 'Cobranças vencidas', cor: 'amb', filtra: true },
  { chave: 'esc', rotulo: 'Escaladas pra mim', cor: 'red', filtra: true },
  { chave: 'risco', rotulo: 'Processos em risco', cor: 'red', filtra: true },
  { chave: 'back', rotulo: 'Backlog: abre / fecha por sem.', cor: 'amb', filtra: false },
]

/** Vence nos próximos 7 dias (hoje incluído) e ainda NÃO venceu — vencida já está em "Atrasadas". */
export const vence7 = (l: Pick<LinhaParaKpi, 'atrasada' | 'diasParaPrazo'>): boolean =>
  !l.atrasada && l.diasParaPrazo != null && l.diasParaPrazo >= 0 && l.diasParaPrazo <= 7

type PredicadoDeLinha = (l: LinhaParaKpi) => boolean
export const PREDICADO_DO_KPI: Partial<Record<ChaveKpi, PredicadoDeLinha>> = {
  venc: (l) => l.atrasada,
  v7: vence7,
  semdono: (l) => l.responsavelId == null,
  aguard: (l) => l.estadoOperacao === 'AGUARDANDO',
  cob: (l) => ehCobravelVencido(l),
  esc: (l) => l.escalada,
}

/**
 * PROCESSOS EM RISCO = os de risco CRÍTICO no score do "Precisa de você" (Bloco F) — a mesma palavra "risco" que a
 * cor do Radar e o selo da aba Processos usam; o cartão, o Radar e a aba Processos nunca discordam.
 */
export const processosEmRisco = (linhas: Array<Pick<LinhaParaKpi, 'processoId' | 'processoEmRisco'>>): Set<number> =>
  new Set(linhas.filter((l) => l.processoEmRisco && l.processoId != null).map((l) => l.processoId as number))

/** As LINHAS que um KPI filtra na aba Tarefas. `back` não filtra: devolve a lista inteira. */
export function linhasDoKpi<T extends LinhaParaKpi>(chave: ChaveKpi, linhas: T[]): T[] {
  if (chave === 'risco') { const ps = processosEmRisco(linhas); return linhas.filter((l) => l.processoId != null && ps.has(l.processoId)) }
  const p = PREDICADO_DO_KPI[chave]
  return p ? linhas.filter(p) : linhas
}

export interface ValoresDosKpis {
  vencidas: number
  vencemEm7Dias: number
  semDono: number
  aguardandoTerceiro: number
  cobrancasPendentes: number
  escaladas: number
  emRisco: number
}

/** O NÚMERO de cada cartão — a contagem da lista que o clique filtra (para `risco`: nº de PROCESSOS). */
export function kpisDasLinhas(linhas: LinhaParaKpi[]): ValoresDosKpis {
  const n = (k: ChaveKpi) => linhasDoKpi(k, linhas).length
  return {
    vencidas: n('venc'), vencemEm7Dias: n('v7'), semDono: n('semdono'), aguardandoTerceiro: n('aguard'),
    cobrancasPendentes: n('cob'), escaladas: n('esc'), emRisco: processosEmRisco(linhas).size,
  }
}

/** Chave do KPI → campo da foto diária (E10). */
export const CAMPO_DA_FOTO: Record<Exclude<ChaveKpi, 'back'>, keyof ValoresDosKpis> = {
  venc: 'vencidas', v7: 'vencemEm7Dias', semdono: 'semDono', aguard: 'aguardandoTerceiro',
  cob: 'cobrancasPendentes', esc: 'escaladas', risco: 'emRisco',
}

export interface Tendencia {
  /** "▲ +2 vs semana passada" · "▼ −5 vs semana passada" · "= 6 vs semana passada". */
  rotulo: string
  direcao: 'up' | 'down' | 'igual'
  delta: number
}

/** A tendência REAL: hoje × a foto de uma semana atrás. Sem foto de referência → `null` ("sem histórico"). */
export function tendenciaDe(atual: number, anterior: number | null | undefined): Tendencia | null {
  if (anterior == null) return null
  const delta = atual - anterior
  if (delta === 0) return { rotulo: `= ${atual} vs semana passada`, direcao: 'igual', delta }
  return { rotulo: `${delta > 0 ? '▲ +' : '▼ −'}${Math.abs(delta)} vs semana passada`, direcao: delta > 0 ? 'up' : 'down', delta }
}

/**
 * A FOTO DE REFERÊNCIA: a mais próxima de 7 dias atrás dentre as de 7 a 10 dias de idade. Mais nova que
 * 7 dias não é "semana passada"; mais velha que 10 já não é comparável — nos dois casos, `null`.
 */
export function fotoDeReferencia<T extends { data: string }>(serie: T[], hoje: Date): T | null {
  const alvo = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()) - 7 * 86_400_000
  const candidatas = serie
    .map((f) => ({ f, t: Date.parse(f.data) }))
    .filter((x) => !Number.isNaN(x.t) && x.t <= alvo && alvo - x.t <= 3 * 86_400_000)
    .sort((a, b) => b.t - a.t)
  return candidatas[0]?.f ?? null
}

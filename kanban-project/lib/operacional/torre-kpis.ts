// lib/operacional/torre-kpis.ts
// ============================================================================
// OS 8 KPIs DA TORRE — Bloco J3 (30/09/2026). PURO: sem Prisma, importável pela tela e pelo servidor.
//
// UMA DEFINIÇÃO, TRÊS USOS: o NÚMERO do cartão, a LISTA que o clique filtra e a FOTO DIÁRIA (E10, cron
// `torre-indicadores`) saem das MESMAS funções sobre as MESMAS linhas da Operação. É isso que garante
// "o número bate com a lista que ele filtra" e que a tendência compara coisas iguais.
// ============================================================================
import { ehCobravelVencido } from './torre-predicados'
import { diasEntreDiasOperacionais } from './tempo-operacional'

/**
 * As chaves de indicador da Torre.
 *  · NOVO TOPO (01/10/2026, faixas SITUAÇÃO e AGENDA): `abertas` · `equipe` · `cartorio` · `ninguem` · `venc` · `hoje` ·
 *    `amanha` · `prox7` · `sprazo` · `cob` — e `risco` (o selo "N em risco" dos Processos ativos).
 *  · LEGADAS (deixaram de ser cartão, mas continuam VÁLIDAS em `?kpi=` da URL, em visões salvas e na foto diária E10):
 *    `v7` · `semdono` · `aguard` · `esc` · `back`. Nada é apagado.
 */
export type ChaveKpi =
  | 'abertas' | 'equipe' | 'cartorio' | 'ninguem'
  | 'venc' | 'hoje' | 'amanha' | 'prox7' | 'sprazo' | 'cob' | 'risco'
  | 'v7' | 'semdono' | 'aguard' | 'esc' | 'back'

/** O que os KPIs precisam saber de uma linha (subconjunto de `LinhaDaTorre`). */
export interface LinhaParaKpi {
  processoId: number | null
  /** O prazo da tarefa (ISO) ou `null` = sem prazo. A AGENDA conta DIAS OPERACIONAIS a partir dele, com `agora` injetável. */
  dataPrazo: string | null
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

export type GrupoDoKpi = 'situacao' | 'agenda' | 'legado'

export interface DefinicaoDeKpi {
  chave: ChaveKpi
  rotulo: string
  cor: 'red' | 'amb' | 'blu' | 'grn'
  /** `false` = não filtra a aba Tarefas (`abertas` mostra tudo; `back` era agregado). */
  filtra: boolean
  /** Em que faixa do topo o cartão mora (`legado` = já não é cartão). */
  grupo: GrupoDoKpi
  /** A REGRA de cálculo, por extenso — o que o número conta. É também o `title` do cartão. */
  regra: string
}

/** Vence nos próximos 7 dias (hoje incluído) e ainda NÃO venceu — vencida já está em "Atrasadas". (LEGADO: o cartão novo é `prox7`.) */
export const vence7 = (l: Pick<LinhaParaKpi, 'atrasada' | 'diasParaPrazo'>): boolean =>
  !l.atrasada && l.diasParaPrazo != null && l.diasParaPrazo >= 0 && l.diasParaPrazo <= 7

// ─── A AGENDA — dias OPERACIONAIS (America/Sao_Paulo), `agora` injetável ─────────────────────────────────────────
/**
 * Quantos DIAS CIVIS faltam para o prazo, no fuso da operação (`FUSO_OPERACIONAL`): 0 = vence hoje, 1 = amanhã, −1 = venceu ontem.
 * `null` = sem prazo. É a MESMA conta de `estadoTemporal` (`diasEntreDiasOperacionais`) — só que sobre `agora` recebido, o que
 * deixa o teste fixar a data. O prazo NUNCA pausa por causa de terceiro: aguardar cartório/cliente não muda esta conta.
 */
export function diasAtePrazo(l: Pick<LinhaParaKpi, 'dataPrazo'>, agora: Date): number | null {
  if (!l.dataPrazo) return null
  const prazo = new Date(l.dataPrazo)
  return Number.isNaN(prazo.getTime()) ? null : diasEntreDiasOperacionais(prazo, agora)
}

// ─── A PARTIÇÃO DA SITUAÇÃO — Com a equipe + Aguardando terceiros + Sem responsável = Tarefas abertas ────────────────
export type SituacaoDaTarefa = 'ninguem' | 'cartorio' | 'equipe'
/**
 * PRECEDÊNCIA da partição (a primeira regra que casa vence):
 *   1. `ninguem`  — a tarefa NÃO tem responsável ("Sem responsável"; mesmo que esteja aguardando um terceiro: o acompanhamento dela
 *                   não é de ninguém da equipe, e é exatamente o que o administrador precisa ver);
 *   2. `cartorio` — "Aguardando terceiros": tem responsável e `estadoOperacao = AGUARDANDO` (a bola está com o terceiro);
 *   3. `equipe`   — o resto: tem responsável e a bola é nossa.
 * Cada tarefa cai em UM e só um dos três; por isso os três somam "Tarefas abertas".
 */
export const ORDEM_DA_PARTICAO: readonly SituacaoDaTarefa[] = ['ninguem', 'cartorio', 'equipe']
const CASA_NA_PARTICAO: Record<Exclude<SituacaoDaTarefa, 'equipe'>, (l: Pick<LinhaParaKpi, 'responsavelId' | 'estadoOperacao'>) => boolean> = {
  ninguem: (l) => l.responsavelId == null,
  cartorio: (l) => l.estadoOperacao === 'AGUARDANDO',
}
export function situacaoDaTarefa(l: Pick<LinhaParaKpi, 'responsavelId' | 'estadoOperacao'>): SituacaoDaTarefa {
  for (const s of ORDEM_DA_PARTICAO) if (s === 'equipe' || CASA_NA_PARTICAO[s](l)) return s
  return 'equipe'
}

type PredicadoDeLinha = (l: LinhaParaKpi, agora: Date) => boolean
const dias = (l: LinhaParaKpi, agora: Date) => diasAtePrazo(l, agora)

/** O PREDICADO de cada indicador — UM só: o número do cartão e a lista que o clique filtra saem daqui. (`risco` é por PROCESSO: ver `linhasDoKpi`.) */
export const PREDICADO_DO_KPI: Partial<Record<ChaveKpi, PredicadoDeLinha>> = {
  abertas: () => true,
  ninguem: (l) => situacaoDaTarefa(l) === 'ninguem',
  cartorio: (l) => situacaoDaTarefa(l) === 'cartorio',
  equipe: (l) => situacaoDaTarefa(l) === 'equipe',
  venc: (l, agora) => { const d = dias(l, agora); return d != null && d < 0 },
  hoje: (l, agora) => dias(l, agora) === 0,
  amanha: (l, agora) => dias(l, agora) === 1,
  prox7: (l, agora) => { const d = dias(l, agora); return d != null && d >= 2 && d <= 7 },
  sprazo: (l) => l.dataPrazo == null,
  cob: (l) => ehCobravelVencido(l),
  // ── legadas (foto E10, URLs antigas, visões salvas) — definições INALTERADAS ──
  v7: vence7,
  semdono: (l) => l.responsavelId == null,
  aguard: (l) => l.estadoOperacao === 'AGUARDANDO',
  esc: (l) => l.escalada,
}

/** Na ordem em que aparecem. As faixas do topo usam `grupo`; `legado` fica só para resolver URLs/visões antigas. */
export const KPIS: DefinicaoDeKpi[] = [
  { chave: 'abertas', rotulo: 'Tarefas abertas', cor: 'blu', filtra: false, grupo: 'situacao',
    regra: 'Toda tarefa que a aba Tarefas lista: aberta (não concluída, não cancelada) e que não seja de fase futura do processo.' },
  { chave: 'equipe', rotulo: 'Com a equipe', cor: 'blu', filtra: true, grupo: 'situacao',
    regra: 'Aberta, com responsável e com a bola nossa (não está aguardando terceiros). É o que sobra depois de "Sem responsável" e "Aguardando terceiros".' },
  { chave: 'cartorio', rotulo: 'Aguardando terceiros', cor: 'blu', filtra: true, grupo: 'situacao',
    regra: 'Aberta, COM responsável, e aguardando um terceiro — cartório, cliente, tradutor, juízo ou consulado (estadoOperacao = AGUARDANDO). Aguardando e sem responsável conta em "Sem responsável".' },
  { chave: 'ninguem', rotulo: 'Sem responsável', cor: 'red', filtra: true, grupo: 'situacao',
    regra: 'Aberta e sem responsável — tem precedência sobre "Aguardando terceiros": tarefa sem responsável que aguarda um terceiro também é "Sem responsável".' },
  { chave: 'venc', rotulo: 'Atrasadas', cor: 'red', filtra: true, grupo: 'agenda',
    regra: 'Prazo anterior a hoje (dia operacional, fuso America/Sao_Paulo). O prazo nunca pausa por causa de terceiro.' },
  { chave: 'hoje', rotulo: 'Vence hoje', cor: 'amb', filtra: true, grupo: 'agenda',
    regra: 'Prazo é hoje (dia operacional, fuso America/Sao_Paulo).' },
  { chave: 'amanha', rotulo: 'Amanhã', cor: 'amb', filtra: true, grupo: 'agenda',
    regra: 'Prazo é amanhã (dia operacional, fuso America/Sao_Paulo).' },
  { chave: 'prox7', rotulo: 'Próximos 7 dias', cor: 'blu', filtra: true, grupo: 'agenda',
    regra: 'Prazo entre depois de amanhã e daqui a 7 dias, inclusive — sem repetir o que já está em "Vence hoje" e "Amanhã" (dia operacional).' },
  { chave: 'sprazo', rotulo: 'Sem prazo', cor: 'blu', filtra: true, grupo: 'agenda',
    regra: 'Aberta e sem prazo definido (ex.: o prazo nasce no envio ao cartório).' },
  { chave: 'cob', rotulo: 'Cobranças a fazer', cor: 'amb', filtra: true, grupo: 'agenda',
    regra: 'Acompanhamento vencido de tarefa que espera o terceiro e que não é da Genealogia — o mesmo "Cobrar todos os vencidos (N)".' },
  { chave: 'risco', rotulo: 'Processos em risco', cor: 'red', filtra: true, grupo: 'situacao',
    regra: 'Processos de risco CRÍTICO: score 6 ou mais no "Precisa de você" (o mesmo do Radar e da aba Processos).' },
  // ── legadas ──
  { chave: 'v7', rotulo: 'Vencem em 7 dias', cor: 'amb', filtra: true, grupo: 'legado', regra: 'Legado: prazo de hoje a 7 dias, sem as atrasadas.' },
  { chave: 'semdono', rotulo: 'Sem responsável', cor: 'red', filtra: true, grupo: 'legado', regra: 'Legado: tarefa aberta sem responsável (igual ao cartão "Sem responsável").' },
  { chave: 'aguard', rotulo: 'Aguardando terceiros (todas)', cor: 'blu', filtra: true, grupo: 'legado', regra: 'Legado: aguardando um terceiro, com ou sem responsável.' },
  { chave: 'esc', rotulo: 'Escaladas pra mim', cor: 'red', filtra: true, grupo: 'legado', regra: 'Legado: duas ou mais cobranças sem resposta.' },
  { chave: 'back', rotulo: 'Backlog: abre / fecha por sem.', cor: 'amb', filtra: false, grupo: 'legado', regra: 'Legado: passou para a linha "Semana" da aba Processos.' },
]
export const KPI_POR_CHAVE: Record<ChaveKpi, DefinicaoDeKpi> = Object.fromEntries(KPIS.map((k) => [k.chave, k])) as Record<ChaveKpi, DefinicaoDeKpi>

/** Os cartões de cada faixa do topo, na ordem em que aparecem (Processos ativos e "N em risco" são de PROCESSO e vêm da aba Processos). */
export const CARTOES_DA_SITUACAO: ChaveKpi[] = ['abertas', 'equipe', 'cartorio', 'ninguem']
export const CARTOES_DA_AGENDA: ChaveKpi[] = ['venc', 'hoje', 'amanha', 'prox7', 'sprazo', 'cob']

/** Processo em risco CRÍTICO — a MESMA palavra do Radar, da aba Processos e do "Precisa de você" (score ≥ 6). */
export const emRiscoCritico = (p: { risco: string }): boolean => p.risco === 'critico'

/**
 * PROCESSOS EM RISCO = os de risco CRÍTICO no score do "Precisa de você" (Bloco F) — a mesma palavra "risco" que a
 * cor do Radar e o selo da aba Processos usam; o cartão, o Radar e a aba Processos nunca discordam.
 */
export const processosEmRisco = (linhas: Array<Pick<LinhaParaKpi, 'processoId' | 'processoEmRisco'>>): Set<number> =>
  new Set(linhas.filter((l) => l.processoEmRisco && l.processoId != null).map((l) => l.processoId as number))

/** As LINHAS que um KPI filtra na aba Tarefas. `back` não filtra: devolve a lista inteira. */
export function linhasDoKpi<T extends LinhaParaKpi>(chave: ChaveKpi, linhas: T[], agora: Date = new Date()): T[] {
  if (chave === 'risco') { const ps = processosEmRisco(linhas); return linhas.filter((l) => l.processoId != null && ps.has(l.processoId)) }
  const p = PREDICADO_DO_KPI[chave]
  return p ? linhas.filter((l) => p(l, agora)) : linhas
}

/** O NÚMERO do cartão: o tamanho da lista que o clique filtra (`risco`: nº de PROCESSOS distintos). UMA conta para a tela e para o teste. */
export function numeroDoKpi(chave: ChaveKpi, linhas: LinhaParaKpi[], agora: Date = new Date()): number {
  if (chave === 'risco') return processosEmRisco(linhas).size
  return linhasDoKpi(chave, linhas, agora).length
}

/** Os TOTAIS da Visão geral que a foto diária guarda desde a Torre nova (M4): tarefas abertas, com a equipe, aguardando terceiros (com responsável). */
export interface TotaisDaSituacao { tarefasAbertas: number; comEquipe: number; comCartorio: number }

/** Os totais da SITUAÇÃO sobre as linhas — o mesmo `numeroDoKpi` do cartão (abertas · equipe · cartorio): foto, cartão e lista nunca discordam. */
export function totaisDaSituacao(linhas: LinhaParaKpi[], agora: Date = new Date()): TotaisDaSituacao {
  return { tarefasAbertas: numeroDoKpi('abertas', linhas, agora), comEquipe: numeroDoKpi('equipe', linhas, agora), comCartorio: numeroDoKpi('cartorio', linhas, agora) }
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
export function kpisDasLinhas(linhas: LinhaParaKpi[], agora: Date = new Date()): ValoresDosKpis {
  const n = (k: ChaveKpi) => linhasDoKpi(k, linhas, agora).length
  return {
    vencidas: n('venc'), vencemEm7Dias: n('v7'), semDono: n('semdono'), aguardandoTerceiro: n('aguard'),
    cobrancasPendentes: n('cob'), escaladas: n('esc'), emRisco: processosEmRisco(linhas).size,
  }
}

/**
 * Chave do KPI → campo da foto diária (E10). Só entra aqui o cartão cuja DEFINIÇÃO é a mesma da foto: `ninguem` = `semDono`
 * (todo responsável nulo), `venc`, `cob` e `risco`. `cartorio` (só COM responsável), `equipe`, `abertas` e a AGENDA nova não
 * têm foto de 7 dias — a tendência deles NÃO é mostrada (comparar com uma foto de outra definição seria mentir).
 */
/** Os campos NUMÉRICOS da foto diária que têm tendência: os 7 dos KPIs + os totais da Visão geral (M4) + processos ativos. */
export type CampoDaFoto = keyof ValoresDosKpis | keyof TotaisDaSituacao | 'processosAtivos'

export const CAMPO_DA_FOTO: Partial<Record<ChaveKpi, CampoDaFoto>> = {
  venc: 'vencidas', ninguem: 'semDono', cob: 'cobrancasPendentes', risco: 'emRisco',
  v7: 'vencemEm7Dias', semdono: 'semDono', aguard: 'aguardandoTerceiro', esc: 'escaladas',
  // Torre nova (M4): estes três ganharam coluna própria na foto, com a MESMA definição do cartão (`totaisDaSituacao`).
  // Foto antiga (anterior à M4) tem NULL nelas → sem tendência (nunca estimativa).
  abertas: 'tarefasAbertas', equipe: 'comEquipe', cartorio: 'comCartorio',
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

/** A idade MÁXIMA (em dias) da foto que ainda vale como "semana passada": de 7 a 10 dias. */
export const IDADE_MAXIMA_DA_FOTO_DE_REFERENCIA_DIAS = 10
export const IDADE_MINIMA_DA_FOTO_DE_REFERENCIA_DIAS = 7

/** Os números de um dia, para comparar: a data (AAAA-MM-DD) e os campos numéricos (ausente/`null` = sem registro). */
export type FotoComparavel = { data: string } & Partial<Record<CampoDaFoto, number | null>>

/**
 * "▲/▼ vs SEMANA PASSADA" — PURA. Compara os números de HOJE com a foto de uma semana atrás, campo a campo, e SÓ devolve
 * tendência de um campo quando as duas pontas existem. Sem foto, foto com menos de 7 dias (não é "semana passada"), com mais de
 * 10 (já não é comparável) ou registro antigo sem a coluna (NULL, anterior à M4) → o campo NÃO aparece no resultado: a tela não
 * mostra nada, nunca uma estimativa. Direção/rótulo vêm de `tendenciaDe` (a mesma conta dos cartões).
 */
export function tendenciaVsSemana(
  hoje: FotoComparavel, fotoSemanaPassada: FotoComparavel | null | undefined,
): Partial<Record<CampoDaFoto, Tendencia>> {
  if (!fotoSemanaPassada) return {}
  const dia = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`)
  const idade = Math.round((dia(hoje.data) - dia(fotoSemanaPassada.data)) / 86_400_000)
  if (!Number.isFinite(idade) || idade < IDADE_MINIMA_DA_FOTO_DE_REFERENCIA_DIAS || idade > IDADE_MAXIMA_DA_FOTO_DE_REFERENCIA_DIAS) return {}
  const saida: Partial<Record<CampoDaFoto, Tendencia>> = {}
  for (const campo of Object.keys(hoje) as Array<keyof FotoComparavel>) {
    if (campo === 'data') continue
    const atual = hoje[campo]
    const anterior = fotoSemanaPassada[campo]
    if (typeof atual !== 'number' || typeof anterior !== 'number') continue
    const t = tendenciaDe(atual, anterior)
    if (t) saida[campo as CampoDaFoto] = t
  }
  return saida
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

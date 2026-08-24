// lib/operacional/tempo-operacional.ts
// ============================================================================
// O TEMPO DA OPERAÇÃO — uma régua só, para todas as telas.
//
// A mesma tarefa dizia coisas diferentes conforme a tela:
//
//   Minha Fila            comparava o DIA no fuso da operação
//   Central Operacional   comparava blocos de 24h a partir do instante atual
//
// Às 23h de 14/08, com prazo em 15/08 às 09h, uma dizia "vence amanhã" e a
// outra "vence hoje". Perto da meia-noite, uma dizia "atrasada" e a outra não.
// Nenhuma das duas estava errada isoladamente — o defeito era existirem duas.
//
// ─── OS CONCEITOS, QUE NÃO SÃO O MESMO ──────────────────────────────────────
//
//   PRAZO OPERACIONAL   até quando o trabalho INTERNO deve estar resolvido.
//                       É `Tarefa.dataPrazo`, derivado do SLA na materialização.
//
//   PREVISÃO EXTERNA    o que o terceiro prometeu ("o cartório informou 30
//                       dias"). NÃO é prazo: um cartório lento não reescreve o
//                       compromisso do escritório, e um cartório rápido não o
//                       antecipa. Vive no andamento da etapa e aparece ao lado,
//                       nunca no lugar.
//
//   ESPERA EXTERNA      o trabalho está legitimamente parado esperando alguém
//                       de fora. É estado do trabalho, não do relógio.
//
//   PAUSA DE SLA        se o relógio para durante a espera. É POLÍTICA do
//                       workflow publicado (`pausarSlaEmEsperaExterna`), nunca
//                       uma regra fixa por nome de passo.
//
//   ATRASO              condição DERIVADA: passou do prazo e o trabalho não
//                       terminou. Nunca um status — uma tarefa atrasada segue
//                       "Em andamento", e as duas coisas são verdadeiras juntas.
//
//   AGING               há quanto tempo a tarefa existe. Mede idade, não dívida.
//
// Nada aqui é persistido. Se o derivado e o banco divergirem, é o derivado que
// se corrige na próxima leitura — nunca o contrário.
// ============================================================================

import { isDiaUtil } from '@/src/lib/diasUteis'

/**
 * O PRAZO OPERACIONAL DE UMA TAREFA — uma conta só, em DIAS ÚTEIS.
 *
 * Havia DUAS funções chamadas `calcularPrazo`, com os argumentos em ordem
 * invertida e contando dias diferentes:
 *
 *   tarefa-canonica     calcularPrazo(slaDays, inicio)   dias CORRIDOS
 *   passo-tarefa-helpers calcularPrazo(base, sla)        dias ÚTEIS
 *
 * As duas vivas, em caminhos de criação concorrentes: a mesma certidão nascia
 * com prazos diferentes conforme quem a materializasse, e trocar um import
 * mudava o prazo sem mudar uma linha de regra. Pior: os nomes iguais faziam
 * `calcularPrazo(5, hoje)` compilar nos dois — só que num deles "5" é a base.
 *
 * A conta que VALE é a que já roda em produção no materializador de passos:
 * DIAS ÚTEIS, com os feriados nacionais. Um SLA de "3 dias" que vence no
 * domingo nunca foi um compromisso que alguém pudesse cumprir.
 *
 * Sem SLA declarado o prazo é NULO — a tarefa fica fora da régua de atraso, o
 * que é honesto, em vez de ganhar uma data inventada.
 */
/**
 * PRAZO HERDADO — o passo não declara prazo próprio.
 *
 * O modelo guarda `slaDays` como inteiro com default 0, e 0 sempre significou "não
 * tem prazo próprio". O que faltava era dizer isso em algum lugar: a tela mostrava um
 * campo numérico com "0" dentro, que se lê como "prazo zero", e quem configurasse
 * digitaria um número só para o campo não parecer vazio — gravando um override que
 * ninguém quis.
 *
 * HERANÇA NÃO É OVERRIDE. Quem herda continua herdando quando o prazo da fase mudar;
 * quem copiou o número da fase para dentro do passo, não.
 */
export const PRAZO_HERDADO = 0

/** O passo declara prazo próprio, ou herda? Uma pergunta, um lugar. */
export function temPrazoProprio(slaDays: number | null | undefined): boolean {
  return typeof slaDays === "number" && Number.isFinite(slaDays) && slaDays > 0
}

export function prazoOperacional(slaDays: number | null | undefined, inicio: Date): Date | null {
  if (slaDays == null || !Number.isFinite(slaDays) || slaDays <= 0) return null
  const d = new Date(inicio.getTime())
  let restantes = slaDays
  while (restantes > 0) {
    d.setDate(d.getDate() + 1)
    if (isDiaUtil(d)) restantes--
  }
  return d
}

/**
 * O DIA EM QUE A OPERAÇÃO VIVE.
 *
 * O prazo é gravado com hora (o SLA soma dias sobre o instante em que a tarefa
 * nasceu), mas ninguém opera em minutos: um SLA de "5 dias" vence NO DIA, não
 * às 14h24 do quinto dia. Comparar instantes fazia uma tarefa que vence hoje
 * aparecer atrasada desde a manhã — e tornava "vence hoje" impossível de
 * mostrar, porque o vermelho de atraso chegava primeiro.
 */
export const FUSO_OPERACIONAL = 'America/Sao_Paulo'

export function diaOperacional(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: FUSO_OPERACIONAL })
}

/**
 * A JANELA DO DIA OPERACIONAL, em instantes UTC.
 *
 * Meia-noite EM SÃO PAULO, não meia-noite UTC. A diferença parece pedante e não
 * é: entre 21h e meia-noite (00:00–03:00 UTC), a derivação em memória dizia
 * "atrasada" e o filtro no banco dizia que não, porque comparavam com cortes
 * diferentes. O mesmo prazo, duas respostas, e a fila deixando de mostrar o que
 * já estourou justamente no fim do expediente.
 *
 * O deslocamento é medido NO PRÓPRIO INSTANTE — assim o horário de verão, se
 * voltar, entra sozinho na conta, sem tabela nem constante.
 */
function deslocamentoDoFuso(d: Date): number {
  const comoUtc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }))
  const noFuso = new Date(d.toLocaleString('en-US', { timeZone: FUSO_OPERACIONAL }))
  return comoUtc.getTime() - noFuso.getTime()
}

export function janelaDoDiaOperacional(agora: Date): { inicio: Date; fim: Date } {
  const meiaNoiteNominal = new Date(`${diaOperacional(agora)}T00:00:00.000Z`)
  const inicio = new Date(meiaNoiteNominal.getTime() + deslocamentoDoFuso(agora))
  return { inicio, fim: new Date(inicio.getTime() + 86400000 - 1) }
}

/** Meia-noite do dia operacional de HOJE, em instante — para filtrar no banco. */
export function inicioDoDiaOperacional(agora: Date): Date {
  return janelaDoDiaOperacional(agora).inicio
}

/**
 * DIAS ENTRE DOIS DIAS OPERACIONAIS — inteiro, com sinal.
 *
 * Conta DIAS CIVIS, não períodos de 24 horas. "Vence amanhã" às 23h50 continua
 * sendo amanhã, e não vira "vence em 0 dias" porque faltam dez minutos para a
 * meia-noite. É esta a diferença que fazia duas telas discordarem.
 */
export function diasEntreDiasOperacionais(alvo: Date, base: Date): number {
  const dia = (d: Date) => Date.parse(`${diaOperacional(d)}T00:00:00.000Z`)
  return Math.round((dia(alvo) - dia(base)) / 86400000)
}

/** Estados em que a tarefa já não tem prazo a vencer. */
const ENCERRADOS = new Set(['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI', 'CANCELADA', 'SUPERSEDIDA'])

/** O que a operação precisa saber sobre o tempo de UMA unidade de trabalho. */
export interface EntradaTemporal {
  /** O prazo operacional — de `Tarefa.dataPrazo`, nunca de previsão externa. */
  dataPrazo: Date | string | null
  /** Quando o trabalho terminou, se terminou. */
  dataConclusao?: Date | string | null
  /** Status persistido da tarefa — só para saber se ainda há prazo correndo. */
  statusTarefa?: string | null
  /** O trabalho está parado esperando alguém de fora? */
  aguardandoTerceiro?: boolean
  /** O que o terceiro prometeu. Informação, não compromisso. */
  previsaoExterna?: Date | string | null
  /** Desde quando o SLA está pausado (política do workflow publicado). */
  slaPausadoEm?: Date | string | null
  /** Minutos já descontados por pausas anteriores. */
  slaPausaAcumuladaMin?: number | null
  /** Quando a unidade nasceu — para o aging. */
  criadaEm?: Date | string | null
  agora?: Date
}

export interface EstadoTemporal {
  /** O prazo operacional, em ISO. `null` = sem prazo, e isso é dito, não escondido. */
  dueAt: string | null
  /** Dias civis até o prazo; negativo é atraso. `null` sem prazo. */
  diasParaPrazo: number | null
  atrasado: boolean
  /** Quantos dias de atraso — só faz sentido quando `atrasado`. */
  atrasadoHaDias: number | null
  venceHoje: boolean
  venceAmanha: boolean
  semPrazo: boolean
  /** Terminou, e terminou depois do prazo. O atraso PARA de crescer aqui. */
  concluidoComAtraso: boolean
  /** Quantos dias de atraso na conclusão — histórico, não dívida corrente. */
  concluidoComAtrasoDeDias: number | null
  concluidoEm: string | null
  aguardandoTerceiro: boolean
  previsaoExterna: string | null
  slaPausado: boolean
  /** Idade da unidade em dias — mede tempo de vida, não dívida. */
  agingDias: number | null
  /** A frase única que TODAS as telas mostram. */
  rotulo: string
  /** Semântica visual, do Design System — sem cada tela inventar a sua. */
  tom: 'critico' | 'alerta' | 'neutro' | 'ok'
}

const paraData = (v: Date | string | null | undefined): Date | null => {
  if (v == null) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * O ESTADO TEMPORAL DE UMA UNIDADE DE TRABALHO — a função que todas consomem.
 *
 * Pura: recebe o que já foi lido, devolve o que a tela mostra. Não consulta,
 * não escreve, não decide permissão. É por ser pura que ela pode ser a mesma na
 * Minha Fila, na Central, no Kanban e na notificação — e é por serem a mesma
 * que os quatro finalmente concordam.
 *
 * CONCLUÍDA CONGELA. Depois de `dataConclusao`, o atraso não cresce mais: o que
 * aconteceu tem um tamanho, e ele não aumenta porque o calendário andou.
 */
export function estadoTemporal(e: EntradaTemporal): EstadoTemporal {
  const agora = e.agora ?? new Date()
  const prazo = paraData(e.dataPrazo)
  const concluida = paraData(e.dataConclusao)
  // QUEM DIZ QUE ACABOU É O STATUS, não a data de conclusão.
  //
  // `dataConclusao` é HISTÓRIA e sobrevive à reabertura de propósito: apagar a
  // data em que o trabalho foi dado por pronto na primeira vez seria reescrever
  // o passado. Tratá-la como "acabou" fazia a tarefa REABERTA nunca mais
  // aparecer em aviso nenhum — encerrada para o relógio, aberta para as pessoas.
  //
  // Sem status informado (chamadas que só têm a data), a data volta a valer.
  const encerrada = e.statusTarefa != null
    ? ENCERRADOS.has(e.statusTarefa)
    : concluida != null
  const previsao = paraData(e.previsaoExterna)
  const criada = paraData(e.criadaEm)

  const agingDias = criada ? Math.max(0, diasEntreDiasOperacionais(agora, criada)) : null
  const slaPausado = paraData(e.slaPausadoEm) != null

  // ── ENCERRADA: o relógio parou ────────────────────────────────────────────
  if (encerrada) {
    const atrasoFinal = prazo && concluida ? -diasEntreDiasOperacionais(prazo, concluida) : 0
    const comAtraso = atrasoFinal > 0
    return {
      dueAt: prazo?.toISOString() ?? null,
      diasParaPrazo: null,
      atrasado: false,
      atrasadoHaDias: null,
      venceHoje: false,
      venceAmanha: false,
      semPrazo: prazo == null,
      concluidoComAtraso: comAtraso,
      concluidoComAtrasoDeDias: comAtraso ? atrasoFinal : null,
      concluidoEm: concluida?.toISOString() ?? null,
      aguardandoTerceiro: false,
      previsaoExterna: previsao?.toISOString() ?? null,
      slaPausado: false,
      agingDias,
      rotulo: comAtraso
        ? `Concluída com ${atrasoFinal} dia${atrasoFinal === 1 ? '' : 's'} de atraso`
        : 'Concluída',
      tom: 'ok',
    }
  }

  // ── SEM PRAZO: é uma informação, não uma omissão ──────────────────────────
  if (prazo == null) {
    return {
      dueAt: null, diasParaPrazo: null, atrasado: false, atrasadoHaDias: null,
      venceHoje: false, venceAmanha: false, semPrazo: true,
      concluidoComAtraso: false, concluidoComAtrasoDeDias: null, concluidoEm: null,
      aguardandoTerceiro: e.aguardandoTerceiro === true,
      previsaoExterna: previsao?.toISOString() ?? null,
      slaPausado, agingDias,
      rotulo: 'Sem prazo', tom: 'neutro',
    }
  }

  const dias = diasEntreDiasOperacionais(prazo, agora)
  const atrasado = dias < 0
  const venceHoje = dias === 0
  const venceAmanha = dias === 1

  const rotulo =
    atrasado ? `Atrasada há ${Math.abs(dias)} dia${Math.abs(dias) === 1 ? '' : 's'}`
    : venceHoje ? 'Vence hoje'
    : venceAmanha ? 'Vence amanhã'
    : `Vence em ${dias} dias`

  return {
    dueAt: prazo.toISOString(),
    diasParaPrazo: dias,
    atrasado,
    atrasadoHaDias: atrasado ? Math.abs(dias) : null,
    venceHoje,
    venceAmanha,
    semPrazo: false,
    concluidoComAtraso: false,
    concluidoComAtrasoDeDias: null,
    concluidoEm: null,
    aguardandoTerceiro: e.aguardandoTerceiro === true,
    previsaoExterna: previsao?.toISOString() ?? null,
    slaPausado,
    agingDias,
    rotulo,
    tom: atrasado ? 'critico' : venceHoje || venceAmanha ? 'alerta' : 'neutro',
  }
}

/**
 * A PREVISÃO DO TERCEIRO, dita como informação.
 *
 * Fica ao lado do prazo, jamais no lugar dele. A frase é diferente de propósito
 * — "retorno previsto" não é "vence": quem lê precisa saber de quem é a
 * promessa.
 */
export function rotuloDaPrevisaoExterna(previsao: Date | string | null | undefined): string | null {
  const d = paraData(previsao)
  if (!d) return null
  return `Retorno previsto ${d.toLocaleDateString('pt-BR', { timeZone: FUSO_OPERACIONAL })}`
}

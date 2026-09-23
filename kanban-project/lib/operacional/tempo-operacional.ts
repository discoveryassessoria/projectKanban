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

/**
 * O PRAZO OPERACIONAL DE UMA TAREFA — uma conta só, em DIAS CORRIDOS.
 *
 * DECISÃO DEFINITIVA (23/09/2026, "regra crucial"): o prazo declarado num
 * modelo/passo ("N dias") conta dias CORRIDOS — nunca pula fim de semana ou
 * feriado. Antes desta correção, a conta pulava fim de semana/feriado
 * (`isDiaUtil`) mesmo com o rótulo da tela dizendo "dias úteis" — essa
 * interpretação era exatamente o que o usuário pediu para corrigir de ponta
 * a ponta, inclusive nos modelos já publicados e nas Tarefas já
 * materializadas (ver `scripts/reconciliar-prazo-dias-corridos.ts`, rodado
 * uma vez contra produção nesta mesma mudança).
 *
 * Havia DUAS funções chamadas `calcularPrazo`, com os argumentos em ordem
 * invertida e contando dias diferentes (`tarefa-canonica` já usava corridos;
 * `passo-tarefa-helpers` usava dias úteis, a conta que valia em produção). As
 * duas convergiram para ESTA função, que agora é dias corridos nos dois
 * lugares — não sobrou um segundo motor com o comportamento antigo.
 *
 * `src/lib/diasUteis.ts` (`isDiaUtil`/`gerarVencimentosParcelas`) continua
 * existindo e é usado pelo Financeiro (vencimento de parcela/boleto, uma
 * régua deliberadamente diferente, de convenção bancária) — só não é mais
 * chamado por este arquivo.
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
  d.setDate(d.getDate() + slaDays)
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
 * A JANELA DO DIA OPERACIONAL DE UMA DATA ESPECÍFICA (`"AAAA-MM-DD"`) — a
 * MESMA conta de `janelaDoDiaOperacional`, para quando o dia vem de um FILTRO
 * escolhido na tela (período de "Tarefas e Projetos"), não do relógio.
 *
 * Nasceu de um bug real: um filtro de período fazia `new Date("2026-09-11")`
 * nos dois extremos (`dataInicio`/`dataFim` do mesmo dia), o que em JS vira
 * meia-noite UTC — um INSTANTE ÚNICO, não um dia inteiro. Um `gte`/`lte`
 * apontando para o mesmo instante nunca casa com nada que aconteceu durante o
 * dia (quase tudo, no fuso de São Paulo). O card "Concluídas hoje" mostrava
 * um número, e aplicar o filtro equivalente devolvia zero — a mesma classe de
 * divergência de fuso que este arquivo existe para eliminar, só que reintroduzida
 * num código novo que não passou por aqui.
 */
export function janelaDoDiaOperacionalDe(dataYMD: string): { inicio: Date; fim: Date } {
  const meiaNoiteNominal = new Date(`${dataYMD}T00:00:00.000Z`)
  const inicio = new Date(meiaNoiteNominal.getTime() + deslocamentoDoFuso(meiaNoiteNominal))
  return { inicio, fim: new Date(inicio.getTime() + 86400000 - 1) }
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
 * O NÚCLEO — a mesma conta, qualquer que seja a unidade de trabalho.
 *
 * `estadoTemporal` (Tarefa) e `estadoTemporalSubtarefa` (Subtarefa) só diferem
 * em COMO decidem "encerrada" e "aguardando terceiro" — cada uma lê o
 * vocabulário de status da sua própria tabela (`StatusTarefa` vs
 * `SubtaskExecution.status`, que não têm os mesmos valores). A partir daí a
 * matemática é uma só, e mora aqui — nunca duplicada entre as duas.
 */
function nucleoTemporal(n: {
  dataPrazo: Date | string | null
  dataConclusao?: Date | string | null
  encerrada: boolean
  aguardandoTerceiro: boolean
  previsaoExterna?: Date | string | null
  slaPausadoEm?: Date | string | null
  criadaEm?: Date | string | null
  agora?: Date
}): EstadoTemporal {
  const agora = n.agora ?? new Date()
  const prazo = paraData(n.dataPrazo)
  const concluida = paraData(n.dataConclusao)
  const encerrada = n.encerrada
  const previsao = paraData(n.previsaoExterna)
  const criada = paraData(n.criadaEm)

  const agingDias = criada ? Math.max(0, diasEntreDiasOperacionais(agora, criada)) : null
  const slaPausado = paraData(n.slaPausadoEm) != null

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
      aguardandoTerceiro: n.aguardandoTerceiro,
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
    aguardandoTerceiro: n.aguardandoTerceiro,
    previsaoExterna: previsao?.toISOString() ?? null,
    slaPausado,
    agingDias,
    rotulo,
    tom: atrasado ? 'critico' : venceHoje || venceAmanha ? 'alerta' : 'neutro',
  }
}

/**
 * O ESTADO TEMPORAL DE UMA TAREFA — o prazo MACRO, fixado na materialização.
 *
 * Pura: recebe o que já foi lido, devolve o que a tela mostra. Não consulta,
 * não escreve, não decide permissão. É por ser pura que ela pode ser a mesma na
 * Minha Fila, na Central, no Kanban e na notificação — e é por serem a mesma
 * que os quatro finalmente concordam.
 *
 * CONCLUÍDA CONGELA. Depois de `dataConclusao`, o atraso não cresce mais: o que
 * aconteceu tem um tamanho, e ele não aumenta porque o calendário andou.
 *
 * Este prazo NÃO se move quando a subtarefa corrente avança — ver
 * `estadoTemporalSubtarefa` para o relógio operacional, mais fino.
 */
export function estadoTemporal(e: EntradaTemporal): EstadoTemporal {
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
  return nucleoTemporal({
    dataPrazo: e.dataPrazo,
    dataConclusao: e.dataConclusao,
    encerrada,
    aguardandoTerceiro: e.aguardandoTerceiro === true,
    previsaoExterna: e.previsaoExterna,
    slaPausadoEm: e.slaPausadoEm,
    criadaEm: e.criadaEm,
    agora: e.agora,
  })
}

/** Estados de `SubtaskExecution` em que o relógio da subtarefa já não corre. */
const SUBTAREFA_ENCERRADA = new Set(['CONCLUIDO', 'CANCELADO', 'INVALIDADO', 'FALHOU'])

/**
 * O QUE A OPERAÇÃO PRECISA SABER SOBRE O TEMPO DE UMA SUBTAREFA.
 *
 * `dataPrazo` vem de `SubtaskExecution.prazo` — ancorado no instante em que
 * ELA (não o passo, não a Tarefa) ficou `DISPONIVEL`, com o SLA efetivo dela
 * (próprio, ou herdado do passo quando vazio). `null` enquanto ela ainda está
 * `BLOQUEADO`/`PENDENTE`: subtarefa futura não tem relógio correndo.
 */
export interface EntradaTemporalSubtarefa {
  dataPrazo: Date | string | null
  dataConclusao?: Date | string | null
  /** status vigente da SubtaskExecution — vocabulário próprio, não o de Tarefa. */
  status?: string | null
  criadaEm?: Date | string | null
  agora?: Date
}

/**
 * O ESTADO TEMPORAL DE UMA SUBTAREFA — o prazo OPERACIONAL, da ação corrente.
 *
 * Mesma matemática de `estadoTemporal` (um só núcleo, `nucleoTemporal`), só
 * que lida com o vocabulário de status de `SubtaskExecution`
 * (PENDENTE/DISPONIVEL/EM_ANDAMENTO/AGUARDANDO_EXTERNO/BLOQUEADO/CONCLUIDO/
 * CANCELADO/INVALIDADO/FALHOU) em vez do de `Tarefa` — os dois vocabulários
 * não têm os mesmos valores, por isso não dá para chamar `estadoTemporal`
 * direto com o status de uma subtarefa.
 *
 * NUNCA substitui `estadoTemporal` da Tarefa: os dois convivem, cada um
 * respondendo sua própria pergunta (ver cabeçalho do arquivo).
 */
export function estadoTemporalSubtarefa(e: EntradaTemporalSubtarefa): EstadoTemporal {
  const encerrada = e.status != null
    ? SUBTAREFA_ENCERRADA.has(e.status)
    : paraData(e.dataConclusao) != null
  return nucleoTemporal({
    dataPrazo: e.dataPrazo,
    dataConclusao: e.dataConclusao,
    encerrada,
    aguardandoTerceiro: e.status === 'AGUARDANDO_EXTERNO',
    previsaoExterna: null,
    slaPausadoEm: null,
    criadaEm: e.criadaEm,
    agora: e.agora,
  })
}

// ============================================================================
// EM RISCO — PROPOSTA DOCUMENTADA, AINDA NÃO LIGADA (17/09/2026)
// ----------------------------------------------------------------------------
// Decisão explícita do usuário: implementar os dois relógios (Tarefa +
// Subtarefa) primeiro, calibrar depois. Esta seção documenta a regra
// tecnicamente correta já desenhada e aprovada em conversa, para não se
// perder — mas NENHUMA tela ou API deve chamar isto ainda. Quando for a hora
// de ligar, o algoritmo é:
//
//   1. Pegar todas as subtarefas do passo ainda NÃO concluídas.
//   2. Para a subtarefa ATIVA agora: custo restante =
//        max(0, slaDaysEfetivo − dias corridos já decorridos desde que ficou
//        disponível)
//      Para as ainda BLOQUEADAS/PENDENTES: custo restante = slaDaysEfetivo
//      cheio (elas ainda não começaram a consumir nada).
//   3. Montar o grafo de dependência restante (`dependeDe`, o mesmo DAG que
//      `subtarefasDaEtapa` já usa) e achar o CAMINHO MAIS LONGO (caminho
//      crítico) somando o custo restante de cada nó no caminho — nunca a
//      soma de TODAS as subtarefas, que superestima quando há ramos
//      paralelos independentes.
//   4. dataConclusaoProjetada = hoje (dia operacional) + caminho mais longo,
//      em dias corridos (mesma `prazoOperacional` desta régua).
//   5. Se `agora > Tarefa.dataPrazo` → já é ATRASADO — EM RISCO não se
//      aplica mais (atraso tem precedência).
//   6. Senão, se `dataConclusaoProjetada > Tarefa.dataPrazo` → EM RISCO.
//   7. Senão → dentro do previsto.
//
// POR QUE NÃO LIGAR AINDA: assumir que toda subtarefa futura vai consumir
// 100% do seu SLA (passo 2, ramo "bloqueada") gera falso alerta sistemático
// em qualquer processo saudável que está adiantado — a maioria. Calibrar
// significa decidir, com dado real de produção, se o custo restante de uma
// subtarefa futura deve ser o SLA cheio, uma média histórica, ou outra
// régua — e isso exige volume de execuções concluídas que ainda não existe.
// ============================================================================

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

// lib/operacional/proximo-acontecimento.ts
// ============================================================================
// O PRÓXIMO ACONTECIMENTO ESPERADO — a leitura temporal canônica da operação.
//
// A REGRA-MÃE (Etapa 3, consolidação de 12/09/2026): toda operação aberta deve
// permitir determinar em qual passo está, quem age a seguir, o que precisa
// acontecer, se aguarda terceiro, e qual data OU evento a traz de volta à
// atenção. Quando nada disso é determinável, a operação é EM_RISCO — e isso é
// uma CONSEQUÊNCIA computada aqui, nunca um status novo persistido (nenhuma
// migration, nenhum enum novo).
//
// ─── QUATRO DIMENSÕES, NUNCA COMBINADAS ─────────────────────────────────────
//   A. PRAZO DA OPERAÇÃO      — `Tarefa.dataPrazo` (o motor canônico).
//   B. SLA DO PASSO ATUAL     — `PhaseWorkflowStepInstance.prazo` (o motor
//                                de `documento-operacao.ts` — PRESERVADO,
//                                nunca migrado, nunca sobreposto por A).
//   C. PREVISÃO DO TERCEIRO   — `SolicitacaoDocumento.previsaoRetorno`
//                                quando existe uma solicitação vinculada
//                                (a fonte estruturada); senão
//                                `previsaoEfetiva()` do andamento do passo
//                                (`metadata.operacao`, a fonte informal).
//   D. PRÓXIMO ACOMPANHAMENTO — `metadata.operacao.proximoAcompanhamento`.
//
// Este módulo NUNCA escreve em nenhuma delas — é leitura pura, como
// `estadoTemporal`/`sla-core.ts`. Quando A e B deveriam representar a MESMA
// obrigação e divergem de verdade, isso vira `motivosRisco`, nunca uma
// escolha silenciosa de qual vale.
//
// ─── SEM SEGUNDO MOTOR ───────────────────────────────────────────────────────
// Esta é a ÚNICA função que decide "o que vem a seguir" para uma operação.
// Kanban, Lista, Tarefas e Projetos e Workflow Interno devem, quando migrados
// (Etapa 5), consumir ESTA leitura — não recalcular por conta própria.
//
// ─── I/O SEPARADO DO NÚCLEO ──────────────────────────────────────────────────
// `computarProximoAcontecimento` é pura (sem prisma) — mesmo desenho de
// `sla-core.ts`/`sla-projection.ts`: o núcleo recebe um snapshot já carregado,
// as duas entradas de I/O (`estadoTemporalDaOperacao` para 1 tarefa,
// `estadosTemporaisDasOperacoes` para N) carregam o snapshot e delegam o
// cálculo. O single delega ao batch — mesma lógica, sem segunda forma de
// divergir.
// ============================================================================

import type { Prisma, PrismaClient } from "@prisma/client"
import { estadoTemporal, diasEntreDiasOperacionais, diaOperacional } from "./tempo-operacional"
import { lerAndamento, previsaoEfetiva, type AndamentoEtapa } from "@/src/lib/process-stage/andamento-etapa"

type Leitor = PrismaClient | Prisma.TransactionClient

/** Espera de terceiro OU cliente — a mesma régua que `tarefa-projecoes.ts` já usa. */
const STATUS_AGUARDANDO = new Set(["AGUARDANDO_TERCEIRO", "AGUARDANDO_CLIENTE"])

/**
 * ESPERA EXTERNA TAMBÉM CHEGA COMO "BLOQUEADA" — mandato Bloco 1.
 *
 * `PAUSE_FOR_EXTERNAL_WAIT` (CATALOGO_DE_EFEITOS, a porta real usada por
 * "Solicitar Certidão") passa pela máquina canônica de passo
 * (`task-step-sync.ts::bloquearTarefa`), que só tem UM status de "parada":
 * `BLOQUEADA`. A distinção espera-externa×impedimento-interno sobrevive em
 * `motivoCodigo` ("AGUARDANDO_TERCEIRO" vs "BLOQUEIO"/outro), não no status.
 *
 * Sem isto, uma Tarefa parada pelo cartório por essa porta caía no ramo
 * "ação interna" deste núcleo (por não estar em `STATUS_AGUARDANDO`) — e as
 * dimensões C/D (previsão do terceiro, próximo acompanhamento) e a regra
 * "atraso de terceiro não é atraso interno" (`atrasoInterno`) nunca eram
 * aplicadas: a pausa escondia exatamente o que o mandato proíbe esconder.
 */
/**
 * A SEMÂNTICA CANÔNICA DE "ESPERA EXTERNA" — usada por qualquer projeção que
 * precise saber se uma Tarefa está esperando terceiro, não só pelo núcleo
 * temporal. `BLOQUEADA` sozinho é bloqueio genérico (pode ser interno); só
 * `motivoCodigo === "AGUARDANDO_TERCEIRO"` diz que é o cartório/terceiro que
 * se espera. Os valores literais do enum (`AGUARDANDO_TERCEIRO`/
 * `AGUARDANDO_CLIENTE`) são o caminho legado — nada escreve mais neles, mas
 * continuam reconhecidos.
 */
export function ehEsperaExterna(statusTarefa: string, motivoCodigo: string | null | undefined): boolean {
  return STATUS_AGUARDANDO.has(statusTarefa) || (statusTarefa === "BLOQUEADA" && motivoCodigo === "AGUARDANDO_TERCEIRO")
}
const STATUS_ENCERRADOS = new Set(["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA", "SUPERSEDIDA"])
/** Solicitação de documento que já não representa espera ativa. */
const SOLICITACAO_ENCERRADA = new Set(["RESPONDIDA", "CANCELADA"])

export type TipoProximoAcontecimento =
  | "acao_interna"
  | "aguardando_terceiro_acompanhamento"
  | "aguardando_terceiro_previsao"
  | "acompanhamento"
  | "retorno_recebido"
  | "encerrada"
  | "em_risco"

export interface ProximoAcontecimento {
  tipo: TipoProximoAcontecimento
  /** ISO. `null` quando não há data (EM_RISCO, ou encerrada). */
  data: string | null
  descricao: string
  responsavelId: number | null
  aguardandoTerceiro: boolean
  /** Nome do órgão/pessoa aguardado, só quando identificável — nunca inventado. */
  terceiroAguardado: string | null
  /** De onde este acontecimento veio — para auditoria e depuração, nunca para a tela decidir de novo. */
  origem: string
}

export interface EstadoTemporalDaOperacao {
  tarefaId: number

  /** DIMENSÃO A — nunca combinada com B. */
  prazoOperacao: string | null
  /** DIMENSÃO B — preservada, nunca migrada para A. */
  slaPassoAtual: string | null
  /** DIMENSÃO C. */
  previsaoTerceiro: string | null
  /** DIMENSÃO D. */
  proximoAcompanhamentoData: string | null

  proximoAcontecimento: ProximoAcontecimento

  /** Atraso do PRAZO INTERNO — nunca true durante espera de terceiro/cliente (Regra da Etapa 3, item 3). */
  atrasoInterno: boolean
  /** Atraso da PREVISÃO DO TERCEIRO — nunca vira atraso interno. */
  atrasoTerceiro: boolean
  acompanhamentoVencido: boolean

  emRisco: boolean
  motivosRisco: string[]

  /** Retorno confiável de terceiro — Etapa 4, item 7. */
  retornoRecebido: boolean
  /**
   * Identidade estável do FATO que produziu `retornoRecebido` — `solicitacao:<id>`
   * ou `contato:<chave>`. É o que a notificação usa como base de idempotência:
   * o mesmo fato nunca gera uma segunda notificação; um retorno NOVO (nova
   * solicitação, novo contato) tem uma chave diferente, legitimamente.
   * `null` quando `retornoRecebido` é `false`.
   */
  retornoFatoChave: string | null

  /** De onde vieram os dados usados — auditoria, nunca decisão da tela. */
  origemDosDados: string[]
}

/** O snapshot que o núcleo puro precisa — carregado pela camada de I/O abaixo. */
export interface EntradaOperacao {
  tarefaId: number
  statusTarefa: string
  /** Distingue espera externa de bloqueio interno quando `statusTarefa==="BLOQUEADA"` — ver `ehEsperaExterna`. */
  motivoCodigo?: string | null
  dataPrazo: Date | null
  dataConclusao: Date | null
  dataInicio: Date | null
  slaPausadoEm: Date | null
  slaPausaAcumuladaMin: number | null
  responsavelId: number | null
  createdAt: Date
  agora: Date
  /** O passo corrente da Tarefa, quando existe. */
  passo: {
    prazo: Date | null
    startedAt: Date | null
    andamento: AndamentoEtapa
    ultimoContatoResultado: string | null
    /** `ContatoEtapa.chave` do último contato — identidade estável do FATO, para idempotência (Etapa 4). */
    ultimoContatoChave?: string | null
    /**
     * O RÓTULO PUBLICADO DO PASSO (ex.: "Enviar requerimento ao cartório") —
     * mesma cadeia de resolução de `rotuloDoPasso` (snapshot → definição
     * publicada → chave). Usado para compor a "próxima ação" com a AÇÃO real
     * configurada no cadastro, em vez de só a data ("Responsável deve agir
     * até..."). `null` = sem rótulo resolvível, cai no texto genérico.
     */
    etapaLabel?: string | null
  } | null
  /** A solicitação de documento vinculada a esta Tarefa, quando existe (`SolicitacaoDocumento.tarefaId`). */
  solicitacao: {
    id: number
    status: string
    previsaoRetorno: Date | null
    prazoEsperadoDias: number | null
    dataEnvio: Date
    terceiroNome: string | null
  } | null
}

const dataBR = (d: Date): string => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
// MEIO-DIA UTC, não meia-noite — achado real (19/09/2026, ao corrigir a
// semântica de "Acompanhar hoje" para dia-calendário): meia-noite UTC de um
// dia D é 21h de São Paulo do dia ANTERIOR (D-1) — `diaOperacional` (que
// sempre lê no fuso operacional) devolvia D-1 para uma data que este helper
// dizia representar D, um desvio de um dia inteiro. Instant-comparisons
// antigas (`.getTime() <`) nunca expunham o defeito porque não recalculavam
// o dia; comparações POR DIA (`diasEntreDiasOperacionais`, que reconverte via
// `diaOperacional`) expõem imediatamente. Meio-dia UTC = 09h em São Paulo
// (UTC-3, sem horário de verão) — sempre dentro do MESMO dia operacional,
// qualquer que seja o campo (`proximoAcompanhamento`/`previsaoEfetiva`) que
// alimentar este helper.
const isoDoDia = (ymd: string): Date => new Date(`${ymd}T12:00:00.000Z`)

/**
 * O NÚCLEO — PURO, sem I/O. Recebe o que já foi lido, devolve a leitura
 * temporal completa. Testável sem banco, como `estadoTemporal`/`sla-core.ts`.
 */
export function computarProximoAcontecimento(e: EntradaOperacao): EstadoTemporalDaOperacao {
  const motivosRisco: string[] = []
  const origemDosDados: string[] = []
  const encerrada = STATUS_ENCERRADOS.has(e.statusTarefa)
  const aguardando = ehEsperaExterna(e.statusTarefa, e.motivoCodigo)

  // ── DIMENSÃO A ────────────────────────────────────────────────────────────
  const prazoOperacao = e.dataPrazo
  if (prazoOperacao) origemDosDados.push("Tarefa.dataPrazo")

  // ── DIMENSÃO B — PRESERVADA, nunca sobreposta pela A ─────────────────────
  const slaPassoAtual = e.passo?.prazo ?? null
  if (slaPassoAtual) origemDosDados.push("PhaseWorkflowStepInstance.prazo")

  // CONFLITO REAL: as duas dimensões existem e divergem por mais de um dia
  // operacional — não escolhemos uma; reportamos as duas e marcamos risco.
  if (!encerrada && prazoOperacao && slaPassoAtual) {
    const divergencia = Math.abs(diasEntreDiasOperacionais(prazoOperacao, slaPassoAtual))
    if (divergencia > 0) {
      motivosRisco.push(
        `CONFLITO_PRAZO_TAREFA_PASSO: Tarefa.dataPrazo=${diaOperacional(prazoOperacao)} × ` +
          `PhaseWorkflowStepInstance.prazo=${diaOperacional(slaPassoAtual)} (${divergencia}d de diferença)`,
      )
    }
  }

  // ── DIMENSÃO C ────────────────────────────────────────────────────────────
  let previsaoTerceiro: Date | null = null
  let terceiroAguardado: string | null = null
  const solicitacaoAtiva = e.solicitacao && !SOLICITACAO_ENCERRADA.has(e.solicitacao.status) ? e.solicitacao : null
  if (solicitacaoAtiva) {
    previsaoTerceiro = solicitacaoAtiva.previsaoRetorno
    terceiroAguardado = solicitacaoAtiva.terceiroNome
    if (previsaoTerceiro) origemDosDados.push("SolicitacaoDocumento.previsaoRetorno")
  }
  if (!previsaoTerceiro && e.passo?.andamento) {
    const efetiva = previsaoEfetiva(e.passo.andamento, e.passo.startedAt)
    if (efetiva) {
      previsaoTerceiro = isoDoDia(efetiva)
      origemDosDados.push("metadata.operacao.previsaoEfetiva")
    }
    terceiroAguardado = terceiroAguardado ?? e.passo.andamento.destinatario
  }

  // ── DIMENSÃO D ────────────────────────────────────────────────────────────
  let proximoAcompanhamentoData: Date | null = null
  if (e.passo?.andamento.proximoAcompanhamento) {
    proximoAcompanhamentoData = isoDoDia(e.passo.andamento.proximoAcompanhamento)
    origemDosDados.push("metadata.operacao.proximoAcompanhamento")
  }

  // ── RETORNO RECEBIDO — sinal confiável, de QUALQUER uma das duas fontes ──
  let retornoRecebido = false
  let retornoFatoChave: string | null = null
  if (e.solicitacao?.status === "RESPONDIDA") {
    retornoRecebido = true
    retornoFatoChave = `solicitacao:${e.solicitacao.id}`
    origemDosDados.push("SolicitacaoDocumento.status=RESPONDIDA")
  }
  if (e.passo?.ultimoContatoResultado === "RETORNO_RECEBIDO") {
    retornoRecebido = true
    retornoFatoChave = retornoFatoChave ?? `contato:${e.passo.ultimoContatoChave ?? "sem-chave"}`
    origemDosDados.push("ContatoEtapa.resultado=RETORNO_RECEBIDO")
  }
  // CONFLITO: a solicitação formal ainda não fechou, mas o último contato
  // registrado diz que o retorno já chegou — as duas fontes discordam;
  // reportamos, não decidimos por uma.
  if (solicitacaoAtiva && e.passo?.ultimoContatoResultado === "RETORNO_RECEBIDO") {
    motivosRisco.push(
      "CONFLITO_RETORNO_TERCEIRO: o último contato registra retorno recebido, mas a SolicitacaoDocumento ainda não está RESPONDIDA",
    )
  }

  // ── ESTADO TEMPORAL CANÔNICO (dimensão A, via a régua única) ─────────────
  const tempo = estadoTemporal({
    dataPrazo: prazoOperacao,
    dataConclusao: e.dataConclusao,
    statusTarefa: e.statusTarefa,
    aguardandoTerceiro: aguardando,
    slaPausadoEm: e.slaPausadoEm,
    slaPausaAcumuladaMin: e.slaPausaAcumuladaMin,
    criadaEm: e.createdAt,
    agora: e.agora,
  })

  // Atraso interno NUNCA nasce de espera de terceiro/cliente — é a regra
  // explícita da Etapa 3 (item 3): "terceiro atrasado NÃO deve
  // automaticamente significar atraso interno".
  const atrasoInterno = !encerrada && !aguardando && tempo.atrasado
  const atrasoTerceiro = !encerrada && !!previsaoTerceiro && previsaoTerceiro.getTime() < e.agora.getTime() && !retornoRecebido
  // POR DIA (fuso operacional), não por instante — achado real (19/09/2026,
  // mandato "correção definitiva do modelo temporal"): a categoria de Minha
  // Operação alimentada por este sinal se CHAMA "Acompanhar hoje". Um
  // acompanhamento cuja data-calendário é HOJE precisa contar como vencido
  // pra esse propósito mesmo que o horário exato do dia ainda não tenha
  // chegado — "atrasado" (dia anterior a hoje) e "hoje" são as DUAS
  // situações que essa única categoria cobre (não existe uma categoria
  // "acompanhamento atrasado" separada de "acompanhar hoje" em Minha
  // Operação). O horário em si continua preservado em `proximoAcompanhamentoData`
  // pra quem ordena/exibe — só a CLASSIFICAÇÃO passou a ser por dia.
  const acompanhamentoVencido = !encerrada && !!proximoAcompanhamentoData
    && diasEntreDiasOperacionais(proximoAcompanhamentoData, e.agora) <= 0

  // ── DETERMINAÇÃO DO PRÓXIMO ACONTECIMENTO ────────────────────────────────
  let proximoAcontecimento: ProximoAcontecimento

  if (encerrada) {
    proximoAcontecimento = {
      tipo: "encerrada", data: null, descricao: "Operação encerrada — nenhum próximo acontecimento",
      responsavelId: null, aguardandoTerceiro: false, terceiroAguardado: null, origem: "Tarefa.statusTarefa",
    }
  } else if (retornoRecebido) {
    // Regra da Etapa 3, item 8: retorno confiável é AÇÃO NECESSÁRIA imediata —
    // não espera o próximo acompanhamento, mesmo que exista um agendado.
    proximoAcontecimento = {
      tipo: "retorno_recebido", data: e.agora.toISOString(),
      descricao: "Retorno recebido — ação interna necessária",
      responsavelId: e.responsavelId, aguardandoTerceiro: aguardando, terceiroAguardado,
      origem: origemDosDados.filter((o) => o.includes("RESPONDIDA") || o.includes("RETORNO_RECEBIDO")).join(" + "),
    }
    if (aguardando) {
      motivosRisco.push("RETORNO_SEM_ACAO_INTERNA: o terceiro respondeu, mas a tarefa continua em espera")
    }
  } else if (aguardando) {
    if (!previsaoTerceiro && !proximoAcompanhamentoData) {
      motivosRisco.push("AGUARDANDO_SEM_PREVISAO_NEM_ACOMPANHAMENTO")
      // A DESCRIÇÃO NÃO ALARMA O OPERADOR — "em risco" é leitura de
      // configuração (falta previsão/acompanhamento cadastrado), não uma
      // urgência dela. Quem trata isso é a Saúde do Sistema (EMI-022, que lê
      // o mesmo `motivosRisco`); aqui ela só vê que está esperando terceiro.
      proximoAcontecimento = {
        tipo: "em_risco", data: null,
        descricao: `Aguardando ${terceiroAguardado ?? "terceiro"}`,
        responsavelId: e.responsavelId, aguardandoTerceiro: true, terceiroAguardado, origem: "nenhuma fonte",
      }
    } else {
      // QUAL DAS DUAS É O PRÓXIMO ACONTECIMENTO — nunca a menor data "por
      // acaso". Uma previsão de terceiro já VENCIDA não é "o que vem a
      // seguir": é um FATO (`atrasoTerceiro`, calculado à parte). O que vem a
      // seguir é sempre a próxima data ainda PENDENTE; entre duas pendentes,
      // a mais próxima. Se as duas já venceram, o acompanhamento manda —
      // é a ação interna mais direta (verificar o que aconteceu).
      const acompanhamentoPendente = proximoAcompanhamentoData != null && proximoAcompanhamentoData.getTime() >= e.agora.getTime()
      const previsaoPendente = previsaoTerceiro != null && previsaoTerceiro.getTime() >= e.agora.getTime()
      const acompanhamentoVenceAntes =
        proximoAcompanhamentoData == null
          ? false
          : previsaoTerceiro == null
            ? true
            : acompanhamentoPendente && previsaoPendente
              ? proximoAcompanhamentoData.getTime() <= previsaoTerceiro.getTime()
              : acompanhamentoPendente
                ? true
                : previsaoPendente
                  ? false
                  : true // as duas já venceram — o acompanhamento é a ação interna mais direta
      if (acompanhamentoVenceAntes) {
        // SITUAÇÃO × PRÓXIMA AÇÃO (mandato "Minha Operação" §7): a descrição
        // diz O QUE está sendo aguardado; a DATA já viaja separada em
        // `data` — quem lê decide se/como mostra "acompanhar em X" como
        // contexto secundário, sem embuti-la na frase de ação.
        proximoAcontecimento = {
          tipo: "aguardando_terceiro_acompanhamento", data: proximoAcompanhamentoData!.toISOString(),
          descricao: `Aguardando ${terceiroAguardado ?? "terceiro"}`,
          responsavelId: e.responsavelId, aguardandoTerceiro: true, terceiroAguardado,
          origem: "metadata.operacao.proximoAcompanhamento",
        }
      } else {
        proximoAcontecimento = {
          tipo: "aguardando_terceiro_previsao", data: previsaoTerceiro!.toISOString(),
          descricao: `Aguardando retorno de ${terceiroAguardado ?? "terceiro"}`,
          responsavelId: e.responsavelId, aguardandoTerceiro: true, terceiroAguardado,
          origem: solicitacaoAtiva ? "SolicitacaoDocumento.previsaoRetorno" : "metadata.operacao.previsaoEfetiva",
        }
      }
      if (acompanhamentoVencido) motivosRisco.push("ACOMPANHAMENTO_VENCIDO")
    }
  } else if (prazoOperacao) {
    // A AÇÃO, não só o prazo (mandato "Minha Operação" §4/§6-C): quando o
    // passo atual tem rótulo publicado (o caso normal), ele diz O QUE fazer
    // — "Enviar requerimento ao cartório", não "Responsável deve agir até
    // 21/09". A data já viaja separada em `data`/`prazoOperacao` — quem lê
    // decide se mostra "até X" como contexto secundário.
    proximoAcontecimento = {
      tipo: "acao_interna", data: prazoOperacao.toISOString(),
      descricao: e.passo?.etapaLabel ? e.passo.etapaLabel : `Responsável deve agir até ${dataBR(prazoOperacao)}`,
      responsavelId: e.responsavelId, aguardandoTerceiro: false, terceiroAguardado: null, origem: "Tarefa.dataPrazo",
    }
    if (acompanhamentoVencido) motivosRisco.push("ACOMPANHAMENTO_VENCIDO")
  } else if (proximoAcompanhamentoData) {
    // Regra da Etapa 3, item 7: SEM dataPrazo primeiro tenta as demais fontes
    // antes de declarar risco — este é exatamente esse caso.
    proximoAcontecimento = {
      tipo: "acompanhamento", data: proximoAcompanhamentoData.toISOString(),
      descricao: e.passo?.etapaLabel ? e.passo.etapaLabel : "Acompanhar",
      responsavelId: e.responsavelId, aguardandoTerceiro: false, terceiroAguardado: null,
      origem: "metadata.operacao.proximoAcompanhamento",
    }
    if (acompanhamentoVencido) motivosRisco.push("ACOMPANHAMENTO_VENCIDO")
  } else {
    motivosRisco.push("SEM_PROXIMO_ACONTECIMENTO_DETERMINAVEL")
    // MESMA REGRA: "risco" é diagnóstico de configuração, não vocabulário
    // para o operador. `tipo`/`motivosRisco` continuam carregando o sinal
    // técnico para a Saúde do Sistema.
    proximoAcontecimento = {
      tipo: "em_risco", data: null,
      descricao: "Sem próxima ação definida",
      responsavelId: e.responsavelId, aguardandoTerceiro: false, terceiroAguardado: null, origem: "nenhuma fonte",
    }
  }

  // Passo executável (não em espera, não encerrado) sem responsável — a
  // próxima ação não tem quem a execute.
  if (!encerrada && !aguardando && e.responsavelId == null) {
    motivosRisco.push("SEM_RESPONSAVEL_PARA_PROXIMA_ACAO")
  }

  const emRisco = !encerrada && (motivosRisco.length > 0 || proximoAcontecimento.tipo === "em_risco")

  return {
    tarefaId: e.tarefaId,
    prazoOperacao: prazoOperacao?.toISOString() ?? null,
    slaPassoAtual: slaPassoAtual?.toISOString() ?? null,
    previsaoTerceiro: previsaoTerceiro?.toISOString() ?? null,
    proximoAcompanhamentoData: proximoAcompanhamentoData?.toISOString() ?? null,
    proximoAcontecimento,
    atrasoInterno,
    atrasoTerceiro,
    acompanhamentoVencido,
    emRisco,
    motivosRisco,
    retornoRecebido,
    retornoFatoChave,
    origemDosDados,
  }
}

// ============================================================================
// CAMADA DE I/O — carrega o snapshot, delega o cálculo ao núcleo puro acima.
// ============================================================================

const SELECT_TAREFA_TEMPORAL = {
  id: true, statusTarefa: true, motivoCodigo: true, dataPrazo: true, dataConclusao: true, dataInicio: true,
  slaPausadoEm: true, slaPausaAcumuladaMin: true, responsavelId: true, createdAt: true,
  workflowStepInstanceId: true,
} satisfies Prisma.TarefaSelect

/**
 * Projeção temporal de N tarefas — poucas queries agregadas (custo constante
 * em número de queries, mesmo desenho de `resolveSlaProjectionBatch`).
 */
export async function estadosTemporaisDasOperacoes(
  db: Leitor,
  tarefaIds: number[],
  agora: Date = new Date(),
): Promise<Map<number, EstadoTemporalDaOperacao>> {
  const resultado = new Map<number, EstadoTemporalDaOperacao>()
  if (tarefaIds.length === 0) return resultado

  const tarefas = await db.tarefa.findMany({
    where: { id: { in: tarefaIds } },
    select: SELECT_TAREFA_TEMPORAL,
  })

  const stepIds = [...new Set(tarefas.map((t) => t.workflowStepInstanceId).filter((id): id is number => id != null))]
  const steps = stepIds.length
    ? await db.phaseWorkflowStepInstance.findMany({
        where: { id: { in: stepIds } },
        select: { id: true, prazo: true, startedAt: true, metadata: true, stepKey: true, stepDefinitionId: true, snapshot: true },
      })
    : []
  const stepPorId = new Map(steps.map((s) => [s.id, s]))

  // O RÓTULO PUBLICADO DO PASSO — batched pelo `stepDefinitionId` (mesmo
  // padrão de `rotulosDosPassos` em `tarefa-projecoes.ts`; não importado
  // daqui para não criar ciclo de import — este arquivo é importado por ele).
  const defIds = [...new Set(steps.map((s) => s.stepDefinitionId).filter((id): id is number => id != null))]
  const definicoes = defIds.length
    ? await db.phaseInternalWorkflowStep.findMany({ where: { id: { in: defIds } }, select: { id: true, label: true } })
    : []
  const labelPorDefId = new Map(definicoes.map((d) => [d.id, d.label]))
  const etapaLabelDoStep = (s: { snapshot: unknown; stepDefinitionId: number | null; stepKey: string } | null): string | null => {
    if (!s) return null
    const snap = s.snapshot as { label?: string; titulo?: string } | null
    return snap?.label ?? snap?.titulo ?? (s.stepDefinitionId != null ? labelPorDefId.get(s.stepDefinitionId) : null) ?? null
  }

  const solicitacoes = await db.solicitacaoDocumento.findMany({
    where: { tarefaId: { in: tarefaIds } },
    select: {
      id: true, tarefaId: true, status: true, previsaoRetorno: true, prazoEsperadoDias: true, dataEnvio: true,
      destinatarioNome: true, orgao: { select: { name: true, nomeFantasia: true } },
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  })
  // UMA solicitação por tarefa — a mais recente, quando há mais de uma (nova via).
  const solicitacaoPorTarefa = new Map<number, (typeof solicitacoes)[number]>()
  for (const s of solicitacoes) {
    if (s.tarefaId != null && !solicitacaoPorTarefa.has(s.tarefaId)) solicitacaoPorTarefa.set(s.tarefaId, s)
  }

  for (const t of tarefas) {
    const stepRow = t.workflowStepInstanceId != null ? stepPorId.get(t.workflowStepInstanceId) ?? null : null
    const operacao = (stepRow?.metadata as Record<string, unknown> | null)?.operacao ?? null
    const andamento = lerAndamento(operacao)
    const ultimoContato = andamento.contatos.length > 0 ? andamento.contatos[andamento.contatos.length - 1] : null

    const solRow = solicitacaoPorTarefa.get(t.id) ?? null

    const entrada: EntradaOperacao = {
      tarefaId: t.id,
      statusTarefa: t.statusTarefa,
      motivoCodigo: t.motivoCodigo,
      dataPrazo: t.dataPrazo,
      dataConclusao: t.dataConclusao,
      dataInicio: t.dataInicio,
      slaPausadoEm: t.slaPausadoEm,
      slaPausaAcumuladaMin: t.slaPausaAcumuladaMin,
      responsavelId: t.responsavelId,
      createdAt: t.createdAt,
      agora,
      passo: stepRow
        ? {
            prazo: stepRow.prazo,
            startedAt: stepRow.startedAt,
            andamento,
            ultimoContatoResultado: ultimoContato?.resultado ?? null,
            ultimoContatoChave: ultimoContato?.chave ?? null,
            etapaLabel: etapaLabelDoStep(stepRow),
          }
        : null,
      solicitacao: solRow
        ? {
            id: solRow.id,
            status: solRow.status,
            previsaoRetorno: solRow.previsaoRetorno,
            prazoEsperadoDias: solRow.prazoEsperadoDias,
            dataEnvio: solRow.dataEnvio,
            terceiroNome: solRow.orgao?.nomeFantasia ?? solRow.orgao?.name ?? solRow.destinatarioNome ?? null,
          }
        : null,
    }
    resultado.set(t.id, computarProximoAcontecimento(entrada))
  }

  return resultado
}

/** Uma tarefa só — delega ao batch (mesma carga/mesma lógica, nunca uma segunda forma). */
export async function estadoTemporalDaOperacao(
  db: Leitor,
  tarefaId: number,
  agora: Date = new Date(),
): Promise<EstadoTemporalDaOperacao | null> {
  const mapa = await estadosTemporaisDasOperacoes(db, [tarefaId], agora)
  return mapa.get(tarefaId) ?? null
}

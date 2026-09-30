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
//   D. PRÓXIMO ACOMPANHAMENTO — `SubtaskExecution.proximoAcompanhamentoEm` da
//                                subtarefa corrente em espera externa (ajuste
//                                pós-Bloco-B, 29/09/2026 — era
//                                `metadata.operacao.proximoAcompanhamento`,
//                                nunca escrito pelo motor atual; preservado
//                                só como fallback de passos sem subtarefas).
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
import { escolherSubtarefaCorrente, definicoesDasSubtarefas, acompanhamentoVenceuNoDia, criarCacheDeLeitura, type CacheDeLeitura } from "./subtarefa-corrente"
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
  /**
   * DIMENSÃO D, fonte canônica (ajuste pós-Bloco-B, 29/09/2026):
   * `SubtaskExecution.proximoAcompanhamentoEm` da subtarefa CORRENTE (a de
   * `escolherSubtarefaCorrente`, em qualquer status não encerrado — inclusive
   * "a iniciar"), quando o passo usa o motor de subtarefas
   * (`subtarefas-da-etapa.ts`/`registrarCobranca`/`adiarAcompanhamento` —
   * quem de fato grava esta data hoje). `null` = passo sem subtarefas
   * (motor mais antigo) ou nenhuma subtarefa em espera agora — cai no
   * fallback de `passo.andamento.proximoAcompanhamento` abaixo.
   */
  proximoAcompanhamentoDaSubtarefaCorrente?: Date | null
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
  // FONTE CANÔNICA primeiro (`SubtaskExecution.proximoAcompanhamentoEm`, a
  // mesma que `acompanhamentoPasso.rotulo` usa em tarefa-projecoes.ts — as
  // duas precisam SEMPRE concordar, achado real 29/09/2026:
  // #3861/#3863/#3865/#3867 mostravam rótulo "Atrasada há 2 dias" com
  // `acompanhamentoVencido=false` porque só esta dimensão ainda lia o campo
  // legado, nunca escrito pelo motor atual). `metadata.operacao...` só entra
  // quando a subtarefa canônica não existe (passo sem motor de subtarefas).
  let proximoAcompanhamentoData: Date | null = null
  if (e.proximoAcompanhamentoDaSubtarefaCorrente) {
    proximoAcompanhamentoData = e.proximoAcompanhamentoDaSubtarefaCorrente
    origemDosDados.push("SubtaskExecution.proximoAcompanhamentoEm")
  } else if (e.passo?.andamento.proximoAcompanhamento) {
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
  const acompanhamentoVencido = !encerrada && acompanhamentoVenceuNoDia(proximoAcompanhamentoData, e.agora)

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
  workflowStepInstanceId: true, workflowInstanceId: true,
} satisfies Prisma.TarefaSelect

export type TarefaTemporal = Prisma.TarefaGetPayload<{ select: typeof SELECT_TAREFA_TEMPORAL }>

/**
 * O QUE QUEM CHAMA JÁ TEM EM MÃOS (Torre, D2, 30/09/2026) — `tarefas`: as linhas
 * da Tarefa já lidas (com ao menos os campos de `SELECT_TAREFA_TEMPORAL`), para
 * NÃO relê-las; `cache`: o cache de leitura da requisição, para não repetir a
 * leitura de passos/instâncias/versões/execuções/rótulos que a projeção já fez.
 * O CÁLCULO é o mesmo (`computarProximoAcontecimento`); só a origem dos dados
 * muda. Sem `pre`, a função lê tudo sozinha, como sempre (cron, saúde, dossiê).
 */
export interface PreCarga { tarefas?: TarefaTemporal[]; cache?: CacheDeLeitura }

/**
 * Projeção temporal de N tarefas — poucas queries agregadas (custo constante
 * em número de queries, mesmo desenho de `resolveSlaProjectionBatch`).
 */
export async function estadosTemporaisDasOperacoes(
  db: Leitor,
  tarefaIds: number[],
  agora: Date = new Date(),
  pre: PreCarga = {},
): Promise<Map<number, EstadoTemporalDaOperacao>> {
  const resultado = new Map<number, EstadoTemporalDaOperacao>()
  if (tarefaIds.length === 0) return resultado
  const cache = pre.cache ?? criarCacheDeLeitura(db)

  // `tarefas`, `solicitacoes`, os passos e as execuções vigentes só dependem dos ids (ou da linha da Tarefa) —
  // buscados juntos, nunca um depois do outro (achado real 26/09/2026, Etapa B: perf de /api/operacao/tarefas;
  // D2 30/09/2026: passos e execuções também saíram da fila).
  const tarefasPre = pre.tarefas
  const tarefasP = tarefasPre
    ? Promise.resolve(tarefasPre)
    : db.tarefa.findMany({ where: { id: { in: tarefaIds } }, select: SELECT_TAREFA_TEMPORAL })
  const idsDePasso = (ts: TarefaTemporal[]) => [...new Set(ts.map((t) => t.workflowStepInstanceId).filter((id): id is number => id != null))]
  const [tarefas, solicitacoes, steps, execucoesVigentes] = await Promise.all([
    tarefasP,
    db.solicitacaoDocumento.findMany({
      where: { tarefaId: { in: tarefaIds } },
      select: {
        id: true, tarefaId: true, status: true, previsaoRetorno: true, prazoEsperadoDias: true, dataEnvio: true,
        destinatarioNome: true, orgao: { select: { name: true, nomeFantasia: true } },
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    tarefasP.then((ts) => cache.passos(idsDePasso(ts))),
    // DIMENSÃO D, fonte canônica — a subtarefa CORRENTE de cada passo (a MESMA
    // escolha de `progressoPorSubtarefa`/`acompanhamentoPasso.rotulo`, via
    // `escolherSubtarefaCorrente`), em QUALQUER status não encerrado. Achado
    // real (30/09/2026, processo 651): antes só lia `AGUARDANDO_EXTERNO`, e uma
    // subtarefa "a iniciar" (DISPONIVEL) com acompanhamento no passado mostrava
    // "Atrasada há N dias" sem entrar em "Acompanhamentos vencidos". Sem
    // `progressoPorSubtarefa` de propósito (aquele módulo IMPORTA este — ciclo).
    tarefasP.then((ts) => cache.execucoes(idsDePasso(ts))),
  ])
  const stepPorId = new Map(steps.map((s) => [s.id, s]))
  const execucoesDefinicoes = await Promise.all([
    definicoesDasSubtarefas(
      db,
      tarefas.flatMap((t) => {
        const st = t.workflowStepInstanceId != null ? stepPorId.get(t.workflowStepInstanceId) : null
        return st ? [{ stepInstanceId: st.id, stepKey: st.stepKey, workflowInstanceId: t.workflowInstanceId }] : []
      }),
      cache,
    ),
    // O RÓTULO PUBLICADO DO PASSO — batched pelo `stepDefinitionId` (mesmo cadastro que `rotulosDosPassos` em
    // `tarefa-projecoes.ts` lê, agora pelo MESMO cache: uma leitura só).
    cache.rotulosDeDefinicao([...new Set(steps.map((s) => s.stepDefinitionId).filter((id): id is number => id != null))]),
  ])
  const definicoesDoPasso = execucoesDefinicoes[0]
  const definicoes = execucoesDefinicoes[1]
  const execucoesPorStep = new Map<number, typeof execucoesVigentes>()
  for (const x of execucoesVigentes) execucoesPorStep.set(x.stepInstanceId, [...(execucoesPorStep.get(x.stepInstanceId) ?? []), x])
  const proximoAcompanhamentoPorStepInstance = new Map<number, Date | null>()
  for (const [stepInstanceId, execs] of execucoesPorStep) {
    const def = definicoesDoPasso.get(stepInstanceId)
    const corrente = escolherSubtarefaCorrente(execs, def?.defs, def?.ordens)
    if (corrente) proximoAcompanhamentoPorStepInstance.set(stepInstanceId, corrente.proximoAcompanhamentoEm)
  }

  const labelPorDefId = new Map(definicoes.map((d) => [d.id, d.label]))
  const etapaLabelDoStep = (s: { snapshot: unknown; stepDefinitionId: number | null; stepKey: string } | null): string | null => {
    if (!s) return null
    const snap = s.snapshot as { label?: string; titulo?: string } | null
    return snap?.label ?? snap?.titulo ?? (s.stepDefinitionId != null ? labelPorDefId.get(s.stepDefinitionId) : null) ?? null
  }
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
      proximoAcompanhamentoDaSubtarefaCorrente:
        t.workflowStepInstanceId != null ? proximoAcompanhamentoPorStepInstance.get(t.workflowStepInstanceId) ?? null : null,
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

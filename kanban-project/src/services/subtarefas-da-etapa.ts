// src/services/subtarefas-da-etapa.ts
// ============================================================================
// O QUE ACONTECE DENTRO DE UM PASSO — projetado a partir do cadastro.
//
// Este módulo responde três perguntas que a tela precisa fazer e não podia:
//   1. Quais subtarefas ESTE passo tem? (as da versão que ele registrou)
//   2. Em que estado cada uma está?    (da execução vigente, não de suposição)
//   3. Por que aquela não pode ser feita agora? (causa nomeada, não "bloqueada")
//
// ─── VISÍVEL, DISPONÍVEL, EXECUTÁVEL E OBRIGATÓRIA SÃO QUATRO COISAS ───────
// Uma subtarefa pode estar visível e indisponível (o operador vê que existe e por que
// ainda não pode). Pode estar disponível e não obrigatória. Tratar escondida como
// cumprida — que é o atalho tentador — faria o passo concluir sem que ela acontecesse.
//
// ─── DEPENDÊNCIA É DECLARADA ───────────────────────────────────────────────
// B depende de A porque o cadastro diz, não porque B vem depois na lista. Duas
// subtarefas podem depender da mesma e não uma da outra — e ordem não sabe dizer isso.
// ============================================================================

import { prisma } from "@/lib/prisma"
import { avaliarCondicao, descreverCondicao, type Condicao } from "@/src/lib/motor/condicoes"
import { definicaoHistoricaDoPasso, type SubtarefaCongelada } from "@/src/services/versao-publicada"
import {
  vigentesDoPasso, ESTADOS_DA_SUBTAREFA, CAUSAS_DE_BLOQUEIO,
  type ExecucaoDeSubtarefa, type EstadoDaSubtarefa, type CausaDeBloqueio,
} from "@/src/services/execucao-da-subtarefa"
import { canaisDaOrganizacao, FONTES_DE_CANAIS, type CanalDisponivel } from "@/src/lib/motor/canais-do-fornecedor"
import { prazoOperacional } from "@/lib/operacional/tempo-operacional"

export interface RelogioDeEsperaExterna {
  /** Dimensão C — regra temporal do terceiro. `null` = não configurada. */
  previstoPara: Date | null
  /** Dimensão D — acompanhamento. `null` = não configurado. */
  proximoAcompanhamentoEm: Date | null
}

/**
 * O RELÓGIO DE UMA ESPERA EXTERNA — os DOIS relógios da espera, cada um só
 * quando o cadastro liga o respectivo interruptor. Nenhum dos dois é
 * `Tarefa.dataPrazo` (prazo oficial, único e final — decisão definitiva,
 * 23/09/2026: a subtarefa não tem prazo próprio nenhum, nem "de ação
 * interna"). Uma subtarefa pode ter só acompanhamento, só regra temporal, os
 * dois, ou nenhum — os quatro casos são legítimos e a função nunca inventa o
 * que o cadastro não configurou.
 *
 * `dataGatilhoRegraTemporal` já vem resolvida por quem chama (o gatilho é
 * genérico — "conclusão da subtarefa X" ou a própria liberação desta — a
 * resolução em si mora em `dataDoGatilhoDaRegraTemporal`, abaixo, porque
 * precisa ler `SubtaskExecution.completedAt` de outra subtarefa e esta
 * função continua pura).
 */
export function relogioDeEsperaExternaDaSubtarefa(args: {
  acompanhamentoAtivo: boolean
  acompanhamentoPrimeiroDias: number | null
  regraTemporalAtiva: boolean
  regraTemporalDias: number | null
  dataGatilhoRegraTemporal: Date | null
  dataBase: Date
}): RelogioDeEsperaExterna {
  const proximoAcompanhamentoEm = args.acompanhamentoAtivo
    ? prazoOperacional(args.acompanhamentoPrimeiroDias, args.dataBase)
    : null
  const previstoPara = args.regraTemporalAtiva && args.dataGatilhoRegraTemporal
    ? prazoOperacional(args.regraTemporalDias, args.dataGatilhoRegraTemporal)
    : null
  return { previstoPara, proximoAcompanhamentoEm }
}

/**
 * O GATILHO DA REGRA TEMPORAL — resolve a DATA a partir da `key` configurada
 * (`regraTemporalGatilhoChave`), lendo `completedAt` da execução VIGENTE
 * daquela subtarefa irmã, no MESMO passo. Nenhum evento novo: reaproveita o
 * que `SubtaskExecution` já grava para toda conclusão — "conclusão da
 * subtarefa X" nunca é hardcoded para um domínio específico (nunca
 * "confirmação de cartório" aqui), é sempre "a subtarefa que o cadastro
 * apontar". `null` de chave = o gatilho é a própria liberação desta
 * subtarefa (quem chama passa `dataBase` diretamente nesse caso).
 */
export async function dataDoGatilhoDaRegraTemporal(
  stepInstanceId: number,
  gatilhoChave: string | null,
  dataBase: Date,
  db: Parameters<typeof vigentesDoPasso>[1] = prisma,
): Promise<Date | null> {
  if (!gatilhoChave) return dataBase
  const { execucaoVigente } = await import("@/src/services/execucao-da-subtarefa")
  const exec = await execucaoVigente(stepInstanceId, gatilhoChave, db)
  return exec?.completedAt ?? null
}

export interface SubtarefaProjetada {
  key: string
  label: string
  descricao: string | null
  ordem: number
  obrigatoria: boolean
  repetivel: boolean
  maxOcorrencias: number | null
  modoExecucao: string
  executorKey: string | null
  dependeDe: string[]

  /// APARECE na tela? Condição de visibilidade falsa = não aparece.
  visivel: boolean
  /// PODE ser executada agora? Dependência cumprida + condição de entrada satisfeita.
  disponivel: boolean
  /// Já foi cumprida?
  concluida: boolean
  /// O estado da execução vigente. Sem execução ainda: PENDENTE ou DISPONIVEL.
  status: EstadoDaSubtarefa
  /// POR QUE não dá para fazer agora — nomeado, para a tela poder explicar.
  bloqueioCodigo: CausaDeBloqueio | null
  bloqueioAlvo: string | null
  bloqueioTexto: string | null

  /// A execução vigente, quando existe.
  execucao: ExecucaoDeSubtarefa | null
  /// Quantas vezes já foi executada (todas as tentativas, inclusive substituídas).
  ocorrencias: number
  /// Pode ganhar mais uma ocorrência? Só quem é repetível, e dentro do teto.
  podeRepetir: boolean

  /// Os canais que ELA oferece, resolvidos pelo fornecedor concreto. Vazio quando ela
  /// não usa canal — ou quando o fornecedor não tem canal cadastrado, e aí o bloqueio
  /// diz isso.
  canais: CanalDisponivel[]

  /// A configuração congelada dela, para o executor desenhar.
  definicao: SubtarefaCongelada
}

const vazio = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "")

/**
 * A LISTA DE SUBTAREFAS DESTA INSTÂNCIA DE PASSO, com estado e motivo.
 *
 * Lê a definição HISTÓRICA (a versão que a execução registrou), nunca a de hoje: um
 * passo que começou na v1 não ganha subtarefa nova porque alguém publicou a v2.
 *
 * `fornecedorId` é o fornecedor CONCRETO daquele documento — quem chama sabe resolvê-lo
 * (o documento aponta para o cartório). Sem ele, subtarefa que depende de canal fica
 * bloqueada com causa nomeada em vez de oferecer uma lista genérica.
 */
export async function subtarefasDaEtapa(args: {
  stepInstanceId: number
  /// O que já foi preenchido — é sobre isto que as condições são avaliadas.
  valores?: Record<string, unknown>
  fornecedorId?: number | null
}): Promise<SubtarefaProjetada[]> {
  const hist = await definicaoHistoricaDoPasso(args.stepInstanceId)
  const definicoes = (hist?.passo.subtarefas ?? []).filter((s) => s.ativo !== false)
  if (definicoes.length === 0) return []

  const execucoes = await vigentesDoPasso(args.stepInstanceId)
  const porChave = new Map(execucoes.map((e) => [e.subtaskKey, e]))
  const totais = await prisma.subtaskExecution.groupBy({
    by: ["subtaskKey"],
    where: { stepInstanceId: args.stepInstanceId },
    _count: { _all: true },
  })
  const ocorrenciasPor = new Map(totais.map((t) => [t.subtaskKey, t._count._all]))

  const ctx = { valores: args.valores ?? {} }
  const rotulos = Object.fromEntries(definicoes.map((d) => [d.key, d.label]))

  // CUMPRIDAS de verdade: só concluídas. Cancelada e invalidada saíram de cena sem
  // ter sido cumpridas — liberar dependente por causa delas seria dar por feito o que
  // não foi feito.
  const cumpridas = new Set(
    definicoes
      .filter((d) => porChave.get(d.key)?.status === ESTADOS_DA_SUBTAREFA.CONCLUIDO)
      .map((d) => d.key),
  )

  // CACHE DOS CANAIS DO FORNECEDOR — `args.fornecedorId` é CONSTANTE dentro
  // desta chamada (é o mesmo documento/passo para todas as subtarefas), mas
  // cada subtarefa que precisa de canal chamava `canaisDaSubtarefa` de novo,
  // um SELECT idêntico repetido (achado real, Etapa 2 item 7 — 26/09/2026:
  // "Solicitar certidão" tem 2 das 4 subtarefas com `fonteDeCanais` ativo,
  // e cada leitura da tela fazia 2 SELECTs iguais em vez de 1). Resolvido
  // uma vez, memoizado; a interseção por `tiposDeCanal` continua por
  // subtarefa, mas é pura (sem I/O).
  let canaisDoFornecedorCache: CanalDisponivel[] | null = null
  const canaisDoFornecedor = async (): Promise<CanalDisponivel[]> => {
    if (!args.fornecedorId) return []
    if (canaisDoFornecedorCache == null) canaisDoFornecedorCache = await canaisDaOrganizacao(args.fornecedorId)
    return canaisDoFornecedorCache
  }

  const projetadas: SubtarefaProjetada[] = []
  for (const d of definicoes) {
    const execucao = porChave.get(d.key) ?? null
    const ocorrencias = ocorrenciasPor.get(d.key) ?? 0
    const concluida = execucao?.status === ESTADOS_DA_SUBTAREFA.CONCLUIDO

    const visivel = avaliarCondicao(d.condicaoVisibilidade as Condicao | null, ctx)

    // ── POR QUE NÃO DÁ PARA FAZER AGORA ────────────────────────────────────
    let bloqueioCodigo: CausaDeBloqueio | null = null
    let bloqueioAlvo: string | null = null
    let bloqueioTexto: string | null = null

    const pendente = (d.dependeDe ?? []).find((k) => !cumpridas.has(k))
    if (pendente) {
      bloqueioCodigo = CAUSAS_DE_BLOQUEIO.DEPENDENCIA_PENDENTE
      bloqueioAlvo = pendente
      bloqueioTexto = `Depende de "${rotulos[pendente] ?? pendente}", que ainda não foi concluída.`
    } else if (!avaliarCondicao(d.condicaoEntrada as Condicao | null, ctx)) {
      bloqueioCodigo = CAUSAS_DE_BLOQUEIO.CONDICAO_DE_ENTRADA
      bloqueioTexto = descreverCondicao(d.condicaoEntrada as Condicao | null, rotulos)
        || "Ainda não se aplica com o que foi preenchido."
    }

    // ── OS CANAIS, quando ela envia algo para fora ─────────────────────────
    //
    // SEM DEPENDÊNCIA DECLARADA (ponto de entrada do passo) — é ELA quem
    // estabelece o contato com o órgão pela primeira vez; travar "Iniciar" por
    // falta do próprio dado que essa subtarefa existe para capturar inverte a
    // ordem do trabalho. Achado real (15/09/2026): a subtarefa "Enviar
    // requerimento ao cartório" ficava bloqueada (FORNECEDOR_AUSENTE) para
    // SEMPRE em documento novo, e o editor dela nem usa `fornecedorId` — o
    // vínculo com o órgão (Documento.orgaoId) e o cadastro de canais por
    // fornecedor (OrganizacaoCanal) são uma camada mais nova, ainda não citada
    // por este formulário específico. Só quem TEM uma dependência (2ª
    // subtarefa em diante) pode presumir que o órgão já foi resolvido por
    // quem veio antes — para essas, o bloqueio continua valendo.
    const podeResolverProprioFornecedor = (d.dependeDe ?? []).length === 0
    let canais: CanalDisponivel[] = []
    if (d.fonteDeCanais !== "NENHUMA" && !podeResolverProprioFornecedor) {
      if (!args.fornecedorId) {
        if (!bloqueioCodigo) {
          bloqueioCodigo = CAUSAS_DE_BLOQUEIO.FORNECEDOR_AUSENTE
          bloqueioTexto = "Falta definir o órgão/fornecedor deste documento — sem ele não há por onde enviar."
        }
      } else {
        const doFornecedor = await canaisDoFornecedor()
        if (d.fonteDeCanais !== FONTES_DE_CANAIS.TIPOS_PERMITIDOS) {
          canais = doFornecedor
        } else {
          const permitidos = new Set(d.tiposDeCanal ?? [])
          // RESTRIÇÃO É INTERSEÇÃO, nunca acréscimo — mesma regra de `canaisDaSubtarefa`.
          canais = permitidos.size === 0 ? doFornecedor : doFornecedor.filter((c) => permitidos.has(c.key))
        }
        if (canais.length === 0 && !bloqueioCodigo) {
          bloqueioCodigo = CAUSAS_DE_BLOQUEIO.CANAL_INDISPONIVEL
          bloqueioTexto = "O órgão deste documento não tem canal de atendimento cadastrado."
        }
      }
    }

    const disponivel = !concluida && bloqueioCodigo === null
    // O ESTADO GRAVADO MANDA quando existe: ele é fato. Sem execução, o estado é o que
    // a projeção calcula — e "bloqueada" precisa de causa para poder ser bloqueada.
    //
    // ESPERA EXTERNA AO LIBERAR (mesma régua de `PhaseInternalWorkflowStep`, um
    // nível abaixo — ver `esperaExternaAoLiberar` em `StepSubtaskDefinition`): a
    // subtarefa que acabou de ficar disponível, sem execução ainda, e está
    // cadastrada como espera de terceiro, nasce em AGUARDANDO_EXTERNO — não em
    // DISPONIVEL. A escrita real (execução + Tarefa BLOQUEADA/AGUARDANDO_TERCEIRO)
    // é feita por `aplicarEsperaExternaDaSubtarefaSeConfigurado`; esta projeção só
    // precisa REFLETIR isso antes mesmo de existir execução persistida, do
    // contrário a tela mostraria "Disponível" por uma fresta entre o passo
    // liberar e a escrita automática acontecer.
    const status: EstadoDaSubtarefa = execucao
      ? (execucao.status as EstadoDaSubtarefa)
      : bloqueioCodigo
        ? ESTADOS_DA_SUBTAREFA.BLOQUEADO
        : d.esperaExternaAoLiberar === true
          ? ESTADOS_DA_SUBTAREFA.AGUARDANDO_EXTERNO
          : ESTADOS_DA_SUBTAREFA.DISPONIVEL

    projetadas.push({
      key: d.key, label: d.label, descricao: d.descricao, ordem: d.ordem,
      obrigatoria: d.obrigatoria, repetivel: d.repetivel, maxOcorrencias: d.maxOcorrencias,
      modoExecucao: d.modoExecucao, executorKey: d.executorKey,
      dependeDe: d.dependeDe ?? [],
      visivel, disponivel, concluida, status,
      bloqueioCodigo, bloqueioAlvo, bloqueioTexto,
      execucao, ocorrencias,
      podeRepetir: d.repetivel && (d.maxOcorrencias == null || ocorrencias < d.maxOcorrencias),
      canais,
      definicao: d,
    })
  }

  return projetadas.sort((a, b) => a.ordem - b.ordem)
}

/**
 * O PASSO PODE CONCLUIR? — segundo a regra CADASTRADA, não segundo o código.
 *
 * `ACAO_DO_PASSO` é o padrão e é o que sempre valeu: quem conclui é a ação do passo, e
 * as subtarefas não travam nada. As outras duas regras existem porque um passo que se
 * decompõe em subtarefas obrigatórias não deveria poder ser dado por concluído com
 * elas em aberto — e antes não havia como declarar isso.
 */
export async function passoPodeConcluir(args: {
  stepInstanceId: number
  valores?: Record<string, unknown>
  fornecedorId?: number | null
}): Promise<{ pode: boolean; regra: string; faltando: Array<{ key: string; label: string; motivo: string }> }> {
  const hist = await definicaoHistoricaDoPasso(args.stepInstanceId)
  const regra = hist?.passo.regraDeConclusao ?? "ACAO_DO_PASSO"
  if (regra === "ACAO_DO_PASSO") return { pode: true, regra, faltando: [] }

  const subs = await subtarefasDaEtapa(args)
  if (subs.length === 0) return { pode: true, regra, faltando: [] }

  if (regra === "QUALQUER_SUBTAREFA") {
    const alguma = subs.some((s) => s.concluida)
    return {
      pode: alguma, regra,
      faltando: alguma ? [] : [{ key: "*", label: "Qualquer subtarefa", motivo: "Nenhuma subtarefa foi concluída ainda." }],
    }
  }

  // TODAS_SUBTAREFAS_OBRIGATORIAS — e "aplicável" importa: uma subtarefa cuja condição
  // de visibilidade é falsa não se aplica a este caso, e cobrar dela travaria o passo
  // para sempre. Invisível não é cumprida; é fora de escopo.
  const faltando = subs
    .filter((s) => s.obrigatoria && s.visivel && !s.concluida)
    .map((s) => ({
      key: s.key, label: s.label,
      motivo: s.bloqueioTexto ?? "Ainda não concluída.",
    }))
  return { pode: faltando.length === 0, regra, faltando }
}

/**
 * MATERIALIZA as execuções das subtarefas de um passo — uma por subtarefa, no estado
 * que a projeção calcula. IDEMPOTENTE: rodar de novo não cria a segunda.
 *
 * Existe porque a execução precisa existir para poder ser lida, atribuída e cobrada.
 * Sem ela, "quais subtarefas estão pendentes neste processo?" seria uma pergunta sem
 * tabela — respondível só recalculando a projeção de cada passo, um a um.
 */
export async function materializarSubtarefas(args: {
  stepInstanceId: number
  valores?: Record<string, unknown>
  fornecedorId?: number | null
}): Promise<{ criadas: number; jaExistiam: number }> {
  const { garantirExecucao } = await import("@/src/services/execucao-da-subtarefa")
  const subs = await subtarefasDaEtapa(args)
  const hist = await definicaoHistoricaDoPasso(args.stepInstanceId)
  // A TAREFA "A INICIAR" (mandato "motor de prazo/acompanhamento/cobrança",
  // 25/09/2026) — só busca se ALGUMA subtarefa vai precisar da data de
  // atribuição (a entrada, sem `dependeDe`, e sem acompanhamento PRÓPRIO
  // configurado): uma consulta a mais, nunca uma por subtarefa.
  const precisaDeAtribuicao = hist?.passo.diasParaIniciar != null
    && subs.some((s) => s.dependeDe.length === 0 && s.definicao.acompanhamentoAtivo !== true)
  const tarefaParaAIniciar = precisaDeAtribuicao
    ? await prisma.tarefa.findFirst({ where: { workflowStepInstanceId: args.stepInstanceId }, select: { dataAtribuicao: true, createdAt: true } })
    : null
  let criadas = 0
  let jaExistiam = 0
  for (const s of subs) {
    if (s.execucao) { jaExistiam++; continue }
    const agora = new Date()
    // O RELÓGIO DE ESPERA EXTERNA — só se aplica quando ela já nasce direto
    // AGUARDANDO_EXTERNO (esperaExternaAoLiberar, sem passar por DISPONIVEL).
    let previstoPara: Date | null = null
    let proximoAcompanhamentoEm: Date | null = null
    if (s.status === ESTADOS_DA_SUBTAREFA.AGUARDANDO_EXTERNO) {
      const dataGatilho = await dataDoGatilhoDaRegraTemporal(args.stepInstanceId, s.definicao.regraTemporalGatilhoChave, agora)
      const relogioExterno = relogioDeEsperaExternaDaSubtarefa({
        acompanhamentoAtivo: s.definicao.acompanhamentoAtivo,
        acompanhamentoPrimeiroDias: s.definicao.acompanhamentoPrimeiroDias,
        regraTemporalAtiva: s.definicao.regraTemporalAtiva,
        regraTemporalDias: s.definicao.regraTemporalDias,
        dataGatilhoRegraTemporal: dataGatilho,
        dataBase: agora,
      })
      previstoPara = relogioExterno.previstoPara
      proximoAcompanhamentoEm = relogioExterno.proximoAcompanhamentoEm
    } else if (s.dependeDe.length === 0 && s.definicao.acompanhamentoAtivo !== true && hist?.passo.diasParaIniciar != null) {
      // "A INICIAR" — a subtarefa de ENTRADA (sem dependência, ponto de
      // partida do passo) ainda não foi executada. Não é espera de
      // terceiro — é o operador que ainda não começou. Acompanhamento
      // próprio, a partir de QUANDO A TAREFA FOI ATRIBUÍDA (não da
      // liberação da subtarefa, que aqui coincide com a criação — "atribuir
      // e nunca abrir" é o caso que este relógio existe para pegar; sem
      // responsável ainda, cai para a criação, honesto em vez de inventado).
      const base = tarefaParaAIniciar?.dataAtribuicao ?? tarefaParaAIniciar?.createdAt ?? agora
      proximoAcompanhamentoEm = prazoOperacional(hist.passo.diasParaIniciar, base)
    }
    await garantirExecucao({
      stepInstanceId: args.stepInstanceId,
      subtaskKey: s.key,
      workflowVersao: hist?.versao ?? null,
      status: s.status,
      bloqueioCodigo: s.bloqueioCodigo,
      bloqueioAlvo: s.bloqueioAlvo,
      previstoPara,
      proximoAcompanhamentoEm,
    })
    criadas++
  }
  // A subtarefa CORRENTE já pode nascer definindo o prazo da Tarefa (ex.:
  // um cadastro futuro em que a subtarefa de entrada já é ela) — mesmo
  // guard idempotente de `aplicarPrazoDaTarefaSeConfigurado`.
  await aplicarPrazoDaTarefaSeConfigurado(args)
  return { criadas, jaExistiam }
}

/**
 * RECONCILIA o estado das execuções com o que a projeção calcula agora.
 *
 * Concluir A muda o estado de B e C, que dependiam dela. Sem isto, elas continuariam
 * BLOQUEADO no banco enquanto a projeção já as considera disponíveis — e as duas
 * respostas divergiriam. IDEMPOTENTE: só escreve o que mudou, e rodar vinte vezes
 * produz o mesmo resultado de rodar uma.
 *
 * NÃO toca em execução concluída, cancelada ou invalidada: o que já aconteceu é fato,
 * e reconciliar não é reabrir.
 */
export async function reconciliarSubtarefas(args: {
  stepInstanceId: number
  valores?: Record<string, unknown>
  fornecedorId?: number | null
}): Promise<{ ajustadas: number }> {
  const { registrarNaExecucao } = await import("@/src/services/execucao-da-subtarefa")
  const subs = await subtarefasDaEtapa(args)
  const IMUTAVEIS = new Set<string>([
    ESTADOS_DA_SUBTAREFA.CONCLUIDO, ESTADOS_DA_SUBTAREFA.CANCELADO,
    ESTADOS_DA_SUBTAREFA.INVALIDADO, ESTADOS_DA_SUBTAREFA.EM_ANDAMENTO,
    ESTADOS_DA_SUBTAREFA.AGUARDANDO_EXTERNO,
  ])
  let ajustadas = 0
  for (const s of subs) {
    if (!s.execucao) continue
    if (IMUTAVEIS.has(s.execucao.status)) continue
    const alvo = s.bloqueioCodigo ? ESTADOS_DA_SUBTAREFA.BLOQUEADO : ESTADOS_DA_SUBTAREFA.DISPONIVEL
    const mesmoEstado = s.execucao.status === alvo
    const mesmaCausa = (s.execucao.bloqueioCodigo ?? null) === (s.bloqueioCodigo ?? null)
      && (s.execucao.bloqueioAlvo ?? null) === (s.bloqueioAlvo ?? null)
    if (mesmoEstado && mesmaCausa) continue
    await registrarNaExecucao(args.stepInstanceId, s.key, {
      status: alvo, bloqueioCodigo: s.bloqueioCodigo, bloqueioAlvo: s.bloqueioAlvo,
    })
    ajustadas++
  }
  return { ajustadas }
}

/**
 * ESPERA EXTERNA AUTOMÁTICA NO NÍVEL DA SUBTAREFA — mesma régua de
 * `aplicarEsperaExternaSeConfigurado` (task-step-sync.ts), um nível abaixo, e
 * reaproveitando o MESMO efeito de Tarefa que a espera manual já usa. Não é um
 * motor novo: é a mesma transição (`bloquearTarefa` com
 * `motivoCodigo: "AGUARDANDO_TERCEIRO"`) que `PAUSE_FOR_EXTERNAL_WAIT` já
 * dispara quando o operador clica "ainda aguardando" — aqui ela dispara
 * sozinha, porque o cadastro da subtarefa (`esperaExternaAoLiberar`) diz que
 * ela É espera, por definição, desde o instante em que fica corrente.
 *
 * CORRENTE = a primeira subtarefa, na ordem, ainda não concluída e sem
 * bloqueio de dependência/condição — a mesma noção que `subtarefasDaEtapa` já
 * usa para decidir "disponível".
 *
 * IDEMPOTENTE: se a subtarefa já foi tratada (execução com progresso real —
 * EM_ANDAMENTO, CONCLUIDO, CANCELADO, INVALIDADO ou já AGUARDANDO_EXTERNO),
 * não faz nada. Chamar de novo depois de já ter aplicado é um no-op.
 *
 * ACHADO REAL (23/09/2026): `materializarSubtarefas` cria a execução de TODA
 * subtarefa antecipadamente — inclusive das ainda BLOQUEADAS por dependência
 * (ver seu próprio comentário). Isso significa que, no instante em que uma
 * subtarefa de espera externa deixa de estar bloqueada e vira corrente, ela
 * JÁ TEM uma linha de execução (criada lá atrás, em BLOQUEADO) — e todo
 * cadastro real de `esperaExternaAoLiberar` em produção depende de outra
 * subtarefa (`dependeDe` não-vazio; nenhum é ponto de entrada). Tratar
 * qualquer execução existente como "já tratada" travava a espera automática
 * para sempre nesses casos: `reconciliarSubtarefas` a movia para DISPONIVEL e
 * esta função nunca mais a alcançava. BLOQUEADO/DISPONIVEL são placeholders
 * sem progresso real — só EM_ANDAMENTO/CONCLUIDO/CANCELADO/INVALIDADO/
 * AGUARDANDO_EXTERNO (o que esta função grava) contam como "já tratada".
 */
export async function aplicarEsperaExternaDaSubtarefaSeConfigurado(args: {
  stepInstanceId: number
  valores?: Record<string, unknown>
  fornecedorId?: number | null
}): Promise<{ aplicado: boolean }> {
  const subs = await subtarefasDaEtapa(args)
  const corrente = subs.find((s) => !s.concluida && s.bloqueioCodigo === null)
  if (!corrente) return { aplicado: false }
  const PLACEHOLDER = new Set<string>([ESTADOS_DA_SUBTAREFA.DISPONIVEL, ESTADOS_DA_SUBTAREFA.BLOQUEADO])
  if (corrente.execucao && !PLACEHOLDER.has(corrente.execucao.status)) return { aplicado: false }
  if (corrente.definicao.esperaExternaAoLiberar !== true) return { aplicado: false }

  const tarefa = await prisma.tarefa.findFirst({
    where: { workflowStepInstanceId: args.stepInstanceId },
    select: { id: true },
  })
  if (!tarefa) return { aplicado: false }

  const { garantirExecucao, registrarNaExecucao } = await import("@/src/services/execucao-da-subtarefa")
  const hist = await definicaoHistoricaDoPasso(args.stepInstanceId)
  const agora = new Date()
  // OS DOIS RELÓGIOS DA ESPERA (mandato "correção definitiva do modelo
  // temporal", 19-20/09/2026) — acompanhamento e regra temporal, cada um só
  // se o cadastro da subtarefa ligar o respectivo interruptor. NUNCA
  // `slaDays` aqui: essa espera nunca teve "prazo" próprio dela — o que ela
  // tem é cadência de acompanhamento e/ou limite de terceiro, campos
  // próprios (`acompanhamentoAtivo`/`regraTemporalAtiva`), nunca uma
  // realocação de significado de `slaDays`.
  const dataGatilho = await dataDoGatilhoDaRegraTemporal(
    args.stepInstanceId, corrente.definicao.regraTemporalGatilhoChave, agora,
  )
  const relogio = relogioDeEsperaExternaDaSubtarefa({
    acompanhamentoAtivo: corrente.definicao.acompanhamentoAtivo,
    acompanhamentoPrimeiroDias: corrente.definicao.acompanhamentoPrimeiroDias,
    regraTemporalAtiva: corrente.definicao.regraTemporalAtiva,
    regraTemporalDias: corrente.definicao.regraTemporalDias,
    dataGatilhoRegraTemporal: dataGatilho,
    dataBase: agora,
  })
  // A execução pode já existir como placeholder (BLOQUEADO/DISPONIVEL, criada
  // antecipadamente por `materializarSubtarefas`) — nesse caso é UPDATE, não
  // criação; `garantirExecucao` seria um no-op sobre uma linha já vigente.
  if (corrente.execucao) {
    await registrarNaExecucao(args.stepInstanceId, corrente.key, {
      status: ESTADOS_DA_SUBTAREFA.AGUARDANDO_EXTERNO,
      previstoPara: relogio.previstoPara,
      proximoAcompanhamentoEm: relogio.proximoAcompanhamentoEm,
    })
  } else {
    await garantirExecucao({
      stepInstanceId: args.stepInstanceId,
      subtaskKey: corrente.key,
      workflowVersao: hist?.versao ?? null,
      status: ESTADOS_DA_SUBTAREFA.AGUARDANDO_EXTERNO,
      previstoPara: relogio.previstoPara,
      proximoAcompanhamentoEm: relogio.proximoAcompanhamentoEm,
    })
  }

  const { bloquearTarefa } = await import("@/src/services/task-step-sync")
  await bloquearTarefa(tarefa.id, {
    origem: "MOTOR",
    motivoCodigo: "AGUARDANDO_TERCEIRO",
    justificativa: `"${corrente.label}" liberada como dependência externa — aguardando o terceiro automaticamente.`,
  })
  return { aplicado: true }
}

/**
 * O PRAZO DA TAREFA NASCE NUMA SUBTAREFA (mandato "motor de prazo/
 * acompanhamento/cobrança", 25/09/2026) — mesma régua de
 * `aplicarEsperaExternaDaSubtarefaSeConfigurado`, um nível ao lado: quando a
 * subtarefa CORRENTE está marcada `definePrazoDaTarefa` no cadastro, e a
 * Tarefa ainda não tem `dataPrazo` (nasceu `null` de propósito — ver
 * `garantirTarefaDePasso`, que já verifica se ALGUMA subtarefa do passo
 * define prazo antes de decidir o valor inicial), grava
 * `dataPrazo = prazoOperacional(prazoDaTarefaDias, agora)` — em dias
 * CORRIDOS, a partir de AGORA (o instante em que esta subtarefa virou
 * corrente), nunca da criação da Tarefa.
 *
 * FICA FIXO DEPOIS: o guard `tarefa.dataPrazo != null` é o que impede
 * qualquer chamada seguinte (mesma subtarefa revisitada, outra subtarefa
 * também marcada por engano) de sobrescrever — `Tarefa.dataPrazo` continua
 * sendo o ÚNICO prazo oficial, nunca dois, nunca recalculado depois de
 * nascido.
 *
 * IDEMPOTENTE por construção: chamar de novo depois de já ter aplicado é
 * sempre um no-op (o guard acima).
 */
export async function aplicarPrazoDaTarefaSeConfigurado(args: {
  stepInstanceId: number
  valores?: Record<string, unknown>
  fornecedorId?: number | null
}): Promise<{ aplicado: boolean }> {
  const subs = await subtarefasDaEtapa(args)
  const corrente = subs.find((s) => !s.concluida && s.bloqueioCodigo === null)
  if (!corrente) return { aplicado: false }
  if (corrente.definicao.definePrazoDaTarefa !== true) return { aplicado: false }

  const tarefa = await prisma.tarefa.findFirst({
    where: { workflowStepInstanceId: args.stepInstanceId },
    select: { id: true, dataPrazo: true },
  })
  if (!tarefa || tarefa.dataPrazo != null) return { aplicado: false }

  const prazo = prazoOperacional(corrente.definicao.prazoDaTarefaDias, new Date())
  if (prazo == null) return { aplicado: false }

  await prisma.tarefa.update({ where: { id: tarefa.id }, data: { dataPrazo: prazo } })
  return { aplicado: true }
}

/**
 * O RESUMO SIMÉTRICO de `aplicarEsperaExternaDaSubtarefaSeConfigurado` —
 * achado real (19/09/2026, teste ponta-a-ponta do mandato "correção
 * definitiva do modelo temporal"): a espera automática BLOQUEIA a Tarefa
 * quando começa, mas nada a DESBLOQUEIA quando termina e a próxima subtarefa
 * é ação interna — ela ficava presa em AGUARDANDO_TERCEIRO para sempre,
 * mesmo com uma ação disponível esperando o responsável. `RESUME` (o efeito
 * manual) sempre existiu para o bloqueio MANUAL; a espera AUTOMÁTICA nunca
 * teve o par automático correspondente.
 *
 * NÃO é uma segunda régua: reaproveita `desbloquearTarefa` (a mesma porta do
 * efeito manual `RESUME`) e só age quando a Tarefa está bloqueada pelo
 * MOTIVO exato que este mecanismo grava (`motivoCodigo === "AGUARDANDO_TERCEIRO"`)
 * — nunca resume um bloqueio manual por outra razão, e nunca mexe numa
 * Tarefa que já não está em espera.
 *
 * CHAMAR SEMPRE DEPOIS de reconciliar: quem decide se ainda há espera é a
 * PROJEÇÃO inteira (alguma subtarefa em `AGUARDANDO_EXTERNO`?), nunca uma
 * dedução sobre o que esta chamada, isoladamente, acabou de mudar.
 */
export async function resumirTarefaSeEsperaSubtarefaEncerrada(args: {
  stepInstanceId: number
  valores?: Record<string, unknown>
  fornecedorId?: number | null
}): Promise<{ resumido: boolean }> {
  const subs = await subtarefasDaEtapa(args)
  const aindaEmEspera = subs.some((s) => s.status === ESTADOS_DA_SUBTAREFA.AGUARDANDO_EXTERNO)
  if (aindaEmEspera) return { resumido: false }

  const tarefa = await prisma.tarefa.findFirst({
    where: { workflowStepInstanceId: args.stepInstanceId },
    select: { id: true, statusTarefa: true, motivoCodigo: true },
  })
  if (!tarefa) return { resumido: false }
  const bloqueadaPelaEsperaAutomatica = tarefa.motivoCodigo === "AGUARDANDO_TERCEIRO"
    && (tarefa.statusTarefa === "BLOQUEADA" || tarefa.statusTarefa === "AGUARDANDO_TERCEIRO")
  if (!bloqueadaPelaEsperaAutomatica) return { resumido: false }

  const { desbloquearTarefa } = await import("@/src/services/task-step-sync")
  await desbloquearTarefa(tarefa.id, { origem: "MOTOR" })
  return { resumido: true }
}

/**
 * CONCLUI A SUBTAREFA CORRENTE — quando um caminho antigo (editor específico de
 * uma etapa, escrito antes de ela ganhar subtarefas) pede para concluir O PASSO
 * inteiro, mas o passo agora se decompõe em subtarefas.
 *
 * ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
 * "Solicitar certidão", "Aguardar retorno", "Receber certidão" e "Conferir e
 * validar" nasceram como QUATRO PASSOS separados, cada um com seu editor e sua
 * rota própria terminando em "conclua o passo". A consolidação (14-15/09/2026)
 * uniu os quatro numa TAREFA com um único Passo e quatro SUBTAREFAS — mas os
 * editores e rotas antigos continuaram pedindo para concluir o passo, porque é
 * só isso que eles sabem pedir. Sem esta ponte, `passoPodeConcluir` recusava
 * sempre (0 de 4 subtarefas feitas nunca é "pode"), e a recusa acontecia DEPOIS
 * de o operador já ter preenchido e enviado o formulário — que, numa
 * transação só com o resto do ato (ex.: `registrarSolicitacaoDocumento`),
 * desfazia até o que era válido. Achado real: 15/09/2026, testando o processo
 * Teste — a tela travava em qualquer envio, sempre.
 *
 * ─── O QUE ELA FAZ ───────────────────────────────────────────────────────────
 * NÃO sabe qual subtarefa é — não tem `executorKey` hardcoded em lugar nenhum.
 * Pega a CORRENTE (a mesma noção de `aplicarEsperaExternaDaSubtarefaSeConfigurado`:
 * a primeira, na ordem, ainda não concluída), grava a execução dela como
 * CONCLUIDO com o que o formulário antigo mandou, reconcilia as dependentes e
 * checa de novo se o PASSO já pode concluir. Só quando a resposta é "pode" é
 * que o chamador deve, ele mesmo, rodar a transição do passo — esta função não
 * conclui o passo.
 *
 * ─── FORA DE TRANSAÇÃO, DE PROPÓSITO ────────────────────────────────────────
 * As mesmas primitivas de `reconciliarSubtarefas`/`aplicarEsperaExternaDaSubtarefaSeConfigurado`
 * usam o prisma cru — chamar isto dentro do `tx` de quem pediu violaria a
 * invariante transação×conexão. Os chamadores (`atualizarPassoV2`,
 * `registrarSolicitacaoDocumento`) chamam isto DEPOIS que a própria transação
 * deles já comitou.
 */
export async function concluirSubtarefaCorrentePeloPasso(args: {
  stepInstanceId: number
  executadoPorId: number | null
  payload: Record<string, unknown>
  resultado?: string
  protocoloId?: number | null
  protocolo?: string | null
  canalKey?: string | null
  fornecedorId?: number | null
  valores?: Record<string, unknown>
  /**
   * QUAL subtarefa o CHAMADOR pretende concluir — quando informado, só
   * conclui de verdade se ela for de fato a CORRENTE agora. Achado real
   * 24/09/2026: sem isto, um reenvio tardio da MESMA chamada (rede
   * instável, duplo-clique, retry) que chegasse depois de a subtarefa já
   * ter fechado concluía a subtarefa SEGUINTE por engano — porque esta
   * porta só perguntava "qual é a corrente agora?", nunca "é esta que eu
   * pedi para fechar?". Sem o parâmetro (chamador antigo, sem essa
   * informação), o comportamento é o de sempre — nada muda.
   */
  subtarefaKeyEsperada?: string
}): Promise<
  | { aplicavel: false }
  | {
      aplicavel: true
      subtarefaKey: string
      /** true = nada foi gravado agora; a subtarefa ESPERADA já estava
       *  concluída antes desta chamada (retry idempotente) — nenhuma OUTRA
       *  subtarefa foi tocada. */
      jaEstavaConcluida?: true
      podeConcluirPasso: boolean
      faltando: Array<{ key: string; label: string; motivo: string }>
    }
> {
  const subs = await subtarefasDaEtapa({
    stepInstanceId: args.stepInstanceId, valores: args.valores, fornecedorId: args.fornecedorId,
  })
  const corrente = subs.find((s) => !s.concluida)

  if (args.subtarefaKeyEsperada && corrente?.key !== args.subtarefaKeyEsperada) {
    const esperada = subs.find((s) => s.key === args.subtarefaKeyEsperada)
    if (esperada?.concluida) {
      // Retry tardio de uma subtarefa que OUTRA chamada já fechou — sucesso
      // idempotente, sem tocar em nenhuma subtarefa diferente da pedida.
      const gate = await passoPodeConcluir({ stepInstanceId: args.stepInstanceId, valores: args.valores, fornecedorId: args.fornecedorId })
      return { aplicavel: true, subtarefaKey: esperada.key, jaEstavaConcluida: true, podeConcluirPasso: gate.pode, faltando: gate.faltando }
    }
    // Pediram para concluir uma subtarefa que NÃO é a corrente e não está
    // concluída — estado inconsistente (corrida entre duas abas, ordem
    // fora do esperado). Recusa: nunca conclui a subtarefa ERRADA no lugar
    // da pedida.
    return { aplicavel: false }
  }

  if (!corrente) return { aplicavel: false }

  const { garantirExecucao, registrarNaExecucao } = await import("@/src/services/execucao-da-subtarefa")
  const hist = await definicaoHistoricaDoPasso(args.stepInstanceId)
  await garantirExecucao({
    stepInstanceId: args.stepInstanceId, subtaskKey: corrente.key,
    workflowVersao: hist?.versao ?? null, status: ESTADOS_DA_SUBTAREFA.EM_ANDAMENTO,
  })
  await registrarNaExecucao(args.stepInstanceId, corrente.key, {
    status: ESTADOS_DA_SUBTAREFA.CONCLUIDO,
    resultado: args.resultado ?? "concluida",
    executadoPorId: args.executadoPorId,
    startedAt: new Date(),
    payload: args.payload as never,
    // ZERA A ESCALADA AO CONCLUIR — cobrança/escalada é sobre uma espera que
    // ainda está aberta; fechar a subtarefa encerra a espera, e uma escalada
    // pendurada numa subtarefa já concluída seria histórico falso (mesmo
    // raciocínio de `bloqueioCodigo` acima, para o par escalada/escaladaEm).
    escalada: false,
    escaladaEm: null,
    ...(args.canalKey ? { canalKey: args.canalKey } : {}),
    ...(args.protocoloId ? { protocoloId: args.protocoloId, protocolo: args.protocolo ?? null } : {}),
    ...(args.fornecedorId ? { fornecedorId: args.fornecedorId } : {}),
  })
  await reconciliarSubtarefas({ stepInstanceId: args.stepInstanceId, valores: args.valores, fornecedorId: args.fornecedorId })
  await aplicarEsperaExternaDaSubtarefaSeConfigurado({ stepInstanceId: args.stepInstanceId, valores: args.valores, fornecedorId: args.fornecedorId })
  await aplicarPrazoDaTarefaSeConfigurado({ stepInstanceId: args.stepInstanceId, valores: args.valores, fornecedorId: args.fornecedorId })
  const gate = await passoPodeConcluir({ stepInstanceId: args.stepInstanceId, valores: args.valores, fornecedorId: args.fornecedorId })
  return { aplicavel: true, subtarefaKey: corrente.key, podeConcluirPasso: gate.pode, faltando: gate.faltando }
}

/**
 * REGISTRA UMA COBRANÇA (contato ao terceiro) — Etapa 2, item 5.
 *
 * ContatoTerceiro é FATO HISTÓRICO append-only, nunca sobrescrito — cada
 * cobrança é uma linha própria, presa à EXECUÇÃO VIGENTE da subtarefa no
 * momento (não à subtarefa em abstrato: se ela for reaberta depois, a
 * cobrança antiga continua presa à tentativa antiga, correto).
 *
 * DOIS EFEITOS COLATERAIS, ambos vindos do CADASTRO do passo (nunca
 * hardcoded): reagenda `proximoAcompanhamentoEm` em
 * `PhaseInternalWorkflowStep.diasAposCobranca` dias corridos a partir de
 * agora (default 1), e liga `escalada` quando o total de cobranças desta
 * execução atinge `escalarApos` (default 2) — nunca desliga sozinha: só
 * `concluirSubtarefaCorrentePeloPasso` zera, porque só a conclusão da
 * subtarefa encerra de fato a espera que a escalada sinaliza.
 *
 * FORA DE TRANSAÇÃO, de propósito — mesma classe das outras primitivas
 * deste módulo (usa o prisma cru).
 */
export async function registrarCobranca(args: {
  stepInstanceId: number
  subtaskKey: string
  canal: string
  observacao?: string | null
  documentoId?: number | null
  orgaoId?: number | null
  registradoPorId?: number | null
}): Promise<
  | { ok: false; motivo: "SEM_EXECUCAO_VIGENTE" | "SEM_TAREFA" }
  | { ok: true; contatoId: number; totalContatos: number; escalada: boolean; proximoAcompanhamentoEm: Date | null }
> {
  const { execucaoVigente, registrarNaExecucao } = await import("@/src/services/execucao-da-subtarefa")
  const vigente = await execucaoVigente(args.stepInstanceId, args.subtaskKey)
  if (!vigente) return { ok: false, motivo: "SEM_EXECUCAO_VIGENTE" }

  const tarefa = await prisma.tarefa.findFirst({
    where: { workflowStepInstanceId: args.stepInstanceId }, select: { id: true },
  })
  if (!tarefa) return { ok: false, motivo: "SEM_TAREFA" }

  const hist = await definicaoHistoricaDoPasso(args.stepInstanceId)
  const diasAposCobranca = hist?.passo.diasAposCobranca ?? 1
  const escalarApos = hist?.passo.escalarApos ?? 2

  const contato = await prisma.contatoTerceiro.create({
    data: {
      subtaskExecutionId: vigente.id,
      tarefaId: tarefa.id,
      documentoId: args.documentoId ?? null,
      orgaoId: args.orgaoId ?? null,
      canal: args.canal,
      observacao: args.observacao ?? null,
      registradoPorId: args.registradoPorId ?? null,
    },
  })

  const totalContatos = await prisma.contatoTerceiro.count({ where: { subtaskExecutionId: vigente.id } })
  const escalada = totalContatos >= escalarApos
  const proximoAcompanhamentoEm = prazoOperacional(diasAposCobranca, new Date())

  await registrarNaExecucao(args.stepInstanceId, args.subtaskKey, {
    proximoAcompanhamentoEm,
    escalada,
    escaladaEm: escalada ? (vigente.escaladaEm ?? new Date()) : vigente.escaladaEm,
  })

  return { ok: true, contatoId: contato.id, totalContatos, escalada, proximoAcompanhamentoEm }
}

/** Os três estados operacionais que a tela agrupa — nunca um `statusTarefa` novo. */
export const ESTADOS_DE_OPERACAO = { FILA: "FILA", AGUARDANDO: "AGUARDANDO", CONCLUIDA: "CONCLUIDA" } as const
export type EstadoDeOperacao = (typeof ESTADOS_DE_OPERACAO)[keyof typeof ESTADOS_DE_OPERACAO]

/**
 * ESTADO OPERACIONAL DA TAREFA — Etapa 2, fechamento (26/09/2026): a
 * PROJEÇÃO de três estados que a tela de operação agrupa (fila do operador /
 * esperando terceiro / encerrada), derivada da SUBTAREFA CORRENTE — nunca um
 * `statusTarefa` novo, nunca uma segunda régua de conclusão.
 *
 * REGRA (a mesma em qualquer passo, sem lista de stepKey hardcoded):
 *   • Tarefa concluída → CONCLUIDA. Ponto final, nunca reavaliado.
 *   • Sem motor de subtarefas para este passo (nenhuma cadastrada, ou a
 *     tarefa nem tem `stepInstance` — ex.: Genealogia, fases sem
 *     decomposição em subtarefas) → FILA: não há espera embutida no passo
 *     em si, a ação sempre foi do operador.
 *   • Subtarefa corrente em ESPERA DE TERCEIRO (`AGUARDANDO_EXTERNO`) →
 *     AGUARDANDO. `prazoTarefaEm` acompanha o prazo OFICIAL da Tarefa
 *     (`dataPrazo`) sempre que ele já nasceu — nunca inventa um segundo
 *     prazo por subtarefa (decisão definitiva 23/09/2026).
 *   • Qualquer outro estado da corrente (disponível, em andamento, bloqueada
 *     por dependência) → FILA: existe uma ação para o operador considerar,
 *     mesmo que ele ainda não possa executá-la agora.
 *
 * `aIniciar` — true SÓ quando a corrente é o PONTO DE ENTRADA do passo (sem
 * `dependeDe`) e ainda não foi tocada (sem execução, ou execução sem
 * `startedAt`) — o mesmo par que `materializarSubtarefas` usa para decidir
 * o acompanhamento "a iniciar" (`diasParaIniciar`), aqui como rótulo pra tela.
 */
/** Os dois status TERMINAIS DE CONCLUSÃO da Tarefa — mesmo vocabulário de `tarefa-canonica.ts`, nunca uma string solta "CONCLUIDA". */
const STATUS_CONCLUIDOS = new Set(["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI"])

export async function estadoOperacaoDaTarefa(args: {
  stepInstanceId: number | null
  statusTarefa: string
  dataPrazo: Date | null
}): Promise<{ estado: EstadoDeOperacao; aIniciar: boolean; prazoTarefaEm: Date | null }> {
  if (STATUS_CONCLUIDOS.has(args.statusTarefa)) {
    return { estado: ESTADOS_DE_OPERACAO.CONCLUIDA, aIniciar: false, prazoTarefaEm: args.dataPrazo }
  }
  if (args.stepInstanceId == null) {
    return { estado: ESTADOS_DE_OPERACAO.FILA, aIniciar: false, prazoTarefaEm: args.dataPrazo }
  }

  const subs = await subtarefasDaEtapa({ stepInstanceId: args.stepInstanceId })
  // MESMA NOÇÃO DE "CORRENTE" que `concluirSubtarefaCorrentePeloPasso` já usa
  // (a primeira, na ordem, ainda não concluída) — nunca uma segunda conta.
  const corrente = subs.find((s) => !s.concluida)
  if (!corrente) {
    // Sem subtarefa cadastrada para este passo (motor de subtarefas não se
    // aplica) — o passo comum sempre foi FILA.
    return { estado: ESTADOS_DE_OPERACAO.FILA, aIniciar: false, prazoTarefaEm: args.dataPrazo }
  }
  if (corrente.status === ESTADOS_DA_SUBTAREFA.AGUARDANDO_EXTERNO) {
    return { estado: ESTADOS_DE_OPERACAO.AGUARDANDO, aIniciar: false, prazoTarefaEm: args.dataPrazo }
  }
  const éPontoDeEntrada = (corrente.dependeDe ?? []).length === 0
  const aindaNaoFoiTocada = corrente.execucao == null || corrente.execucao.startedAt == null
  return {
    estado: ESTADOS_DE_OPERACAO.FILA,
    aIniciar: éPontoDeEntrada && aindaNaoFoiTocada,
    prazoTarefaEm: args.dataPrazo,
  }
}

/**
 * A SUBTAREFA CORRENTE DE UMA TAREFA — resolve `stepInstanceId`+`subtaskKey`
 * a partir do `tarefaId`, para as portas da Operação (`/api/operacao/tarefas/
 * [id]/cobrar`, `.../adiar-acompanhamento`) que recebem o id da TAREFA, nunca
 * o do step instance (a tela de Operação não conhece esse id interno).
 */
export async function subtarefaCorrenteDaTarefa(
  tarefaId: number,
): Promise<{ stepInstanceId: number; subtaskKey: string } | null> {
  const tarefa = await prisma.tarefa.findUnique({
    where: { id: tarefaId },
    select: { workflowStepInstanceId: true },
  })
  if (!tarefa?.workflowStepInstanceId) return null
  const subs = await subtarefasDaEtapa({ stepInstanceId: tarefa.workflowStepInstanceId })
  const corrente = subs.find((s) => !s.concluida)
  if (!corrente) return null
  return { stepInstanceId: tarefa.workflowStepInstanceId, subtaskKey: corrente.key }
}

/**
 * ADIA O ACOMPANHAMENTO — Etapa 3 (tela Operação v3, 26/09/2026): "Adiar +3
 * dias" do protótipo. NUNCA mexe no prazo oficial da Tarefa (dimensão A) nem
 * na regra temporal do terceiro (dimensão C) — só na dimensão D
 * (`proximoAcompanhamentoEm`), a mesma que `registrarCobranca` também move.
 *
 * Motivo é OBRIGATÓRIO (parâmetro não-opcional) — vira `LogAuditoria`, mesmo
 * padrão de `reabrirSubtarefa`: adiar sem dizer por quê esconde de quem for
 * auditar depois por que o despertador não tocou na data que deveria.
 *
 * FORA DE TRANSAÇÃO, de propósito — mesma classe das outras primitivas.
 */
export async function adiarAcompanhamento(args: {
  stepInstanceId: number
  subtaskKey: string
  motivo: string
  dias?: number
  registradoPorId?: number | null
}): Promise<
  | { ok: false; motivo: "SEM_EXECUCAO_VIGENTE" | "SEM_ACOMPANHAMENTO_ATIVO" }
  | { ok: true; proximoAcompanhamentoEm: Date }
> {
  const { execucaoVigente, registrarNaExecucao } = await import("@/src/services/execucao-da-subtarefa")
  const vigente = await execucaoVigente(args.stepInstanceId, args.subtaskKey)
  if (!vigente) return { ok: false, motivo: "SEM_EXECUCAO_VIGENTE" }
  if (!vigente.proximoAcompanhamentoEm) return { ok: false, motivo: "SEM_ACOMPANHAMENTO_ATIVO" }

  const dias = args.dias ?? 3
  const novaData = prazoOperacional(dias, vigente.proximoAcompanhamentoEm)
  if (novaData == null) return { ok: false, motivo: "SEM_ACOMPANHAMENTO_ATIVO" }

  await registrarNaExecucao(args.stepInstanceId, args.subtaskKey, { proximoAcompanhamentoEm: novaData })
  await prisma.logAuditoria.create({
    data: {
      acao: "ACOMPANHAMENTO_ADIADO",
      entidade: "SubtaskExecution",
      entidadeId: vigente.id,
      usuarioId: args.registradoPorId ?? null,
      descricao: `Acompanhamento de "${args.subtaskKey}" (passo ${args.stepInstanceId}) adiado ${dias} dia(s): ${args.motivo}`,
      detalhes: { stepInstanceId: args.stepInstanceId, subtaskKey: args.subtaskKey, dias, novaData } as never,
    },
  }).catch(() => null)

  return { ok: true, proximoAcompanhamentoEm: novaData }
}

/** O histórico de cobranças da subtarefa — todas as execuções (vigente e substituídas). */
export async function historicoDeCobrancasDaSubtarefa(stepInstanceId: number, subtaskKey: string) {
  const { execucoesDaSubtarefa } = await import("@/src/services/execucao-da-subtarefa")
  const execucoes = await execucoesDaSubtarefa(stepInstanceId, subtaskKey)
  const ids = execucoes.map((e) => e.id)
  if (ids.length === 0) return []
  return prisma.contatoTerceiro.findMany({
    where: { subtaskExecutionId: { in: ids } },
    orderBy: { registradoEm: "asc" },
    include: { registradoPor: { select: { id: true, nome: true } } },
  })
}

/** Só para a tela: o texto do que falta, sem repetir a conta. */
export function textoDoQueFalta(faltando: Array<{ label: string; motivo: string }>): string {
  if (faltando.length === 0) return ""
  if (faltando.length === 1) return `Falta: ${faltando[0].label} — ${faltando[0].motivo}`
  return `Faltam ${faltando.length}: ${faltando.map((f) => f.label).join(", ")}.`
}

export { vazio as valorVazio }

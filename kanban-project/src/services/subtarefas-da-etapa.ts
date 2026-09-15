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
import { canaisDaSubtarefa, type CanalDisponivel } from "@/src/lib/motor/canais-do-fornecedor"

export interface SubtarefaProjetada {
  key: string
  label: string
  descricao: string | null
  ordem: number
  obrigatoria: boolean
  repetivel: boolean
  maxOcorrencias: number | null
  modoExecucao: string
  slaDays: number | null
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
    let canais: CanalDisponivel[] = []
    if (d.fonteDeCanais !== "NENHUMA") {
      if (!args.fornecedorId) {
        if (!bloqueioCodigo) {
          bloqueioCodigo = CAUSAS_DE_BLOQUEIO.FORNECEDOR_AUSENTE
          bloqueioTexto = "Falta definir o órgão/fornecedor deste documento — sem ele não há por onde enviar."
        }
      } else {
        canais = await canaisDaSubtarefa({
          fonteDeCanais: d.fonteDeCanais,
          tiposPermitidos: d.tiposDeCanal,
          fornecedorId: args.fornecedorId,
        })
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
      modoExecucao: d.modoExecucao, slaDays: d.slaDays, executorKey: d.executorKey,
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
  let criadas = 0
  let jaExistiam = 0
  for (const s of subs) {
    if (s.execucao) { jaExistiam++; continue }
    await garantirExecucao({
      stepInstanceId: args.stepInstanceId,
      subtaskKey: s.key,
      workflowVersao: hist?.versao ?? null,
      status: s.status,
      bloqueioCodigo: s.bloqueioCodigo,
      bloqueioAlvo: s.bloqueioAlvo,
    })
    criadas++
  }
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
 * IDEMPOTENTE: se a subtarefa já tem execução (já foi tratada, manual ou
 * automaticamente), não faz nada. Chamar de novo depois de já ter aplicado é
 * um no-op.
 */
export async function aplicarEsperaExternaDaSubtarefaSeConfigurado(args: {
  stepInstanceId: number
  valores?: Record<string, unknown>
  fornecedorId?: number | null
}): Promise<{ aplicado: boolean }> {
  const subs = await subtarefasDaEtapa(args)
  const corrente = subs.find((s) => !s.concluida && s.bloqueioCodigo === null)
  if (!corrente || corrente.execucao) return { aplicado: false }
  if (corrente.definicao.esperaExternaAoLiberar !== true) return { aplicado: false }

  const tarefa = await prisma.tarefa.findFirst({
    where: { workflowStepInstanceId: args.stepInstanceId },
    select: { id: true },
  })
  if (!tarefa) return { aplicado: false }

  const { garantirExecucao } = await import("@/src/services/execucao-da-subtarefa")
  await garantirExecucao({
    stepInstanceId: args.stepInstanceId,
    subtaskKey: corrente.key,
    workflowVersao: (await definicaoHistoricaDoPasso(args.stepInstanceId))?.versao ?? null,
    status: ESTADOS_DA_SUBTAREFA.AGUARDANDO_EXTERNO,
  })

  const { bloquearTarefa } = await import("@/src/services/task-step-sync")
  await bloquearTarefa(tarefa.id, {
    origem: "MOTOR",
    motivoCodigo: "AGUARDANDO_TERCEIRO",
    justificativa: `"${corrente.label}" liberada como dependência externa — aguardando o terceiro automaticamente.`,
  })
  return { aplicado: true }
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
}): Promise<
  | { aplicavel: false }
  | {
      aplicavel: true
      subtarefaKey: string
      podeConcluirPasso: boolean
      faltando: Array<{ key: string; label: string; motivo: string }>
    }
> {
  const subs = await subtarefasDaEtapa({
    stepInstanceId: args.stepInstanceId, valores: args.valores, fornecedorId: args.fornecedorId,
  })
  const corrente = subs.find((s) => !s.concluida)
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
    ...(args.canalKey ? { canalKey: args.canalKey } : {}),
    ...(args.protocoloId ? { protocoloId: args.protocoloId, protocolo: args.protocolo ?? null } : {}),
    ...(args.fornecedorId ? { fornecedorId: args.fornecedorId } : {}),
  })
  await reconciliarSubtarefas({ stepInstanceId: args.stepInstanceId, valores: args.valores, fornecedorId: args.fornecedorId })
  await aplicarEsperaExternaDaSubtarefaSeConfigurado({ stepInstanceId: args.stepInstanceId, valores: args.valores, fornecedorId: args.fornecedorId })
  const gate = await passoPodeConcluir({ stepInstanceId: args.stepInstanceId, valores: args.valores, fornecedorId: args.fornecedorId })
  return { aplicavel: true, subtarefaKey: corrente.key, podeConcluirPasso: gate.pode, faltando: gate.faltando }
}

/** Só para a tela: o texto do que falta, sem repetir a conta. */
export function textoDoQueFalta(faltando: Array<{ label: string; motivo: string }>): string {
  if (faltando.length === 0) return ""
  if (faltando.length === 1) return `Falta: ${faltando[0].label} — ${faltando[0].motivo}`
  return `Faltam ${faltando.length}: ${faltando.map((f) => f.label).join(", ")}.`
}

export { vazio as valorVazio }

// src/lib/motor/reconciliar-fase-macro.ts
// ============================================================================
// RECONCILIAÇÃO RETROATIVA DO CATÁLOGO DE FASES — mandato "Catálogo de Fases"
// (20/09/2026), REGRA MASTER: publicar uma fase nova nunca exige excluir,
// recriar, clonar ou reconstruir processo nenhum. Toda configuração publicada
// alcança os processos em andamento aplicáveis, incremental e idempotente.
//
// DUAS PEÇAS, DUAS RESPONSABILIDADES:
//
//   1) enqueueReconciliacaoFaseMacro — chamada DENTRO da mesma operação que
//      publica a composição do Workflow Macro (PUT /api/gerenciamento/
//      workflow-macro/[id]). Não materializa nada: só REGISTRA o trabalho, um
//      DomainOutbox por (processo em andamento × fase nova), com chave de
//      idempotência determinística. Publicar não pode depender de processar
//      milhares de processos dentro da mesma requisição HTTP — aqui só se
//      enfileira.
//
//   2) processarReconciliacaoFaseMacro — o EFEITO, chamado pelo
//      outbox-dispatcher (tipo "fase.macro.reconciliar"), um processo por vez.
//      Não usa materializador novo: chama `materializarExecucaoDaFase` — o
//      MESMO serviço canônico único que já materializa avanço, reabertura,
//      movimentação manual e regularização histórica. Isso é o que garante,
//      de graça, as invariantes que a REGRA MASTER exige: idempotente (rodar
//      de novo sobre o mesmo processo+fase não duplica instância nem tarefa),
//      nunca move `Processo.faseAtualKey`, nunca toca ciclo/instância de outra
//      fase, e relata SEM_ALVO_APLICAVEL com motivo nomeado quando a fase é
//      condicional e não se aplica — nunca cria uma pendência fantasma.
//
// A terceira peça — bloquear a FINALIZAÇÃO enquanto uma obrigação retroativa
// segue pendente — é `calcularObrigacoesRetroativasPendentes`, consumida por
// `phase-advance.ts` especificamente na transição para `finalizado`.
//
// A QUARTA peça — mandato "regra única de prazo" (23/09/2026), item "mudança
// precisa valer para processos em andamento" — é
// enqueueReconciliacaoWorkflowInternoFaseAtual/processarReconciliacaoWorkflowInternoFaseAtual,
// perto do fim deste arquivo: alcança especificamente quem está NA fase atual
// com a instância JÁ ABERTA (as três peças acima, por desenho, pulam esse
// caso — ver o comentário de `origem === "WORKFLOW_INTERNO"` logo abaixo,
// que documenta por que reconciliar por cima de quem já materializou
// duplicava PhaseWorkflowInstance/Tarefa em produção).
// ============================================================================

import { prisma } from "@/lib/prisma"
import type { Prisma, WorkflowInstanceStatus } from "@prisma/client"
import { materializarExecucaoDaFase } from "@/src/services/materializar-fase"
import { reconciliarNovaVersaoNaInstanciaAtual } from "@/src/services/phase-workflow"
import { garantirTarefaDePasso, carregarPreCondicoes } from "@/src/services/passo-tarefa"

export const TIPO_OUTBOX_RECONCILIACAO_FASE_MACRO = "fase.macro.reconciliar"
export const TIPO_OUTBOX_RECONCILIACAO_CATALOGO_FASE = "catalogo.fase.reconciliar"
export const TIPO_OUTBOX_RECONCILIACAO_WORKFLOW_INTERNO_FASE_ATUAL = "workflow-interno.fase-atual.reconciliar"

// NÃO importa `proximoCiclo` de phase-advance.ts de propósito — phase-advance.ts
// já importa DESTE arquivo (calcularObrigacoesRetroativasPendentes); importar de
// volta criaria um ciclo de módulos (mesma classe de bug do TDZ já corrigido em
// outbox-dispatcher.ts nesta mesma rodada). Cálculo de 3 linhas, duplicado de
// propósito em vez de arriscar o ciclo.
async function proximoCicloLocal(processoId: number, faseMacroKey: string): Promise<number> {
  const ultima = await prisma.phaseWorkflowInstance.findFirst({
    where: { processoId, faseMacroKey },
    orderBy: { ciclo: "desc" }, select: { ciclo: true },
  })
  return (ultima?.ciclo ?? 0) + 1
}

export interface FaseNovaParaReconciliar {
  phaseKey: string
  required: boolean
  conditional: boolean
}

interface EnqueueInput {
  macroWorkflowId: number
  tipoProcessoId: number
  versaoAnterior: number
  versaoNova: number
  fasesNovas: FaseNovaParaReconciliar[]
  publicadoPorId: number | null
  correlationId?: string
}

export interface EnqueueResultado {
  processosAlcancados: number
  outboxRegistrados: number
  fasesConsideradas: string[]
}

/**
 * "Em andamento" = tem fase operacional de referência e não está FINALIZADO.
 *
 * `dataConclusao: null` é o campo CANÔNICO de encerramento (setado
 * atomicamente por `executarPlano`, phase-advance.ts, ao entrar na fase
 * terminal DA COMPOSIÇÃO — nunca por nome/chave) — é ele quem decide,
 * nunca a string da chave. `faseAtualKey !== "finalizado"` fica como reforço
 * defensivo para dado legado que possa ter chegado à fase terminal antes
 * desta escrita atômica existir (achado real, mandato "Módulo de Fases",
 * 21/09/2026).
 */
async function processosEmAndamento(tipoProcessoId: number): Promise<number[]> {
  const rows = await prisma.processo.findMany({
    where: {
      tipoProcessoMotorId: tipoProcessoId,
      faseAtualKey: { not: null, notIn: ["finalizado"] },
      dataConclusao: null,
    },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

/**
 * REGISTRA o trabalho de reconciliação — não o executa. Só fases OBRIGATÓRIAS
 * (required && !conditional) geram trabalho automático: uma fase condicional
 * nova só se materializa quando a condição de aplicabilidade dela mandar, e
 * isso é decidido por `materializarExecucaoDaFase`/`instanciarWorkflowDaFase`
 * no momento em que a fase é alcançada — não por esta fila.
 *
 * IDEMPOTENTE: a chave é `{tipo}::{processoId}::{phaseKey}::v{versaoNova}` —
 * publicar duas vezes a mesma versão, ou rodar este enqueue de novo por
 * qualquer motivo, não duplica outbox (skipDuplicates na constraint única de
 * `DomainOutbox.chaveIdempotencia`).
 */
export async function enqueueReconciliacaoFaseMacro(input: EnqueueInput): Promise<EnqueueResultado> {
  const fasesObrigatorias = input.fasesNovas.filter((f) => f.required && !f.conditional)
  if (fasesObrigatorias.length === 0) {
    return { processosAlcancados: 0, outboxRegistrados: 0, fasesConsideradas: [] }
  }

  const processoIds = await processosEmAndamento(input.tipoProcessoId)
  if (processoIds.length === 0) {
    return { processosAlcancados: 0, outboxRegistrados: 0, fasesConsideradas: fasesObrigatorias.map((f) => f.phaseKey) }
  }

  const linhas: Prisma.DomainOutboxCreateManyInput[] = []
  for (const processoId of processoIds) {
    for (const fase of fasesObrigatorias) {
      linhas.push({
        tipo: TIPO_OUTBOX_RECONCILIACAO_FASE_MACRO,
        aggregateType: "Processo",
        aggregateId: processoId,
        payload: {
          processoId, phaseKey: fase.phaseKey, macroWorkflowId: input.macroWorkflowId,
          tipoProcessoId: input.tipoProcessoId, versaoAnterior: input.versaoAnterior,
          versaoNova: input.versaoNova, publicadoPorId: input.publicadoPorId,
        },
        correlationId: input.correlationId ?? null,
        chaveIdempotencia: `${TIPO_OUTBOX_RECONCILIACAO_FASE_MACRO}::${processoId}::${fase.phaseKey}::v${input.versaoNova}`,
        status: "PENDENTE",
      })
    }
  }

  const resultado = await prisma.domainOutbox.createMany({ data: linhas, skipDuplicates: true })
  return {
    processosAlcancados: processoIds.length,
    outboxRegistrados: resultado.count,
    fasesConsideradas: fasesObrigatorias.map((f) => f.phaseKey),
  }
}

export interface ReconciliacaoFaseMacroPayload {
  processoId: number
  phaseKey: string
  versaoNova?: number
  /** Mudança de ESCOPO (cardinalidade) — exige o caminho seguro de ciclo novo
   *  (ver processarReconciliacaoEscopoDeFase). Ausente/false = caminho comum. */
  escopoMudou?: boolean
  /** Só para o histórico dizer QUE publicação disparou este evento. */
  origem?: string
}

/**
 * O EFEITO — chamado pelo outbox-dispatcher, um DomainOutbox por vez. Falha
 * num processo PROPAGA (o outbox devolve o evento a PENDENTE e reprocessa) e
 * NÃO afeta os outros — cada processo tem sua própria linha.
 */
export async function processarReconciliacaoFaseMacro(
  payload: ReconciliacaoFaseMacroPayload,
  correlationId?: string,
): Promise<void> {
  if (!payload.processoId || !payload.phaseKey) return

  if (payload.escopoMudou === true) {
    await processarReconciliacaoEscopoDeFase(payload, correlationId)
    return
  }

  const relatorio = await materializarExecucaoDaFase({
    processoId: payload.processoId,
    faseMacroKey: payload.phaseKey,
    fonte: "RECONCILIACAO",
    correlationId,
  })

  // Bookkeeping — NUNCA decide comportamento, só registra "até onde este
  // processo já foi alcançado pela publicação". Preservado mesmo quando a
  // fase não materializa nada (SEM_ALVO_APLICAVEL é um resultado válido).
  if (payload.versaoNova != null) {
    await prisma.processo.update({
      where: { id: payload.processoId },
      data: { macroWorkflowVersion: payload.versaoNova },
    }).catch(() => null)
  }

  await prisma.logAuditoria.create({
    data: {
      acao: "RECONCILIACAO_FASE_MACRO",
      entidade: "PROCESSO",
      entidadeId: payload.processoId,
      descricao: `Reconciliação da fase "${payload.phaseKey}" (${payload.origem === "WORKFLOW_INTERNO" ? "publicação de Workflow Interno" : "publicação de Workflow Macro"}) — ${relatorio.estado}.`,
      detalhes: {
        phaseKey: payload.phaseKey, estado: relatorio.estado, passosCriados: relatorio.passosCriados,
        tarefasCriadas: relatorio.tarefasCriadas,
        motivos: relatorio.motivos.map((m) => ({ code: m.code, message: m.message })),
        correlationId: relatorio.correlationId,
        origem: payload.origem ?? null,
      } as Prisma.InputJsonValue,
    },
  }).catch(() => null)
}

// Estados que representam trabalho/posição REAL do processo nessa fase — únicos
// elegíveis a reconciliação de escopo. NAO_APLICAVEL/CANCELADO/SUPERSEDIDO/FALHOU
// não representam obrigação vigente: reconciliar por cima seria inventar
// trabalho sobre um ciclo que a própria operação já descartou.
const ELEGIVEL_A_RECONCILIACAO_DE_ESCOPO: WorkflowInstanceStatus[] = [
  "ATIVO", "BLOQUEADO", "AGUARDANDO", "CONCLUIDO", "PENDENTE", "PENDENTE_DE_REGULARIZACAO",
]

/**
 * MUDANÇA DE ESCOPO — caminho seguro, testado em
 * scripts/reconciliacao-escopo-documento.test.ts: a instância LEGADA (ciclo
 * mais recente antes desta reconciliação) NUNCA é escrita — status, passos,
 * tarefas, anexos, responsáveis e datas ficam exatamente como estavam. A
 * obrigação sob o escopo novo nasce num CICLO NOVO da mesma fase
 * (`previousInstanceId` aponta de volta pra legada, auditável por FK) — nunca
 * dentro do ciclo antigo, porque mudar de PROCESSO pra DOCUMENTO muda a
 * identidade lógica dos alvos (chaveIdempotencia por documento é outra coisa
 * que a chave por processo), então não há "adaptar" sem inventar equivalência.
 *
 * IDEMPOTENTE: processo cuja instância mais recente já tem alguém apontando
 * `previousInstanceId` pra ela é pulado — reprocessar o mesmo evento de outbox
 * (ou reenfileirar a mesma revisão) não duplica nada.
 */
async function processarReconciliacaoEscopoDeFase(
  payload: ReconciliacaoFaseMacroPayload,
  correlationId?: string,
): Promise<void> {
  const legado = await prisma.phaseWorkflowInstance.findFirst({
    where: { processoId: payload.processoId, faseMacroKey: payload.phaseKey },
    orderBy: { ciclo: "desc" },
    select: { id: true, ciclo: true, status: true },
  })

  if (!legado) {
    // Nunca materializada — nada a preservar, o caminho comum já resolve certo
    // (ciclo 1 nasce direto sob o escopo novo, sem ambiguidade nenhuma).
    await materializarExecucaoDaFase({ processoId: payload.processoId, faseMacroKey: payload.phaseKey, fonte: "RECONCILIACAO", correlationId })
    return
  }
  if (!ELEGIVEL_A_RECONCILIACAO_DE_ESCOPO.includes(legado.status)) return

  const jaReconciliado = await prisma.phaseWorkflowInstance.findFirst({
    where: { previousInstanceId: legado.id }, select: { id: true },
  })
  if (jaReconciliado) return

  const novoCiclo = await proximoCicloLocal(payload.processoId, payload.phaseKey)
  const relatorio = await materializarExecucaoDaFase({
    processoId: payload.processoId, faseMacroKey: payload.phaseKey, ciclo: novoCiclo, fonte: "RECONCILIACAO", correlationId,
  })
  if (relatorio.workflowInstanceId == null) {
    await prisma.logAuditoria.create({
      data: {
        acao: "RECONCILIACAO_ESCOPO_FALHOU",
        entidade: "PROCESSO", entidadeId: payload.processoId,
        descricao: `Reconciliação de escopo da fase "${payload.phaseKey}" não produziu instância (estado ${relatorio.estado}).`,
        detalhes: { phaseKey: payload.phaseKey, estado: relatorio.estado, motivos: relatorio.motivos.map((m) => ({ code: m.code, message: m.message })) } as Prisma.InputJsonValue,
      },
    }).catch(() => null)
    return
  }

  await prisma.phaseWorkflowInstance.update({ where: { id: relatorio.workflowInstanceId }, data: { previousInstanceId: legado.id } })
  if (payload.versaoNova != null) {
    await prisma.processo.update({ where: { id: payload.processoId }, data: { macroWorkflowVersion: payload.versaoNova } }).catch(() => null)
  }
  await prisma.logAuditoria.create({
    data: {
      acao: "RECONCILIACAO_ESCOPO_FASE",
      entidade: "PROCESSO", entidadeId: payload.processoId,
      descricao: `Fase "${payload.phaseKey}": mudança de escopo (mandato "Catálogo de Fases"). Instância legada #${legado.id} (ciclo ${legado.ciclo}, status ${legado.status}) preservada intacta. Nova instância #${relatorio.workflowInstanceId} (ciclo ${novoCiclo}) com ${relatorio.tarefasCriadas} nova(s) tarefa(s).`,
      detalhes: {
        phaseKey: payload.phaseKey, instanciaLegadaId: legado.id, cicloLegado: legado.ciclo,
        novaInstanciaId: relatorio.workflowInstanceId, novoCiclo, tarefasCriadas: relatorio.tarefasCriadas,
      } as Prisma.InputJsonValue,
    },
  }).catch(() => null)
}

interface EnqueueCatalogoFaseInput {
  phaseKey: string
  catalogoFaseId: number
  revisaoAnterior: number
  revisaoNova: number
  escopoMudou: boolean
  publicadoPorId: number | null
  correlationId?: string
  /**
   * DE ONDE VEIO O GATILHO — parte da CHAVE DE IDEMPOTÊNCIA, nunca da
   * mecânica: os dois caminhos alcançam os MESMOS processos pela MESMA
   * query e processam pelo MESMO efeito único (`processarReconciliacaoFaseMacro`
   * → `materializarExecucaoDaFase`). Existe porque duas publicações
   * INDEPENDENTES — editar/publicar a fase no Catálogo × publicar o Workflow
   * Interno dela — podem contar versões em eixos diferentes, e uma delas pode
   * repetir um número que a outra já usou; sem o namespace as duas colidiriam
   * na mesma `chaveIdempotencia` e a segunda viraria no-op.
   *
   * Achado real (mandato "Módulo de Fases", Defeito 1, 21/09/2026): uma fase
   * inserida no Workflow Macro ANTES de seu Workflow Interno ser publicado já
   * enfileira aqui (origem CATALOGO_FASE ou fase-macro) — mas
   * `processarReconciliacaoFaseMacro` chama `materializarExecucaoDaFase`, que
   * devolve SEM_WORKFLOW_PUBLICADO sem lançar exceção, e o outbox-dispatcher
   * marca ENVIADO qualquer despacho que não lança — permanentemente, sem
   * retry. Publicar o Workflow Interno depois PRECISA reconciliar de novo, e
   * só consegue se sua chamada tiver uma chave própria (default
   * "CATALOGO_FASE" preserva exatamente o formato/comportamento anterior
   * desta função para quem já a chamava).
   */
  origem?: "CATALOGO_FASE" | "WORKFLOW_INTERNO"
}

export interface EnqueueResultadoCatalogoFase {
  processosAlcancados: number
  outboxRegistrados: number
}

/**
 * DISPARADO PELA EDIÇÃO DE UMA FASE NO CATÁLOGO (PUT
 * /api/gerenciamento/catalogo-fases/[id]) — a contraparte genérica de
 * `enqueueReconciliacaoFaseMacro` (que dispara da publicação do Workflow
 * Macro). Aqui a fase JÁ EXISTE e pode já estar em uso por processos em
 * andamento em QUALQUER macro que a componha — por isso varre TODOS os
 * FaseMacro com esta phaseKey, não um macroWorkflowId só.
 *
 * IDEMPOTENTE pela chave `{tipo}::{processoId}::{phaseKey}::{origem}::rev{revisaoNova}`:
 * reenfileirar a mesma revisão não duplica outbox. `origem` (default
 * "CATALOGO_FASE") namespacia a chave por quem disparou — ver
 * `EnqueueCatalogoFaseInput.origem` para o porquê (também chamada por
 * `publicarWorkflow` com origem "WORKFLOW_INTERNO").
 */
export async function enqueueReconciliacaoCatalogoFase(input: EnqueueCatalogoFaseInput): Promise<EnqueueResultadoCatalogoFase> {
  const origem = input.origem ?? "CATALOGO_FASE"
  const composicoes = await prisma.faseMacro.findMany({
    where: { phaseKey: input.phaseKey },
    select: { macroWorkflow: { select: { id: true, tipoProcessoId: true } } },
  })
  const tipoProcessoIds = [...new Set(composicoes.map((c) => c.macroWorkflow.tipoProcessoId))]

  // DOIS CAMINHOS DE ALCANCE, NUNCA SÓ UM: (a) processos cujo TIPO compõe a fase em
  // algum Workflow Macro; (b) processos cuja FASE ATUAL é literalmente esta —
  // mesmo sem nenhum macro formal por trás (achado real: processo de teste sem
  // `tipoProcessoMotorId`, `faseAtualKey` apontando direto para a fase, e a
  // reconciliação nunca o alcançava — a publicação "acontecia" mas o único lugar
  // onde um humano olha, o Histórico DAQUELE processo, ficava vazio pra sempre).
  // Preservar processos finalizados fora (REGRA MASTER) nos dois caminhos.
  const processos = await prisma.processo.findMany({
    where: {
      faseAtualKey: { not: null, notIn: ["finalizado"] },
      dataConclusao: null,
      OR: [
        ...(tipoProcessoIds.length > 0 ? [{ tipoProcessoMotorId: { in: tipoProcessoIds } }] : []),
        { faseAtualKey: input.phaseKey },
      ],
    },
    select: { id: true },
  })
  if (processos.length === 0) return { processosAlcancados: 0, outboxRegistrados: 0 }

  // ORIGEM WORKFLOW_INTERNO É RESTRITA A QUEM NUNCA RECEBEU A FASE.
  //
  // `instanciarWorkflowDaFase` inclui `workflowVersion` na chave de idempotência
  // da PhaseWorkflowInstance — por desenho: uma operação já registrada numa
  // versão publicada FICA nela ("processos em andamento continuam na versão
  // que já registraram", ver `preverPublicacao`). Isso é correto para quem
  // ainda não tem NADA desta fase (a chave nova cria a primeira instância, sem
  // conflito) — mas achado real (mandato "Módulo de Fases" Mandato #3,
  // 21/09/2026, produção): reconciliar por CADA publicação de nova versão,
  // sem este filtro, materializa uma SEGUNDA PhaseWorkflowInstance/Tarefa em
  // paralelo pra quem JÁ tinha a fase (versão antiga), porque a chave nova
  // (com `workflowVersion` novo) nunca bate com a existente — duplicação real,
  // reproduzida e corrigida em produção com os processos 632/633/635/637.
  // A origem CATALOGO_FASE nunca teve este risco (revisão de CatalogoFase é um
  // eixo totalmente independente de `PhaseInternalWorkflow.versao`, então a
  // chave de materialização nunca muda por causa dela) — o filtro é exclusivo
  // do gatilho novo, sem alterar o comportamento já existente.
  let processosAlvo = processos
  if (origem === "WORKFLOW_INTERNO") {
    const jaMaterializados = await prisma.phaseWorkflowInstance.findMany({
      where: { processoId: { in: processos.map((p) => p.id) }, faseMacroKey: input.phaseKey },
      select: { processoId: true },
      distinct: ["processoId"],
    })
    const jaMaterializadosIds = new Set(jaMaterializados.map((j) => j.processoId))
    processosAlvo = processos.filter((p) => !jaMaterializadosIds.has(p.id))
  }
  if (processosAlvo.length === 0) return { processosAlcancados: 0, outboxRegistrados: 0 }

  const chaveDe = (processoId: number) => `${TIPO_OUTBOX_RECONCILIACAO_CATALOGO_FASE}::${processoId}::${input.phaseKey}::${origem}::rev${input.revisaoNova}`
  const linhas: Prisma.DomainOutboxCreateManyInput[] = processosAlvo.map((p) => ({
    tipo: TIPO_OUTBOX_RECONCILIACAO_CATALOGO_FASE,
    aggregateType: "Processo",
    aggregateId: p.id,
    payload: {
      processoId: p.id, phaseKey: input.phaseKey,
      // `macroWorkflowVersion` (bookkeeping em processarReconciliacaoFaseMacro)
      // rastreia a versão do WORKFLOW MACRO do processo — nunca a do Catálogo
      // de Fase nem a do Workflow Interno. Só CATALOGO_FASE já gravava aqui
      // (comportamento preexistente, fora do escopo deste defeito); a origem
      // WORKFLOW_INTERNO propositalmente NÃO escreve nesse campo, pra não
      // confundir eixos de versionamento diferentes.
      versaoNova: origem === "CATALOGO_FASE" ? input.revisaoNova : undefined,
      escopoMudou: input.escopoMudou,
      catalogoFaseId: input.catalogoFaseId, revisaoAnterior: input.revisaoAnterior, publicadoPorId: input.publicadoPorId,
      origem,
    },
    correlationId: input.correlationId ?? null,
    chaveIdempotencia: chaveDe(p.id),
    status: "PENDENTE",
  }))

  // JÁ REGISTRADOS ANTES desta chamada (mesma revisão, mesmo processo) — a
  // diferença entre isto e `processosAlvo` é exatamente quem é alcançado DE
  // VERDADE agora, e é só para ESSES que o evento "reconciliação solicitada"
  // é auditável no histórico do processo (idempotência: reenfileirar a mesma
  // revisão não duplica o evento).
  const chaves = processosAlvo.map((p) => chaveDe(p.id))
  const jaExistentes = await prisma.domainOutbox.findMany({ where: { chaveIdempotencia: { in: chaves } }, select: { aggregateId: true } })
  const jaExistentesIds = new Set(jaExistentes.map((j) => j.aggregateId))
  const novosProcessos = processosAlvo.filter((p) => !jaExistentesIds.has(p.id))

  const resultado = await prisma.domainOutbox.createMany({ data: linhas, skipDuplicates: true })

  // EVENTO NO HISTÓRICO DO PROCESSO ALCANÇADO — mesmo quando a materialização
  // (etapa seguinte, drenagem do outbox) não cria obrigação nenhuma por falta
  // de Workflow Interno publicado. "Alcançado" e "obrigação criada" são fatos
  // diferentes; os dois precisam ficar visíveis (mandato "Catálogo de Fases",
  // correção 20/09/2026, bug 4).
  if (novosProcessos.length > 0) {
    const rotuloOrigem = origem === "WORKFLOW_INTERNO"
      ? `Workflow Interno da fase "${input.phaseKey}" publicou a versão ${input.revisaoNova} (anterior: ${input.revisaoAnterior})`
      : `Fase "${input.phaseKey}" publicou revisão ${input.revisaoNova} (anterior: ${input.revisaoAnterior})`
    await prisma.logAuditoria.createMany({
      data: novosProcessos.map((p) => ({
        acao: "RECONCILIACAO_SOLICITADA",
        entidade: "PROCESSO",
        entidadeId: p.id,
        descricao: `${rotuloOrigem} — este processo foi alcançado. Resultado da reconciliação será registrado quando o evento for processado.`,
        detalhes: { phaseKey: input.phaseKey, catalogoFaseId: input.catalogoFaseId, revisaoAnterior: input.revisaoAnterior, revisaoNova: input.revisaoNova, escopoMudou: input.escopoMudou, origem } as Prisma.InputJsonValue,
        usuarioId: input.publicadoPorId,
      })),
    }).catch(() => null)
  }

  return { processosAlcancados: processosAlvo.length, outboxRegistrados: resultado.count }
}

// ----------------------------------------------------------------------------
// OBRIGAÇÃO RETROATIVA — "posição atual" ≠ "obrigação cumprida"
// ----------------------------------------------------------------------------

const INSTANCIA_SATISFEITA: WorkflowInstanceStatus[] = ["CONCLUIDO", "NAO_APLICAVEL"]

export interface ObrigacaoRetroativaPendente {
  phaseKey: string
  ordem: number
  motivo: "NUNCA_MATERIALIZADA" | "MATERIALIZADA_MAS_NAO_CONCLUIDA"
}

/**
 * Fases OBRIGATÓRIAS e NÃO CONDICIONAIS, em posição anterior (ou igual) à
 * atual do processo, que não têm nenhuma `PhaseWorkflowInstance` concluída ou
 * marcada NÃO APLICÁVEL. Cobre tanto "reconciliação ainda não rodou" quanto
 * "rodou, materializou, mas ninguém executou o trabalho" — os dois são a
 * mesma pendência do ponto de vista de "pode finalizar?".
 *
 * NÃO avalia fases condicionais: a aplicabilidade delas é decisão de negócio
 * do materializador (`instanciarWorkflowDaFase`), não desta função — tratar
 * "nunca materializada" como bloqueio para uma condicional inventaria
 * pendência onde a regra real diz "não se aplica".
 */
export async function calcularObrigacoesRetroativasPendentes(
  processoId: number,
  fases: { phaseKey: string; ordem: number; required?: boolean; conditional?: boolean }[],
  faseAtual: string,
): Promise<ObrigacaoRetroativaPendente[]> {
  const ordemAtual = fases.find((f) => f.phaseKey === faseAtual)?.ordem ?? Number.POSITIVE_INFINITY
  const candidatas = fases.filter(
    (f) => f.required !== false && !f.conditional && f.ordem <= ordemAtual && f.phaseKey !== faseAtual,
  )
  if (candidatas.length === 0) return []

  const instancias = await prisma.phaseWorkflowInstance.findMany({
    where: { processoId, faseMacroKey: { in: candidatas.map((c) => c.phaseKey) } },
    orderBy: [{ faseMacroKey: "asc" }, { ciclo: "desc" }],
    select: { faseMacroKey: true, status: true },
  })
  const maisRecentePorFase = new Map<string, WorkflowInstanceStatus>()
  for (const inst of instancias) {
    if (!maisRecentePorFase.has(inst.faseMacroKey)) maisRecentePorFase.set(inst.faseMacroKey, inst.status)
  }

  const pendentes: ObrigacaoRetroativaPendente[] = []
  for (const c of candidatas) {
    const status = maisRecentePorFase.get(c.phaseKey)
    if (status == null) {
      pendentes.push({ phaseKey: c.phaseKey, ordem: c.ordem, motivo: "NUNCA_MATERIALIZADA" })
    } else if (!INSTANCIA_SATISFEITA.includes(status)) {
      pendentes.push({ phaseKey: c.phaseKey, ordem: c.ordem, motivo: "MATERIALIZADA_MAS_NAO_CONCLUIDA" })
    }
  }
  return pendentes.sort((a, b) => a.ordem - b.ordem)
}

// ----------------------------------------------------------------------------
// RECONCILIAÇÃO NA FASE ATUAL — quem já materializou e continua na mesma fase
// ----------------------------------------------------------------------------

interface EnqueueWorkflowInternoFaseAtualInput {
  phaseKey: string
  /** `null` = workflow 'all' (aplica a qualquer tipo que não tenha um específico). */
  tipoProcessoId: number | null
  workflowId: number
  versaoAnterior: number
  versaoNova: number
  publicadoPorId: number | null
  correlationId?: string
}

export interface EnqueueResultadoWorkflowInternoFaseAtual {
  processosAlcancados: number
  outboxRegistrados: number
}

/**
 * DISPARADO PELA PUBLICAÇÃO DO WORKFLOW INTERNO (`publicarWorkflow`), ao lado
 * de `enqueueReconciliacaoCatalogoFase(origem: "WORKFLOW_INTERNO")` — que só
 * alcança quem NUNCA materializou esta fase (ver o comentário de `origem`
 * nela). Esta função é o complemento: alcança quem está NA FASE ATUAL com a
 * instância JÁ ABERTA (ATIVO/BLOQUEADO/AGUARDANDO) — os dois juntos cobrem
 * "fase futura" e "fase atual"; "fase já ultrapassada" nunca é candidata (nem
 * aqui, nem lá — a instância dela nunca está aberta) e "processo finalizado"
 * é excluído pelo mesmo filtro de sempre.
 *
 * `tipoProcessoId: null` (workflow 'all') alcança candidatos por `phaseKey`
 * sem filtrar por tipo — o filtro fino de "este processo realmente resolve
 * para ESTE workflow, ou existe um específico do tipo dele que tem
 * precedência" é feito por `reconciliarNovaVersaoNaInstanciaAtual` (via
 * `resolverWorkflowAplicavel`, a mesma resolução de sempre) no momento em que
 * o evento é processado — enfileirar um candidato a mais que acaba não
 * aplicando nada é seguro (SEM_TRABALHO_NOVO), nunca duplica.
 *
 * IDEMPOTENTE pela chave `{tipo}::{processoId}::{phaseKey}::rev{versaoNova}`.
 */
export async function enqueueReconciliacaoWorkflowInternoFaseAtual(
  input: EnqueueWorkflowInternoFaseAtualInput,
): Promise<EnqueueResultadoWorkflowInternoFaseAtual> {
  const candidatos = await prisma.processo.findMany({
    where: {
      faseAtualKey: input.phaseKey,
      dataConclusao: null,
      ...(input.tipoProcessoId != null ? { tipoProcessoMotorId: input.tipoProcessoId } : {}),
      phaseWorkflowInstances: {
        some: { faseMacroKey: input.phaseKey, status: { in: ["ATIVO", "BLOQUEADO", "AGUARDANDO"] } },
      },
    },
    select: { id: true },
  })
  if (candidatos.length === 0) return { processosAlcancados: 0, outboxRegistrados: 0 }

  const chaveDe = (processoId: number) =>
    `${TIPO_OUTBOX_RECONCILIACAO_WORKFLOW_INTERNO_FASE_ATUAL}::${processoId}::${input.phaseKey}::rev${input.versaoNova}`
  const linhas: Prisma.DomainOutboxCreateManyInput[] = candidatos.map((p) => ({
    tipo: TIPO_OUTBOX_RECONCILIACAO_WORKFLOW_INTERNO_FASE_ATUAL,
    aggregateType: "Processo",
    aggregateId: p.id,
    payload: {
      processoId: p.id, phaseKey: input.phaseKey, workflowId: input.workflowId,
      versaoAnterior: input.versaoAnterior, versaoNova: input.versaoNova, publicadoPorId: input.publicadoPorId,
    },
    correlationId: input.correlationId ?? null,
    chaveIdempotencia: chaveDe(p.id),
    status: "PENDENTE",
  }))
  const resultado = await prisma.domainOutbox.createMany({ data: linhas, skipDuplicates: true })
  return { processosAlcancados: candidatos.length, outboxRegistrados: resultado.count }
}

export interface ReconciliacaoWorkflowInternoFaseAtualPayload {
  processoId: number
  phaseKey: string
  workflowId: number
  versaoAnterior: number
  versaoNova: number
  publicadoPorId: number | null
}

/**
 * O EFEITO — chamado pelo outbox-dispatcher. Delega o cálculo/aplicação
 * inteiros a `reconciliarNovaVersaoNaInstanciaAtual` (o único que decide se é
 * seguro aplicar — ver o comentário dela) e, só quando ela cria passo novo,
 * garante a Tarefa dele pelo mesmo serviço canônico de sempre
 * (`garantirTarefaDePasso`) — idempotente: passo que já tinha Tarefa não é
 * tocado, `Tarefa.dataPrazo` de ninguém que já existia muda.
 *
 * Falha PROPAGA (o outbox devolve o evento a PENDENTE e reprocessa) e NÃO
 * afeta os outros processos — cada um é uma linha própria.
 */
export async function processarReconciliacaoWorkflowInternoFaseAtual(
  payload: ReconciliacaoWorkflowInternoFaseAtualPayload,
  correlationId?: string,
): Promise<void> {
  if (!payload.processoId || !payload.phaseKey) return

  const r = await reconciliarNovaVersaoNaInstanciaAtual({
    processoId: payload.processoId, faseMacroKey: payload.phaseKey, correlationId,
  })

  let tarefasCriadas = 0
  if (r.success && r.aplicado) {
    const preCondicoes = await carregarPreCondicoes(payload.processoId)
    for (const passo of r.stepInstances) {
      const g = await garantirTarefaDePasso({
        stepInstanceId: passo.id, correlationId, causationId: passo.chaveIdempotencia,
        origem: "reconciliacao", preCondicoes,
      })
      if (g.success && g.created) tarefasCriadas++
    }
  }

  await prisma.logAuditoria.create({
    data: {
      acao: "RECONCILIACAO_WORKFLOW_INTERNO_FASE_ATUAL",
      entidade: "PROCESSO",
      entidadeId: payload.processoId,
      descricao: r.success
        ? (r.aplicado
          ? `Workflow Interno da fase "${payload.phaseKey}" publicou a versão ${payload.versaoNova} (anterior: ${payload.versaoAnterior}) — aplicado à instância em andamento: ${r.passosCriados} passo(s) novo(s), ${tarefasCriadas} tarefa(s) nova(s), ${r.passosAtualizados} passo(s) atualizado(s)/retirado(s), ${r.subtarefasRetiradas} subtarefa(s) retirada(s), ${r.prazosRecalculados} prazo(s) recalculado(s). IDs, responsáveis, dados preenchidos e histórico preservados.`
          : r.motivo === "CONFLITO_DADOS_EXISTENTES"
            ? `Workflow Interno da fase "${payload.phaseKey}" publicou a versão ${payload.versaoNova} — NÃO aplicado a este processo por conflito com dado já existente: ${r.conflitos.map((c) => `[${c.stepKey}${c.subtaskKey ? `/${c.subtaskKey}` : ""}] ${c.detalhe}`).join(" | ")}`
            : `Workflow Interno da fase "${payload.phaseKey}" publicou a versão ${payload.versaoNova} — não aplicado (${r.motivo}${r.detalhe ? `: ${r.detalhe}` : ""}).`)
        : `Workflow Interno da fase "${payload.phaseKey}" publicou a versão ${payload.versaoNova} — reconciliação recusada (${r.code}).`,
      detalhes: { payload, resultado: r } as unknown as Prisma.InputJsonValue,
      usuarioId: payload.publicadoPorId,
    },
  }).catch(() => null)
}

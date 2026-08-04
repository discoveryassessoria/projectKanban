// src/services/documento-operacao.ts
// FASE 3 (CP-5) — OPERAÇÃO POR-DOCUMENTO no runtime V2 ÚNICO.
// Fonte canônica: PhaseWorkflowStepInstance com documentoId setado (discriminador
// já existente). Sem model/coluna nova. Este é o ponto central: os consumidores
// (Central Operacional, completion-engine, rotas de operação, avanço de fase)
// leem/escrevem AQUI — não falam com o legado direto. Reusa o completion-engine
// (não recalcula regra — regras 9/10).

import { prisma } from "@/lib/prisma"
import type { StepInstanceStatus, FaseCode, Prisma, WorkflowEventoTipo } from "@prisma/client"
import {
  resolveStepCompletionState,
  politicaPadraoParaStep,
} from "@/src/services/processEngine/stepCompletionResolver"
import { evaluateWorkflowProgress, type AggregateResult } from "@/src/services/completion-engine/policies"
import {
  getFase, getStepDef, isFaseReady, phaseKeyToFaseCode, faseCodeToPhaseKey, resolveStepKeyCompat,
} from "@/src/lib/process-stage/fases-catalog"
import { resolveWorkflowStepEditor } from "@/src/lib/process-stage/step-editor-registry"
import {
  acoesPermitidasDaEtapa, acaoCompativelComEstado, PERMISSAO_DA_ACAO, type AcaoEtapa,
} from "@/src/lib/process-stage/acoes-etapa"
import {
  lerAndamento, aplicarAndamento, gravarAndamento, previsaoEfetiva,
  type EntradaAndamento,
} from "@/src/lib/process-stage/andamento-etapa"
import { mapLegacyStepStatus, stepInstanceStatusToLegacy } from "@/src/lib/process-stage/legacy-status-map"
import { montarChavePasso } from "@/src/services/phase-workflow-helpers"
import { evoluirNecessidadePorPasso, reabrirAtendimentoNecessidade } from "@/src/services/necessidade-documental"
import { chaveEvento } from "@/src/services/task-step-sync-helpers"
import { recalcularFaseDoProcesso } from "@/src/lib/process-stage/recalcular-fase"
import { projetarTarefaDoPasso, assegurarCoerenciaPassoTarefa } from "@/src/services/passo-tarefa-projecao"

// Transição de estado do passo → evento operacional do motor. Fonte única desta
// tradução para a operação por-documento; espelha o vocabulário de WorkflowEventoTipo.
const EVENTO_POR_STATUS: Partial<Record<StepInstanceStatus, WorkflowEventoTipo>> = {
  DISPONIVEL: "PASSO_DISPONIBILIZADO",
  EM_ANDAMENTO: "PASSO_INICIADO",
  BLOQUEADO: "PASSO_BLOQUEADO",
  EXECUTADO: "PASSO_EXECUTADO",
  CONCLUIDO: "PASSO_CONCLUIDO",
  DISPENSADO: "PASSO_DISPENSADO",
  CANCELADO: "PASSO_CANCELADO",
  FALHOU: "PASSO_FALHOU",
  PENDENTE: "PASSO_REABERTO",
}

// Passos que NÃO contam como operação ativa do documento.
const INATIVOS: StepInstanceStatus[] = ["SUPERSEDIDO", "CANCELADO"]

// TODO(FASE-3 restante — fora do escopo do item atual):
//  - workflow POST "Iniciar operação": criar passos V2 por-documento (dual-write de criação).
//  - recalcular-fase: derivar avanço da fase a partir da operação V2 por-documento.
//  - central-operacional: owner da etapa ativa pela fonte V2 (responsavelId é ref solta a Usuario).
//  - cutover final: remover leitura/escrita legada após validação em produção.

export interface PassoOperacaoV2 {
  id: number
  stepKey: string
  status: StepInstanceStatus
  faseMacroKey: string
  ordem: number
  responsavelId: number | null
  prazo: Date | null
  startedAt: Date | null
  completedAt: Date | null
  motivo: string | null
  /** Versionamento otimista do passo — o cliente devolve no salvar andamento. */
  lockVersion: number
  operacao: Record<string, unknown> | null // metadata.operacao (domínio)
}

/**
 * Fase ATUAL persistida do processo do documento — ÚNICA fonte de verdade do escopo
 * operacional. Um mesmo Documento acumula passos de várias fases ao longo da vida
 * (localizar_registro na Genealogia, depois solicitar/receber/... na Emissão). O
 * workflow/operação exibido deve ser SEMPRE o da fase atual, nunca uma mistura.
 * Genérico: vale para qualquer fase do Workflow Macro, sem condicional por fase.
 */
async function faseAtualKeyDoDoc(documentoId: number): Promise<string | null> {
  const doc = await prisma.documento.findUnique({
    where: { id: documentoId },
    select: { pessoa: { select: { arvore: { select: { processos: { select: { faseAtualKey: true } } } } } } },
  })
  return doc?.pessoa?.arvore?.processos?.[0]?.faseAtualKey ?? null
}

/** Passos operacionais V2 de UM documento NA FASE ATUAL (ativos), ordenados. */
export async function passosOperacaoV2(documentoId: number): Promise<PassoOperacaoV2[]> {
  const faseAtualKey = await faseAtualKeyDoDoc(documentoId)
  const rows = await prisma.phaseWorkflowStepInstance.findMany({
    // Escopo à FASE ATUAL: passos de fases anteriores (mesmo CONCLUIDO) não entram no
    // workflow operacional. Sem faseAtualKey (doc sem processo) cai no comportamento antigo.
    where: { documentoId, status: { notIn: INATIVOS }, ...(faseAtualKey ? { faseMacroKey: faseAtualKey } : {}) },
    orderBy: { ordem: "asc" },
    select: {
      id: true, stepKey: true, status: true, faseMacroKey: true, ordem: true,
      responsavelId: true, prazo: true, startedAt: true, completedAt: true, motivo: true, metadata: true,
      lockVersion: true,
    },
  })
  return rows.map((r) => {
    const meta = (r.metadata ?? null) as { operacao?: Record<string, unknown> } | null
    return {
      id: r.id, stepKey: r.stepKey, status: r.status, faseMacroKey: r.faseMacroKey, ordem: r.ordem,
      responsavelId: r.responsavelId, prazo: r.prazo, startedAt: r.startedAt, completedAt: r.completedAt,
      motivo: r.motivo, lockVersion: r.lockVersion, operacao: meta?.operacao ?? null,
    }
  })
}

/** Documento já tem operação por-documento NA FASE ATUAL no V2? (discrimina V2 × fallback
 *  legado E impede "operação já existe" por causa de passos de fase anterior). */
export async function temOperacaoV2(documentoId: number): Promise<boolean> {
  const faseAtualKey = await faseAtualKeyDoDoc(documentoId)
  const n = await prisma.phaseWorkflowStepInstance.count({
    where: { documentoId, ...(faseAtualKey ? { faseMacroKey: faseAtualKey } : {}) },
  })
  return n > 0
}

/**
 * Progresso/conclusão da operação de UM documento pela fonte V2. Reusa o mesmo
 * núcleo do completion-engine (resolveStepCompletionState + evaluateWorkflowProgress);
 * o peso vem do catálogo de fases (fonte única). Retorna null se não há operação V2
 * para o documento (o chamador cai no fallback legado durante a compatibilidade).
 */
export async function progressoOperacaoV2(documentoId: number): Promise<AggregateResult | null> {
  const passos = await passosOperacaoV2(documentoId)
  if (passos.length === 0) return null
  const now = new Date()
  const faseCode = phaseKeyToFaseCode(passos[0].faseMacroKey)
  // Lookup TOLERANTE A ALIAS (getStepDef): a instância pode ter sido gravada com a
  // chave legada e o catálogo carrega a publicada — o peso não pode cair para 1 por
  // causa disso, senão o progresso do documento fica errado sem ninguém perceber.
  const pesoDe = (k: string) => getStepDef(faseCode, k)?.weight ?? 1

  const inputs = await Promise.all(
    passos.map(async (p) => {
      // Estado gravado como concluído/dispensado conta como 100% (respeita o banco).
      if (p.status === "CONCLUIDO" || p.status === "DISPENSADO") {
        return {
          weight: pesoDe(p.stepKey),
          result: {
            completed: true, progress: 100, reason: "Passo concluído.",
            policy: "MANUAL_CONFIRMATION" as const, blockers: [], evidence: [], evaluatedAt: now,
          },
        }
      }
      const r = await resolveStepCompletionState(p.stepKey, documentoId, politicaPadraoParaStep(p.stepKey))
      return { weight: pesoDe(p.stepKey), result: r.result }
    }),
  )
  return evaluateWorkflowProgress(inputs, now)
}

// ── ADAPTADOR V2 → shape legado (preserva o contrato do frontend, fonte é V2) ──
export interface WorkflowV2Shape {
  id: string
  documentoId: number
  faseCode: string | null
  status: string
  progress: number
  steps: Array<Record<string, unknown>>
}

/**
 * Quem está lendo o workflow. As AÇÕES PERMITIDAS de cada etapa são calculadas
 * aqui, no servidor, a partir das permissões efetivas — o frontend desenha o que
 * recebe e não infere transição nenhuma. Sem contexto (jobs, scripts, chamadas
 * internas) o payload sai sem ações, e nenhuma tela ganha botão por acidente.
 */
export interface ContextoLeituraWorkflow {
  usuarioId: number | null
  permissoes: Record<string, boolean> | null
}

/** Monta o objeto "workflow" no formato antigo esperado pela UI, a partir do V2. */
export async function montarWorkflowV2(
  documentoId: number,
  ctx?: ContextoLeituraWorkflow,
): Promise<WorkflowV2Shape | null> {
  const passos = await passosOperacaoV2(documentoId)
  if (passos.length === 0) return null
  const faseMacroKey = passos[0].faseMacroKey
  const faseCode = phaseKeyToFaseCode(faseMacroKey)
  // Lookup de catálogo TOLERANTE A ALIAS. Enquanto era `find(c => c.stepKey === k)` com a
  // chave crua, o passo publicado "aguardar_retorno_do_cartorio" não achava a definição
  // "aguardar_retorno" do catálogo: a etapa aparecia na tela com a CHAVE como título,
  // peso 1 e sem descrição. Um ponto de resolução só, no catálogo.
  const catOf = (k: string) => getStepDef(faseCode, k)
  const ids = [...new Set(passos.map((p) => p.responsavelId).filter((x): x is number => x != null))]
  const usuarios = ids.length
    ? await prisma.usuario.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true, email: true } })
    : []
  const uMap = new Map(usuarios.map((u) => [u.id, u]))

  let totalW = 0, doneW = 0
  const steps = passos.map((p) => {
    const c = catOf(p.stepKey)
    const w = c?.weight ?? 1
    totalW += w
    if (p.status === "CONCLUIDO" || p.status === "DISPENSADO") doneW += w
    const op = (p.operacao ?? {}) as Record<string, unknown>
    const andamento = lerAndamento(op)
    // EDITOR resolvido no SERVIDOR, pelo registry oficial. A tela não decide mais
    // qual interface montar a partir da chave do passo — e "sem editor específico"
    // resolve para o editor PADRÃO, nunca para uma tela de erro.
    const editor = resolveWorkflowStepEditor({ stepKey: p.stepKey, phaseKey: p.faseMacroKey })
    return {
      ...op,
      id: p.id, ordem: p.ordem, stepKey: p.stepKey,
      title: c?.title ?? p.stepKey, description: c?.description ?? null,
      status: stepInstanceStatusToLegacy(p.status), weight: w, ownerKey: c?.ownerKey ?? null,
      slaDays: c?.slaDays ?? null,
      assigneeId: p.responsavelId, assignee: p.responsavelId ? uMap.get(p.responsavelId) ?? null : null,
      startedAt: p.startedAt, dueAt: p.prazo, completedAt: p.completedAt,
      notes: (op.notes as string) ?? null, motivoBloqueio: p.motivo,
      lockVersion: p.lockVersion,
      editor: { kind: editor.kind, especifico: editor.especifico, stepKeyCanonico: editor.stepKeyCanonico },
      acoesPermitidas: acoesPermitidasDaEtapa({ status: p.status, permissoes: ctx?.permissoes ?? null }),
      andamento: { ...andamento, previsaoEfetiva: previsaoEfetiva(andamento, p.startedAt) },
    } as Record<string, unknown>
  })
  const progress = totalW > 0 ? Math.round((doneW / totalW) * 100) : 0
  const concluido = passos.every((p) => ["CONCLUIDO", "DISPENSADO"].includes(p.status))
  return { id: `v2-${documentoId}-${faseMacroKey}`, documentoId, faseCode, status: concluido ? "concluido" : "em_andamento", progress, steps }
}

type IniciarOpts = { responsavelId?: number | null; dataPrazoInicial?: Date | null; observacaoInicial?: string | null }
type OpResult = { ok: true; workflow: WorkflowV2Shape | null } | { ok: false; error: string; status: number }

/** "Iniciar operação" no V2: cria os passos por-documento sob a instância da fase. */
export async function iniciarOperacaoDocumentoV2(
  documentoId: number,
  opts: IniciarOpts = {},
  ctx?: ContextoLeituraWorkflow,
): Promise<OpResult> {
  if (await temOperacaoV2(documentoId)) return { ok: false, error: "Operação já existe para este documento", status: 409 }
  const doc = await prisma.documento.findUnique({
    where: { id: documentoId },
    select: { pessoa: { select: { arvore: { select: { processos: { select: { id: true, faseAtualKey: true } } } } } } },
  })
  const processos = doc?.pessoa?.arvore?.processos ?? []
  if (processos.length === 0) return { ok: false, error: "Documento não está ligado a nenhum processo", status: 422 }
  const processo = processos[0]
  const faseCode = (phaseKeyToFaseCode(processo.faseAtualKey) ?? null) as FaseCode | null
  if (!faseCode) return { ok: false, error: "Processo sem fase definida", status: 422 }
  if (!isFaseReady(faseCode)) return { ok: false, error: `A fase "${faseCode}" não tem etapas no catálogo`, status: 422 }
  const faseMacroKey = faseCodeToPhaseKey(faseCode) as string
  const inst = await prisma.phaseWorkflowInstance.findFirst({
    where: { processoId: processo.id, faseMacroKey, status: { notIn: ["CANCELADO", "SUPERSEDIDO"] } },
    orderBy: { ciclo: "desc" },
    select: { id: true, ciclo: true, workflowDefinitionId: true },
  })
  if (!inst) return { ok: false, error: "Instância V2 da fase não encontrada (processo não migrado)", status: 422 }
  const catSteps = getFase(faseCode).steps
  const now = new Date()
  const firstDue = opts.dataPrazoInicial ?? new Date(now.getTime() + catSteps[0].slaDays * 86400000)
  const defId = inst.workflowDefinitionId ?? 0
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < catSteps.length; i++) {
      const s = catSteps[i]
      const isActive = i === 0
      const chave = montarChavePasso({ workflowInstanceId: inst.id, stepDefinitionId: defId, stepKey: s.stepKey, stepDefinitionVersion: 1, ciclo: inst.ciclo, documentoId })
      const meta = isActive && opts.observacaoInicial ? ({ operacao: { notes: opts.observacaoInicial } } as Prisma.InputJsonValue) : undefined
      await tx.phaseWorkflowStepInstance.upsert({
        where: { chaveIdempotencia: chave },
        create: {
          workflowInstanceId: inst.id, stepDefinitionId: defId, stepDefinitionVersion: 1, stepKey: s.stepKey,
          snapshot: { origem: "INICIAR_OPERACAO" } as Prisma.InputJsonValue, snapshotSchemaVersion: 1,
          processoId: processo.id, faseMacroKey, ordem: s.ordem, status: isActive ? "EM_ANDAMENTO" : "BLOQUEADO",
          ciclo: inst.ciclo, chaveIdempotencia: chave, documentoId,
          responsavelId: isActive ? opts.responsavelId ?? null : null, prazo: isActive ? firstDue : null,
          startedAt: isActive ? now : null, ...(meta ? { metadata: meta } : {}),
        },
        update: {},
      })
    }
    await tx.documento.update({
      where: { id: documentoId },
      data: {
        status: faseCode === "GENEALOGIA" ? "EM_BUSCA" : "SOLICITAR", dataInicioOperacao: now, ultimaMovimentacao: now,
        responsavelId: opts.responsavelId ?? undefined, dataPrazoOperacao: firstDue, motivoBloqueio: null,
      },
    })
  })
  return { ok: true, workflow: await montarWorkflowV2(documentoId, ctx) }
}

/**
 * GARANTE a operação da FASE ATUAL do documento (materialização automática idempotente).
 * Fluxo oficial ao abrir o drawer: se já há operação na fase atual, reusa; senão,
 * materializa os passos do Workflow Interno cadastrado (mesma rotina do "Iniciar operação",
 * upsert por chaveIdempotencia → 2 cliques/2 requisições NÃO duplicam). Genérico p/ qualquer
 * fase por-documento com catálogo (Genealogia/Emissão/Emissão Retificada); fases de pacote
 * (Tradução/Apostilamento) e as com tela própria (Análise/Retificação/Protocolo) NÃO usam
 * este drawer, então não materializam aqui. Retorna semWorkflowInterno quando a fase atual
 * não tem workflow configurado (nunca cai no workflow de outra fase).
 */
export async function garantirOperacaoDocumentoV2(
  documentoId: number,
  ctx?: ContextoLeituraWorkflow,
): Promise<{ workflow: WorkflowV2Shape | null; semWorkflowInterno?: boolean }> {
  // 1) já existe operação na fase atual? (montarWorkflowV2 já é escopado à fase atual)
  const existente = await montarWorkflowV2(documentoId, ctx)
  if (existente) return { workflow: existente }

  // 2) materializa (idempotente). iniciarOperacaoDocumentoV2 valida fase/instância/catálogo.
  const r = await iniciarOperacaoDocumentoV2(documentoId, {}, ctx)
  if (r.ok) return { workflow: r.workflow }

  // 3) corrida: outra requisição materializou em paralelo → re-lê e reusa
  if (r.status === 409) return { workflow: await montarWorkflowV2(documentoId, ctx) }

  // 4) fase atual SEM workflow configurado (sem catálogo/instância) → mensagem controlada,
  //    NUNCA workflow de outra fase.
  return { workflow: null, semWorkflowInterno: true }
}

// Campos de DOMÍNIO aceitos no PATCH do passo (vão para metadata.operacao).
const CAMPOS_OPERACAO = [
  "trackingCode", "externalProtocol", "requestChannel", "reviewResult", "validationResult",
  "externalEntityName", "costPaid", "paymentMethod", "documentMedium", "physicalLocation",
  "reviewChecklist", "stepObservation", "legalOpinion", "notes", "completedById",
  // REFERÊNCIA ao registro canônico. O payload do passo deixa de ser fonte da
  // solicitação e passa a apontar para ela.
  "solicitacaoId",
] as const

/**
 * Ação PRETENDIDA por um PATCH, para o enforcement server-side. O cliente pode
 * mandar qualquer corpo; quem decide o que aquilo É em termos de domínio (e,
 * portanto, qual permissão exige) é o servidor.
 */
function acaoDoPatch(patch: Record<string, unknown>, statusAtual: StepInstanceStatus): AcaoEtapa | null {
  if (patch.forcar === true) return "forcar"
  if (typeof patch.status === "string") {
    const novo = mapLegacyStepStatus(patch.status)
    if (novo === "CONCLUIDO") return "concluir"
    if (novo === "BLOQUEADO") return "bloquear"
    if (statusAtual === "CONCLUIDO") return "reabrir"
    if (statusAtual === "BLOQUEADO") return "desbloquear"
    return "salvar_andamento"
  }
  if (patch.assigneeId !== undefined) return "transferir"
  if (patch.dueAt !== undefined) return "alterar_prazo"
  return "salvar_andamento"
}

/** Passo carregado, do jeito que o motor de transição precisa dele. */
export type PassoParaTransicao = {
  id: number
  documentoId: number | null
  necessidadeId: number | null
  processoId: number
  workflowInstanceId: number
  faseMacroKey: string
  ordem: number
  status: StepInstanceStatus
  ciclo: number
  metadata: unknown
  stepKey: string
}

const SELECT_PASSO_TRANSICAO = {
  id: true, documentoId: true, necessidadeId: true, processoId: true, workflowInstanceId: true,
  faseMacroKey: true, ordem: true, status: true, ciclo: true, metadata: true, stepKey: true,
} as const

/**
 * Carrega o passo e AUTORIZA a ação pretendida. Separado da aplicação para que
 * quem precisa concluir o passo DENTRO da própria transação (a solicitação de
 * certidão) use o MESMO gate — sem um segundo motor de transição por perto.
 */
export async function carregarPassoAutorizado(
  documentoId: number,
  stepInstanceId: number,
  patch: Record<string, unknown>,
  ctx?: ContextoLeituraWorkflow,
): Promise<{ ok: true; passo: PassoParaTransicao } | { ok: false; error: string; status: number }> {
  const p = await prisma.phaseWorkflowStepInstance.findUnique({
    where: { id: stepInstanceId },
    select: SELECT_PASSO_TRANSICAO,
  })
  if (!p || p.documentoId !== documentoId) return { ok: false, error: "STEP_NOT_FOUND", status: 404 }

  // AUTORIZAÇÃO NO SERVIDOR. `ctx` ausente = chamada interna confiável (job, script,
  // sincronização); vindo de rota HTTP ele é SEMPRE preenchido, e aí a permissão da
  // ação pretendida é exigida — não a lista que o frontend achou que podia mostrar.
  if (ctx) {
    const acao = acaoDoPatch(patch, p.status)
    if (acao) {
      if (!acaoCompativelComEstado(acao, p.status)) {
        return { ok: false, error: "STEP_NOT_AVAILABLE", status: 409 }
      }
      if (ctx.permissoes?.[PERMISSAO_DA_ACAO[acao]] !== true) {
        return { ok: false, error: "PERMISSION_REQUIRED", status: 403 }
      }
      if (acao === "forcar" && !String(patch.justificativa ?? "").trim()) {
        return { ok: false, error: "VALIDATION_ERROR", status: 422 }
      }
    }
  }
  return { ok: true, passo: p as PassoParaTransicao }
}

/** PATCH de um passo no V2 (status/responsável/campos de domínio) + lock-step entre irmãos. */
export async function atualizarPassoV2(
  documentoId: number,
  stepInstanceId: number,
  patch: Record<string, unknown>,
  ctx?: ContextoLeituraWorkflow,
): Promise<OpResult> {
  const carregado = await carregarPassoAutorizado(documentoId, stepInstanceId, patch, ctx)
  if (!carregado.ok) return carregado
  const p = carregado.passo

  const now = new Date()
  const liberarProximo = await prisma.$transaction((tx) => aplicarTransicaoDoPassoTx(tx, p, patch, ctx, now))

  // CONCLUSÃO DA FASE E AVANÇO — automáticos, e no serviço, não na rota. Concluir a
  // última obrigação da fase é o que a conclui; quem concluiu por outro caminho (job,
  // sincronização de tarefa, script) tem de disparar o mesmo avanço. Deixar isso na
  // rota HTTP fazia o comportamento depender de por onde a conclusão entrou.
  // Idempotente e gated pelo BlockingEngine: sem todas as obrigatórias feitas, não anda.
  // Fora da transação de propósito: o avanço abre a sua própria.
  if (liberarProximo) await avancarFaseSeCouber(documentoId)

  return { ok: true, workflow: await montarWorkflowV2(documentoId, ctx) }
}

/** Dispara o recálculo/avanço de fase. Fora de transação, e tolerante a falha. */
export async function avancarFaseSeCouber(documentoId: number): Promise<void> {
  try {
    const adv = await recalcularFaseDoProcesso(documentoId)
    if (adv.mudou) console.log(`[avanço de fase] doc ${documentoId}: ${adv.faseAnterior} → ${adv.faseNova}`)
  } catch (e) {
    console.error("[avanço de fase] erro ao recalcular:", e)
  }
}

/**
 * MOTOR DE TRANSIÇÃO DO PASSO — o corpo transacional, aberto para composição.
 *
 * Recebe a transação de fora justamente para que quem precisa concluir o passo
 * JUNTO com outras escritas (a solicitação de certidão grava solicitação,
 * protocolo e arquivo e conclui a etapa num COMMIT só) reuse este motor em vez
 * de reimplementar a transição. Continua sendo UM motor.
 *
 * Devolve `liberarProximo` — o chamador decide quando disparar o avanço de fase
 * (que abre a própria transação e não pode rodar dentro desta).
 */
export async function aplicarTransicaoDoPassoTx(
  tx: Prisma.TransactionClient,
  p: PassoParaTransicao,
  patch: Record<string, unknown>,
  ctx: ContextoLeituraWorkflow | undefined,
  now: Date,
): Promise<boolean> {
  const documentoId = p.documentoId as number
  const catStep = getStepDef(phaseKeyToFaseCode(p.faseMacroKey), p.stepKey)

  const novo: StepInstanceStatus = typeof patch.status === "string" ? mapLegacyStepStatus(patch.status) : p.status
  const eraConcluida = p.status === "CONCLUIDO"
  // Evento operacional correspondente à transição (vocabulário canônico do motor,
  // o mesmo de task-step-sync/phase-workflow). null = mudança sem transição de
  // estado (ex.: só trocou o responsável) — não inventa evento onde não houve.
  const eventoDaTransicao = novo === p.status ? null : EVENTO_POR_STATUS[novo] ?? null
  const liberarProximo = novo === "CONCLUIDO" && !eraConcluida
  const vaiReabrir = eraConcluida && novo !== "CONCLUIDO"

  // metadata.operacao: preserva o existente e sobrepõe os campos de domínio do patch
  const metaExist = ((p.metadata ?? {}) as { operacao?: Record<string, unknown> }).operacao ?? {}
  const opPatch: Record<string, unknown> = { ...metaExist }
  for (const k of CAMPOS_OPERACAO) if (patch[k] !== undefined) opPatch[k] = patch[k]
  // AUTORIA DA CONCLUSÃO vem do token, nunca do corpo da requisição. O cliente
  // mandava `completedById: getUserId()` lido do localStorage — quem concluiu era,
  // na prática, o que o navegador dissesse. Fora da conclusão/reabertura, o valor
  // JÁ GRAVADO é preservado (o patch do cliente é descartado, não aplicado).
  if (ctx) {
    if (liberarProximo) opPatch.completedById = ctx.usuarioId
    else if (vaiReabrir) opPatch.completedById = null
    else opPatch.completedById = metaExist.completedById ?? null
  }
  if (ctx && patch.forcar === true) {
    // Rastro do ato administrativo dentro do próprio payload da etapa, além da auditoria.
    opPatch.forcadoPor = ctx.usuarioId
    opPatch.forcadoEm = now.toISOString()
    opPatch.forcadoMotivo = String(patch.motivo ?? "").trim() || null
    opPatch.forcadoJustificativa = String(patch.justificativa ?? "").trim() || null
  }

  const data: Prisma.PhaseWorkflowStepInstanceUpdateInput = {
    status: novo,
    metadata: { operacao: opPatch } as Prisma.InputJsonValue,
    ...(patch.assigneeId !== undefined ? { responsavelId: (patch.assigneeId as number | null) } : {}),
    ...(patch.dueAt !== undefined ? { prazo: patch.dueAt ? new Date(patch.dueAt as string) : null } : {}),
    ...(patch.motivoBloqueio !== undefined ? { motivo: patch.motivoBloqueio as string | null } : {}),
    ...(novo === "EM_ANDAMENTO" ? { startedAt: now } : {}),
    ...(liberarProximo ? { completedAt: now } : {}),
    ...(vaiReabrir ? { completedAt: null } : {}),
  }
  // TRANSACIONAL (P3): passo + necessidade + passos-irmãos + documento na MESMA transação —
  // a reabertura NÃO deixa estados intermediários inconsistentes (progresso/bloqueio caem juntos).
  {
    await tx.phaseWorkflowStepInstance.update({ where: { id: p.id }, data })

    // A TAREFA É PROJEÇÃO DO PASSO. Esta transação escrevia só o passo e deixava a
    // tarefa como estava: em produção o passo "Localizar registro da certidão" ficou
    // CONCLUIDO com a tarefa NAO_INICIADA. Projeção pelo mapeamento OFICIAL, na mesma
    // transação — os dois estados nascem e mudam juntos, ou nenhum muda.
    const passosTocados = [p.id]
    await projetarTarefaDoPasso(tx, { stepInstanceId: p.id, statusPasso: novo })

    // CICLO DE VIDA DA NECESSIDADE (fluxo operacional oficial). Conclusão → ATENDIDA; início →
    // EM_ATENDIMENTO. REABERTURA → regride ATENDIDA/NAO_LOCALIZADA para EM_ATENDIMENTO (a
    // necessidade deixa de contar como concluída, o gate volta a bloquear). Sem escrita direta.
    if (p.necessidadeId != null) {
      if (vaiReabrir) await reabrirAtendimentoNecessidade(p.necessidadeId, tx)
      else await evoluirNecessidadePorPasso(p.necessidadeId, novo, tx)
    }

    // PROGRESSÃO POR-DOCUMENTO: ao concluir uma etapa, a PRÓXIMA do MESMO documento é liberada.
    if (liberarProximo) {
      const proximo = await tx.phaseWorkflowStepInstance.findFirst({
        where: { documentoId, faseMacroKey: p.faseMacroKey, ordem: { gt: p.ordem }, status: { in: ["BLOQUEADO", "PENDENTE"] } },
        orderBy: { ordem: "asc" },
        select: { id: true, stepKey: true },
      })
      if (proximo) {
        // SLA do PASSO QUE ESTÁ SENDO ABERTO — não o do passo que acabou de fechar.
        // Com a chave do catálogo desalinhada da publicada, este lookup falhava e o
        // prazo caía no default 1 dia; e mesmo alinhado, herdar o SLA do passo anterior
        // dava 3 dias para uma espera de cartório de 15.
        const slaProximo =
          getStepDef(phaseKeyToFaseCode(p.faseMacroKey), proximo.stepKey)?.slaDays ??
          catStep?.slaDays ?? 1
        const due = new Date(now.getTime() + slaProximo * 86400000)
        await tx.phaseWorkflowStepInstance.update({
          where: { id: proximo.id },
          data: { status: "EM_ANDAMENTO", startedAt: now, prazo: due, motivo: null },
        })
        passosTocados.push(proximo.id)
        await projetarTarefaDoPasso(tx, { stepInstanceId: proximo.id, statusPasso: "EM_ANDAMENTO", agora: now })
      }
    }
    // REABERTURA: bloqueia as etapas posteriores do mesmo documento (voltam a depender desta).
    if (vaiReabrir) {
      const posteriores = await tx.phaseWorkflowStepInstance.findMany({
        where: { documentoId, faseMacroKey: p.faseMacroKey, ordem: { gt: p.ordem }, status: { in: ["EM_ANDAMENTO", "AGUARDANDO"] } },
        select: { id: true },
      })
      await tx.phaseWorkflowStepInstance.updateMany({
        where: { id: { in: posteriores.map((x) => x.id) } },
        data: { status: "BLOQUEADO", startedAt: null, prazo: null, motivo: null },
      })
      for (const posterior of posteriores) {
        passosTocados.push(posterior.id)
        await projetarTarefaDoPasso(tx, { stepInstanceId: posterior.id, statusPasso: "BLOQUEADO", agora: now })
      }
    }
    await tx.documento.update({ where: { id: documentoId }, data: { ultimaMovimentacao: now } })

    // DIÁRIO OPERACIONAL: a operação feita pela Central/drawer precisa aparecer na
    // linha do tempo do processo como qualquer outra do motor. Antes, executar um
    // passo por aqui não deixava rastro em WorkflowEvento — o histórico só existia
    // na necessidade, e a timeline do processo ficava muda sobre início e conclusão
    // de tarefa. Mesma tabela, mesmo vocabulário e mesma chave de idempotência dos
    // demais emissores; dentro da MESMA transação, então rastro e estado não podem
    // divergir.
    if (eventoDaTransicao) {
      // createMany + skipDuplicates: a chave de idempotência é única, e repetir a MESMA
      // transição no mesmo ciclo (reabrir → concluir de novo) não pode derrubar a
      // transação inteira com violação de unicidade. O rastro da reabertura fica
      // registrado pelo próprio evento PASSO_REABERTO, entre as duas conclusões.
      await tx.workflowEvento.createMany({
        skipDuplicates: true,
        data: {
          tipo: eventoDaTransicao,
          entityType: "step_instance",
          entityId: p.id,
          processoId: p.processoId,
          workflowInstanceId: p.workflowInstanceId,
          stepInstanceId: p.id,
          chaveIdempotencia: chaveEvento(eventoDaTransicao, "step_instance", p.id, novo, p.ciclo),
          dados: { documentoId, necessidadeId: p.necessidadeId, stepKey: p.stepKey, de: p.status, para: novo },
        },
      })
    }

    // AUDITORIA do ato administrativo, na MESMA transação do estado. "Forçar" só é
    // aceitável se ficar registrado quem forçou, com que motivo e com que justificativa.
    if (ctx && patch.forcar === true) {
      await tx.logAuditoria.create({
        data: {
          acao: "PASSO_FORCADO",
          entidade: "PhaseWorkflowStepInstance",
          entidadeId: p.id,
          descricao: `Conclusão FORÇADA da etapa "${p.stepKey}" do documento ${documentoId}.`,
          detalhes: {
            documentoId, processoId: p.processoId, stepKey: p.stepKey, faseMacroKey: p.faseMacroKey,
            statusAnterior: p.status, ciclo: p.ciclo,
            motivo: String(patch.motivo ?? "").trim() || null,
            justificativa: String(patch.justificativa ?? "").trim() || null,
          } as Prisma.InputJsonValue,
          usuarioId: ctx.usuarioId,
        },
      })
    }

    // TRAVA antes do commit: nenhum par passo/tarefa desta transação pode terminar
    // em estados contraditórios. Divergência ⇒ rollback integral.
    await assegurarCoerenciaPassoTarefa(tx, passosTocados)
  }

  return liberarProximo
}

/**
 * REGISTRAR ANDAMENTO de uma etapa — salvar campos de acompanhamento, adicionar
 * contato ao histórico, adicionar observação e vincular anexos, TUDO numa única
 * transação e SEM concluir nada.
 *
 * Por que é um serviço separado de `atualizarPassoV2`: aquele existe para mudar o
 * ESTADO do passo (e arrasta tarefa, necessidade, passos-irmãos e avanço de fase
 * junto). Registrar andamento não muda estado nenhum — e, exatamente por isso,
 * não pode passar pelo caminho que dispara avanço.
 *
 * Garantias:
 *   • APPEND-ONLY   — contato/observação/anexo nunca sobrescrevem os anteriores;
 *   • IDEMPOTENTE   — duplo clique e retry caem na mesma chave e não duplicam;
 *   • CONCORRÊNCIA  — lockVersion otimista: quem gravou sobre versão velha recebe
 *                     CONCURRENT_UPDATE em vez de sobrescrever o trabalho do outro;
 *   • ATÔMICO       — payload + carimbo do documento + auditoria commitam juntos.
 */
export async function registrarAndamentoPassoV2(
  documentoId: number,
  stepInstanceId: number,
  entrada: EntradaAndamento & { lockVersion?: number },
  ctx: ContextoLeituraWorkflow,
): Promise<OpResult> {
  const p = await prisma.phaseWorkflowStepInstance.findUnique({
    where: { id: stepInstanceId },
    select: {
      id: true, documentoId: true, processoId: true, faseMacroKey: true, stepKey: true,
      status: true, metadata: true, lockVersion: true, ciclo: true,
    },
  })
  if (!p || p.documentoId !== documentoId) return { ok: false, error: "STEP_NOT_FOUND", status: 404 }

  // Qual permissão exigir depende do que a entrada CONTÉM — o servidor classifica.
  const exigidas: AcaoEtapa[] = []
  if (entrada.contato != null) exigidas.push("registrar_contato")
  if (entrada.campos != null) exigidas.push("salvar_andamento")
  if (exigidas.length === 0) return { ok: false, error: "VALIDATION_ERROR", status: 422 }

  for (const acao of exigidas) {
    if (!acaoCompativelComEstado(acao, p.status)) return { ok: false, error: "STEP_NOT_AVAILABLE", status: 409 }
    if (ctx.permissoes?.[PERMISSAO_DA_ACAO[acao]] !== true) return { ok: false, error: "PERMISSION_REQUIRED", status: 403 }
  }

  // LOCK OTIMISTA contra a versão que o CLIENTE tinha em tela. Sem isto, duas
  // pessoas com o mesmo editor aberto gravariam uma por cima da outra e a que
  // perdesse não saberia. Ausente = cliente antigo; o lock do UPDATE ainda protege.
  if (entrada.lockVersion !== undefined && entrada.lockVersion !== p.lockVersion) {
    return { ok: false, error: "CONCURRENT_UPDATE", status: 409 }
  }

  const now = new Date()
  const operacaoAtual = ((p.metadata ?? {}) as { operacao?: Record<string, unknown> }).operacao ?? {}
  const r = aplicarAndamento(lerAndamento(operacaoAtual), entrada, { autorId: ctx.usuarioId, agora: now })
  if (r.erros.length > 0) return { ok: false, error: `VALIDATION_ERROR:${r.erros.join(",")}`, status: 422 }

  const nada = !r.mudou.campos && !r.mudou.contato
  // Nada mudou = reenvio idempotente. Sucesso, sem escrita e sem linha de auditoria.
  if (nada) return { ok: true, workflow: await montarWorkflowV2(documentoId, ctx) }

  // O payload guarda só o que é DO PASSO: campos de acompanhamento e contatos.
  // Anexo e observação são registro do DOCUMENTO e entram pelas rotas próprias.
  const novaOperacao = gravarAndamento(operacaoAtual, r.andamento)

  try {
    await prisma.$transaction(async (tx) => {
      // TRAVA OTIMISTA: o update só casa se lockVersion ainda for o que lemos. Duas
      // gravações concorrentes ⇒ a segunda não encontra linha e vira CONCURRENT_UPDATE.
      const escrita = await tx.phaseWorkflowStepInstance.updateMany({
        where: { id: p.id, lockVersion: p.lockVersion },
        data: {
          metadata: { operacao: novaOperacao } as Prisma.InputJsonValue,
          lockVersion: { increment: 1 },
        },
      })
      if (escrita.count !== 1) throw new ConflitoDeConcorrencia()

      await tx.documento.update({ where: { id: documentoId }, data: { ultimaMovimentacao: now } })

      await tx.logAuditoria.create({
        data: {
          acao: "PASSO_ANDAMENTO",
          entidade: "PhaseWorkflowStepInstance",
          entidadeId: p.id,
          descricao: `Andamento registrado na etapa "${p.stepKey}" do documento ${documentoId}.`,
          detalhes: {
            documentoId, processoId: p.processoId, stepKey: p.stepKey, faseMacroKey: p.faseMacroKey,
            ciclo: p.ciclo, mudou: r.mudou,
            totais: { contatos: r.andamento.contatos.length },
          } as Prisma.InputJsonValue,
          usuarioId: ctx.usuarioId,
        },
      })
    })
  } catch (e) {
    if (e instanceof ConflitoDeConcorrencia) return { ok: false, error: "CONCURRENT_UPDATE", status: 409 }
    throw e
  }

  return { ok: true, workflow: await montarWorkflowV2(documentoId, ctx) }
}

class ConflitoDeConcorrencia extends Error {}

/** Controles da operação (pausar/retomar/cancelar/invalidar) no V2 + status do documento. */
export async function controlarOperacaoV2(
  documentoId: number,
  action: string,
  observacao?: string,
  ctx?: ContextoLeituraWorkflow,
): Promise<OpResult> {
  const passos = await passosOperacaoV2(documentoId)
  if (passos.length === 0) return { ok: false, error: "Operação não encontrada", status: 404 }
  const now = new Date()
  const obs = (observacao ?? "").trim()
  if (action === "cancelar" || action === "invalidar") {
    await prisma.$transaction(async (tx) => {
      const alvos = await tx.phaseWorkflowStepInstance.findMany({
        where: { documentoId, status: { notIn: ["CONCLUIDO", "SUPERSEDIDO", "CANCELADO"] } },
        select: { id: true },
      })
      await tx.phaseWorkflowStepInstance.updateMany({
        where: { id: { in: alvos.map((x) => x.id) } },
        data: { status: "CANCELADO", cancelledAt: now },
      })
      for (const alvo of alvos) await projetarTarefaDoPasso(tx, { stepInstanceId: alvo.id, statusPasso: "CANCELADO", agora: now })
      await assegurarCoerenciaPassoTarefa(tx, alvos.map((x) => x.id))
    })
    await prisma.documento.update({
      where: { id: documentoId },
      data: action === "invalidar"
        ? { status: "INVALIDO", ultimaMovimentacao: now, motivoBloqueio: obs ? `Documento invalidado: ${obs}` : "Documento invalidado" }
        : { status: "PENDENTE", ultimaMovimentacao: now, dataInicioOperacao: null, dataPrazoOperacao: null, motivoBloqueio: obs ? `Operação cancelada: ${obs}` : "Operação cancelada" },
    })
  } else if (action === "pausar") {
    await prisma.$transaction(async (tx) => {
      const alvos = await tx.phaseWorkflowStepInstance.findMany({ where: { documentoId, status: "EM_ANDAMENTO" }, select: { id: true } })
      await tx.phaseWorkflowStepInstance.updateMany({
        where: { id: { in: alvos.map((x) => x.id) } },
        data: { status: "BLOQUEADO", motivo: obs ? `Operação pausada: ${obs}` : "Operação pausada" },
      })
      for (const alvo of alvos) await projetarTarefaDoPasso(tx, { stepInstanceId: alvo.id, statusPasso: "BLOQUEADO", agora: now })
      await assegurarCoerenciaPassoTarefa(tx, alvos.map((x) => x.id))
    })
    await prisma.documento.update({ where: { id: documentoId }, data: { ultimaMovimentacao: now, motivoBloqueio: obs ? `Operação pausada: ${obs}` : "Operação pausada" } })
  } else if (action === "retomar") {
    const primeiro = passos.find((s) => s.status === "BLOQUEADO")
    if (primeiro) {
      await prisma.$transaction(async (tx) => {
        await tx.phaseWorkflowStepInstance.update({ where: { id: primeiro.id }, data: { status: "EM_ANDAMENTO", motivo: null } })
        await projetarTarefaDoPasso(tx, { stepInstanceId: primeiro.id, statusPasso: "EM_ANDAMENTO", agora: now })
        await assegurarCoerenciaPassoTarefa(tx, [primeiro.id])
      })
    }
    await prisma.documento.update({ where: { id: documentoId }, data: { ultimaMovimentacao: now, motivoBloqueio: null } })
  } else {
    return { ok: false, error: "action inválido", status: 400 }
  }
  return { ok: true, workflow: await montarWorkflowV2(documentoId, ctx) }
}

/**
 * ESCRITA de compatibilidade: espelha no passo V2 por-documento a mudança de
 * status feita no passo legado (dual-write até o cutover). Best-effort — retorna
 * false se não houver passo V2 correspondente (documento ainda não migrado).
 * Resolve alias legado→publicado pela fonte única do catálogo. Não toca o legado.
 */
export async function sincronizarStatusPassoV2(
  documentoId: number,
  legacyStepKey: string,
  legacyStatus: string | null | undefined,
): Promise<boolean> {
  const passos = await prisma.phaseWorkflowStepInstance.findMany({
    where: { documentoId, status: { notIn: INATIVOS } },
    select: { id: true, stepKey: true, faseMacroKey: true },
  })
  const alvo = passos.find(
    (p) => p.stepKey === legacyStepKey || resolveStepKeyCompat(p.faseMacroKey, legacyStepKey) === p.stepKey,
  )
  if (!alvo) return false
  const novo = mapLegacyStepStatus(legacyStatus)
  await prisma.$transaction(async (tx) => {
    await tx.phaseWorkflowStepInstance.update({
      where: { id: alvo.id },
      data: {
        status: novo,
        ...(novo === "CONCLUIDO" ? { completedAt: new Date() } : {}),
        ...(novo === "EM_ANDAMENTO" ? { startedAt: new Date() } : {}),
      },
    })
    await projetarTarefaDoPasso(tx, { stepInstanceId: alvo.id, statusPasso: novo })
    await assegurarCoerenciaPassoTarefa(tx, [alvo.id])
  })
  return true
}

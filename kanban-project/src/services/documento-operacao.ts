// src/services/documento-operacao.ts
// FASE 3 (CP-5) — OPERAÇÃO POR-DOCUMENTO no runtime V2 ÚNICO.
// Fonte canônica: PhaseWorkflowStepInstance com documentoId setado (discriminador
// já existente). Sem model/coluna nova. Este é o ponto central: os consumidores
// (Central Operacional, completion-engine, rotas de operação, avanço de fase)
// leem/escrevem AQUI — não falam com o legado direto. Reusa o completion-engine
// (não recalcula regra — regras 9/10).

import { prazoOperacional } from "@/lib/operacional/tempo-operacional"
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
import { resolverInstanciaVigente } from "@/src/lib/process-stage/instancia-vigente-da-fase"
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
import { randomUUID } from "crypto"
import { projetarTarefaDoPasso, assegurarCoerenciaPassoTarefa } from "@/src/services/passo-tarefa-projecao"
import { transicionarPassoTx, reabrirPassoTx } from "@/src/services/task-step-sync"
import { sincronizarTarefaComWorkflow } from "@/lib/operacional/tarefa-canonica"
import { projetarCustosDocumentaisDoPasso } from "@/src/services/financeiro/projecao-documental"

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

/**
 * A TRANSIÇÃO FOI RECUSADA PELO MOTOR.
 *
 * Antes, este serviço aplicava qualquer mudança de status que lhe pedissem: um
 * `update` direto não tem opinião. Agora a precedência e o CAS valem também
 * aqui, e uma transição impossível (ou uma corrida perdida) precisa DERRUBAR a
 * transação — o documento, a necessidade e o protocolo não podem ser gravados
 * como se o passo tivesse andado.
 */
export class TransicaoDePassoRecusada extends Error {
  readonly code: string
  readonly de: string
  readonly para: string
  constructor(code: string, de: string, para: string) {
    super(`Transição de passo recusada pelo motor (${de} → ${para}): ${code}`)
    this.name = "TransicaoDePassoRecusada"
    this.code = code; this.de = de; this.para = para
  }
}

/** Estados de tarefa que significam trabalho CONCLUÍDO (não cancelado). */
const TAREFA_ENCERRADA_OK = new Set<string>(["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI"])

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
 * A VISITA ATUAL DO DOCUMENTO — processo, fase atual e INSTÂNCIA VIGENTE dela.
 *
 * A fase sozinha não basta como escopo. Um documento acumula passos de várias fases
 * ao longo da vida (localizar_registro na Genealogia, depois solicitar/receber/… na
 * Emissão) e, desde que o motor passou a suportar reentrada, acumula também vários
 * CICLOS da MESMA fase: voltar para uma fase abre uma visita nova, com passos novos,
 * e os da visita anterior continuam no banco — de propósito, porque são histórico.
 *
 * Escopar só por fase misturava as duas visitas: o Abellan mostrava 7 etapas ("1.
 * Solicitar" duas vezes) e 61% numa fase que a Central, corretamente escopada por
 * instância, mostrava como 5 etapas e 44%. Duas contas para a mesma pergunta.
 *
 * A instância vigente vem do resolvedor CANÔNICO — o mesmo que a Central usa. Aqui
 * não se decide qual é a visita atual; pergunta-se a quem decide.
 */
export interface VisitaDoDocumento {
  processoId: number
  faseMacroKey: string
  workflowInstanceId: number
  ciclo: number
}

export async function visitaAtualDoDocumento(documentoId: number): Promise<VisitaDoDocumento | null> {
  const doc = await prisma.documento.findUnique({
    where: { id: documentoId },
    select: { pessoa: { select: { arvore: { select: { processos: { select: { id: true, faseAtualKey: true } } } } } } },
  })
  const processo = doc?.pessoa?.arvore?.processos?.[0]
  if (!processo?.faseAtualKey) return null
  const inst = await resolverInstanciaVigente(processo.id, processo.faseAtualKey)
  if (!inst) return null
  return { processoId: processo.id, faseMacroKey: processo.faseAtualKey, workflowInstanceId: inst.id, ciclo: inst.ciclo }
}

/** Fase ATUAL persistida do processo do documento. Escopo de último recurso. */
async function faseAtualKeyDoDoc(documentoId: number): Promise<string | null> {
  const doc = await prisma.documento.findUnique({
    where: { id: documentoId },
    select: { pessoa: { select: { arvore: { select: { processos: { select: { faseAtualKey: true } } } } } } },
  })
  return doc?.pessoa?.arvore?.processos?.[0]?.faseAtualKey ?? null
}

/**
 * O FILTRO DE ESCOPO da leitura operacional de um documento, em ordem de precisão:
 * instância vigente (fase + visita) → fase atual → nada. O último caso é o documento
 * sem processo: aí não há visita para escopar, e ler tudo é o comportamento honesto.
 */
async function escopoDaVisita(documentoId: number): Promise<{ where: Record<string, unknown>; visita: VisitaDoDocumento | null }> {
  const visita = await visitaAtualDoDocumento(documentoId)
  if (visita) return { where: { workflowInstanceId: visita.workflowInstanceId }, visita }
  const faseAtualKey = await faseAtualKeyDoDoc(documentoId)
  return { where: faseAtualKey ? { faseMacroKey: faseAtualKey } : {}, visita: null }
}

/** Passos operacionais V2 de UM documento NA VISITA ATUAL (ativos), ordenados. */
export async function passosOperacaoV2(documentoId: number): Promise<PassoOperacaoV2[]> {
  const { where: escopo } = await escopoDaVisita(documentoId)
  const rows = await prisma.phaseWorkflowStepInstance.findMany({
    // Escopo à VISITA ATUAL (instância da fase), não só à fase: passos de fases
    // anteriores E de ciclos anteriores da mesma fase são histórico, não trabalho a
    // fazer. Sem processo/instância, cai no escopo de fase e, por fim, no antigo.
    where: { documentoId, status: { notIn: INATIVOS }, ...escopo },
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

/** Documento já tem operação por-documento NA VISITA ATUAL no V2? (discrimina V2 ×
 *  fallback legado E impede "operação já existe" por causa de fase — ou de ciclo —
 *  anterior: numa reentrada, a visita nova começa sem operação até ser materializada.) */
export async function temOperacaoV2(documentoId: number): Promise<boolean> {
  const { where: escopo } = await escopoDaVisita(documentoId)
  const n = await prisma.phaseWorkflowStepInstance.count({ where: { documentoId, ...escopo } })
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
  /**
   * DE QUAL VISITA este roteiro está falando. Sem isto, "7 etapas" e "5 etapas" eram
   * indistinguíveis do lado de fora: não havia como uma tela, um teste ou um log
   * afirmarem qual instância/ciclo produziu a lista. É contrato de diagnóstico, não
   * detalhe interno — a UI não precisa desenhá-lo, mas precisa poder prová-lo.
   */
  workflowInstanceId: number | null
  ciclo: number | null
  /** A etapa atual DESTA visita — nunca escolhida por nome ou por id maior. */
  currentStepId: number | null
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
  // A ETAPA ATUAL sai da própria lista já escopada: a primeira não-terminal na ordem.
  // Resolver por stepKey, por updatedAt ou pelo maior id atravessaria visitas.
  const atual = passos.find((p) => !["CONCLUIDO", "DISPENSADO"].includes(p.status)) ?? null
  const visita = await visitaAtualDoDocumento(documentoId)
  return {
    id: `v2-${documentoId}-${faseMacroKey}${visita ? `-c${visita.ciclo}` : ""}`,
    documentoId, faseCode, status: concluido ? "concluido" : "em_andamento", progress, steps,
    workflowInstanceId: visita?.workflowInstanceId ?? null,
    ciclo: visita?.ciclo ?? null,
    currentStepId: atual?.id ?? null,
  }
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
  // A INSTÂNCIA É A VIGENTE, pelo resolvedor canônico — a mesma regra da leitura e da
  // Central. Uma segunda regra aqui significaria materializar numa visita e ler de
  // outra, que é a divergência que esta rodada está fechando.
  const vigente = await resolverInstanciaVigente(processo.id, faseMacroKey)
  const inst = vigente
    ? await prisma.phaseWorkflowInstance.findUnique({
        where: { id: vigente.id }, select: { id: true, ciclo: true, workflowDefinitionId: true },
      })
    : null
  if (!inst) return { ok: false, error: "Instância V2 da fase não encontrada (processo não migrado)", status: 422 }
  const catSteps = getFase(faseCode).steps
  const now = new Date()
  // O prazo nasce da conta CANÔNICA (dias úteis), não de uma soma em
  // milissegundos: era ela que dava a este caminho um prazo diferente do que a
  // materialização de passos daria para o mesmo SLA.
  const firstDue = opts.dataPrazoInicial ?? prazoOperacional(catSteps[0].slaDays, now)
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
  /** Discrimina a TENTATIVA na chave do evento: reabrir e reconcluir o mesmo
   *  passo, no mesmo ciclo, é outra passagem — não um evento repetido. */
  lockVersion: number
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
  // A RECUSA DO MOTOR VIRA 409, não 500. Uma transição impossível (o passo mudou
  // de estado enquanto a tela estava aberta, ou o alvo não existe a partir do
  // estado atual) é conflito de estado, e quem opera precisa ler isso e
  // recarregar — não um erro interno genérico.
  let liberarProximo: boolean
  try {
    liberarProximo = await prisma.$transaction((tx) => aplicarTransicaoDoPassoTx(tx, p, patch, ctx, now))
  } catch (e) {
    if (e instanceof TransicaoDePassoRecusada) {
      return { ok: false, error: e.code === "CONFLITO" ? "CONCURRENT_UPDATE" : "STEP_TRANSITION_REJECTED", status: 409 }
    }
    throw e
  }

  // CONCLUSÃO DA FASE E AVANÇO — automáticos, e no serviço, não na rota. Concluir a
  // última obrigação da fase é o que a conclui; quem concluiu por outro caminho (job,
  // sincronização de tarefa, script) tem de disparar o mesmo avanço. Deixar isso na
  // rota HTTP fazia o comportamento depender de por onde a conclusão entrou.
  // Idempotente e gated pelo BlockingEngine: sem todas as obrigatórias feitas, não anda.
  // Fora da transação de propósito: o avanço abre a sua própria.
  if (liberarProximo) {
    // PROJEÇÃO FINANCEIRA DOCUMENTAL — mesma razão de estar aqui e não na rota: o
    // efeito não pode depender de por onde a conclusão entrou. Roda ANTES do
    // avanço porque o custo pertence ao documento que acabou de ser localizado,
    // não à fase seguinte. Post-commit e isolado: o passo já está concluído e uma
    // falha aqui não o desfaz — o evento `step.concluido` na fila reprocessa
    // (idempotente pela chave única da obrigação).
    await projetarCustosDocumentaisSeCouber(stepInstanceId)
    await avancarFaseSeCouber(documentoId)
  }

  return { ok: true, workflow: await montarWorkflowV2(documentoId, ctx) }
}

/**
 * Projeta os custos documentais do passo recém-concluído. O serviço decide
 * sozinho se ESTE passo autoriza projeção (passo registral + registro localizado
 * pela régua oficial) — aqui não há nenhuma regra, só o disparo.
 */
export async function projetarCustosDocumentaisSeCouber(stepInstanceId: number): Promise<void> {
  try {
    await projetarCustosDocumentaisDoPasso(stepInstanceId)
  } catch (e) {
    console.error("[projeção documental] erro ao projetar custos do passo:", e)
  }
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

  // OS CAMPOS DOCUMENTAIS — o que é DESTE domínio e não da máquina de estados:
  // o diário da operação, quem responde, o prazo combinado e o motivo do bloqueio.
  // Eles viajam JUNTO com a transição, na mesma escrita, via `extra`.
  const camposDocumentais: Record<string, unknown> = {
    metadata: { operacao: opPatch } as Prisma.InputJsonValue,
    ...(patch.assigneeId !== undefined ? { responsavelId: (patch.assigneeId as number | null) } : {}),
    ...(patch.dueAt !== undefined ? { prazo: patch.dueAt ? new Date(patch.dueAt as string) : null } : {}),
    ...(patch.motivoBloqueio !== undefined ? { motivo: patch.motivoBloqueio as string | null } : {}),
  }
  const correlationId = randomUUID()
  const opts = { correlationId, operacao: "documento-operacao", ciclo: p.ciclo, processoId: p.processoId, workflowInstanceId: p.workflowInstanceId }

  // TRANSACIONAL (P3): passo + necessidade + passos-irmãos + documento na MESMA transação —
  // a reabertura NÃO deixa estados intermediários inconsistentes (progresso/bloqueio caem juntos).
  {
    // A TRANSIÇÃO É DO MOTOR; A CARGA DOCUMENTAL É DAQUI.
    //
    // Este `update` direto era a terceira família de transições: sem validar
    // precedência, sem CAS por lockVersion e emitindo o evento por conta
    // própria mais abaixo. Concluir a mesma etapa pela Central e pela fila de
    // tarefas passava por duas máquinas diferentes.
    //
    // Agora só o VERBO muda de dono. Metadata, protocolo, responsável, prazo e
    // motivo continuam sendo decididos aqui e entram na MESMA escrita.
    if (novo === p.status) {
      // Sem mudança de estado não há transição — é atualização documental pura
      // (trocar responsável, anotar o protocolo). Passar isso pelo motor
      // inventaria um evento onde não houve fato.
      await tx.phaseWorkflowStepInstance.update({ where: { id: p.id }, data: camposDocumentais })
    } else if (vaiReabrir) {
      // Retrabalho é a única descida permitida, e tem porta própria.
      const r = await reabrirPassoTx(tx, p.id, novo as "PENDENTE" | "DISPONIVEL" | "EM_ANDAMENTO", { ...opts, extra: camposDocumentais })
      if (!r.changed && r.code) throw new TransicaoDePassoRecusada(r.code, p.status, novo)
    } else {
      const r = await transicionarPassoTx(tx, p.id, novo, {
        ...opts,
        extra: camposDocumentais,
        ...(EVENTO_POR_STATUS[novo] ? { tipoEvento: EVENTO_POR_STATUS[novo] } : {}),
      })
      if (!r.changed && r.code) throw new TransicaoDePassoRecusada(r.code, p.status, novo)
    }

    // A TAREFA É PROJEÇÃO DO PASSO. Esta transação escrevia só o passo e deixava a
    // tarefa como estava: em produção o passo "Localizar registro da certidão" ficou
    // CONCLUIDO com a tarefa NAO_INICIADA. Projeção pelo mapeamento OFICIAL, na mesma
    // transação — os dois estados nascem e mudam juntos, ou nenhum muda.
    const passosTocados = [p.id]

    // A TAREFA É DERIVADA DE TODAS AS SUAS ETAPAS — não desta.
    //
    // `projetarTarefaDoPasso` mapeia 1:1 (passo CONCLUIDO → tarefa
    // CONCLUIDO_RECEBIDO), e isso estava certo quando a tarefa ERA o passo.
    // Hoje uma tarefa carrega N etapas: concluir "Solicitar certidão" pela
    // Central encerrava o pedido de certidão inteiro na primeira etapa — a
    // tarefa sumia da fila com quatro etapas por fazer.
    //
    // A conta de "o trabalho acabou" é a mesma que a fila, o reconciliador e a
    // porta de tarefa usam. Só quando ela dá terminal é que a projeção conclui.
    const tarefaDoPasso = await tx.tarefa.findFirst({
      where: { workflowStepInstanceId: p.id },
      select: { id: true },
    })
    let projecao: { changed: boolean; tarefaId: number | null; de: string | null; para: string | null } =
      { changed: false, tarefaId: null, de: null, para: null }
    if (tarefaDoPasso) {
      const r = await sincronizarTarefaComWorkflow(tx, tarefaDoPasso.id, now)
      projecao = { changed: r.mudou, tarefaId: tarefaDoPasso.id, de: null, para: r.status }
    } else {
      // Passo sem tarefa vinculada: o mapeamento direto continua correto — não
      // há workflow de tarefa a derivar.
      projecao = await projetarTarefaDoPasso(tx, { stepInstanceId: p.id, statusPasso: novo })
    }

    // A CONCLUSÃO DA TAREFA TAMBÉM É UM FATO DO WORKFLOW.
    //
    // A projeção move a tarefa mas não emite evento — é o contrato dela. O
    // resultado é que concluir a ÚLTIMA etapa por aqui encerrava a tarefa em
    // SILÊNCIO, enquanto encerrá-la pela porta de tarefa ou por `concluirPasso`
    // gravava `TAREFA_CONCLUIDA`. O mesmo fato existia ou não no histórico
    // conforme a porta usada — e o relatório de produtividade via um universo
    // diferente do que a Central via.
    //
    // Mesma chave e mesmo vocabulário dos demais emissores; `skipDuplicates`
    // porque reconcluir no mesmo ciclo não pode derrubar a transação.
    if (projecao.changed && projecao.tarefaId != null && TAREFA_ENCERRADA_OK.has(projecao.para ?? "")) {
      const t = await tx.tarefa.findUnique({ where: { id: projecao.tarefaId }, select: { lockVersion: true } })
      await tx.workflowEvento.createMany({
        skipDuplicates: true,
        data: {
          tipo: "TAREFA_CONCLUIDA",
          entityType: "tarefa",
          entityId: projecao.tarefaId,
          processoId: p.processoId,
          workflowInstanceId: p.workflowInstanceId,
          tarefaId: projecao.tarefaId,
          chaveIdempotencia: chaveEvento("TAREFA_CONCLUIDA", "tarefa", projecao.tarefaId, projecao.para ?? "", p.ciclo, t?.lockVersion),
          dados: { documentoId, stepKey: p.stepKey, de: projecao.de, para: projecao.para },
        },
      })
    }

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
        // MESMA VISITA: a próxima etapa é a deste documento NESTA instância da fase.
        // Por fase apenas, um ciclo anterior podia oferecer a "próxima" etapa dele.
        where: { documentoId, workflowInstanceId: p.workflowInstanceId, ordem: { gt: p.ordem }, status: { in: ["BLOQUEADO", "PENDENTE"] } },
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
        const due = prazoOperacional(slaProximo, now)
        // QUAL é o próximo continua sendo pergunta DOCUMENTAL: os passos desta
        // fase pertencem a vários documentos, e `ativarProximoPassoTx` escopa
        // pela instância do workflow — usá-lo aqui abriria a etapa de outro
        // documento. A seleção fica; a transição vai para o motor.
        await transicionarPassoTx(tx, proximo.id, "EM_ANDAMENTO", { ...opts, extra: { prazo: due, motivo: null } })
        passosTocados.push(proximo.id)
        await projetarTarefaDoPasso(tx, { stepInstanceId: proximo.id, statusPasso: "EM_ANDAMENTO", agora: now })
      }
    }
    // REABERTURA: bloqueia as etapas posteriores do mesmo documento (voltam a depender desta).
    if (vaiReabrir) {
      const posteriores = await tx.phaseWorkflowStepInstance.findMany({
        // MESMA VISITA (ver acima): reabrir uma etapa não pode mexer noutro ciclo.
        where: { documentoId, workflowInstanceId: p.workflowInstanceId, ordem: { gt: p.ordem }, status: { in: ["EM_ANDAMENTO", "AGUARDANDO"] } },
        select: { id: true },
      })
      for (const posterior of posteriores) {
        await transicionarPassoTx(tx, posterior.id, "BLOQUEADO", { ...opts, extra: { startedAt: null, prazo: null, motivo: null } })
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
    // O EVENTO SAI DO MOTOR, não daqui. Este bloco emitia `WorkflowEvento` por
    // conta própria — o que era necessário enquanto a transição também era
    // local. Mantê-lo agora produziria o mesmo fato duas vezes no histórico.
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
  const { where: escopoControlar } = await escopoDaVisita(documentoId)
  const now = new Date()
  const obs = (observacao ?? "").trim()
  const correlationId = randomUUID()
  if (action === "cancelar" || action === "invalidar") {
    await prisma.$transaction(async (tx) => {
      const alvos = await tx.phaseWorkflowStepInstance.findMany({
        // Cancelar a operação cancela os passos da VISITA ATUAL. Sem o escopo, uma
        // etapa aberta de um ciclo antigo era cancelada junto — mexer no histórico
        // por causa de um comando sobre o presente.
        where: { documentoId, ...escopoControlar, status: { notIn: ["CONCLUIDO", "SUPERSEDIDO", "CANCELADO"] } },
        select: { id: true, ciclo: true, processoId: true, workflowInstanceId: true },
      })
      // Cancelar a operação de um documento cancela os passos dele — pelo motor,
      // que registra PASSO_CANCELADO. Antes esta era a transição mais silenciosa
      // do sistema: mudava o estado e não deixava rastro nenhum no workflow.
      for (const alvo of alvos) {
        await transicionarPassoTx(tx, alvo.id, "CANCELADO", { correlationId, operacao: "documento-controlar-cancelar", ciclo: alvo.ciclo, processoId: alvo.processoId, workflowInstanceId: alvo.workflowInstanceId, extra: { cancelledAt: now } })
      }
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
      const alvos = await tx.phaseWorkflowStepInstance.findMany({ where: { documentoId, ...escopoControlar, status: "EM_ANDAMENTO" }, select: { id: true, ciclo: true, processoId: true, workflowInstanceId: true } })
      for (const alvo of alvos) {
        await transicionarPassoTx(tx, alvo.id, "BLOQUEADO", { correlationId, operacao: "documento-controlar-pausar", ciclo: alvo.ciclo, processoId: alvo.processoId, workflowInstanceId: alvo.workflowInstanceId, extra: { motivo: obs ? `Operação pausada: ${obs}` : "Operação pausada" } })
      }
      for (const alvo of alvos) await projetarTarefaDoPasso(tx, { stepInstanceId: alvo.id, statusPasso: "BLOQUEADO", agora: now })
      await assegurarCoerenciaPassoTarefa(tx, alvos.map((x) => x.id))
    })
    await prisma.documento.update({ where: { id: documentoId }, data: { ultimaMovimentacao: now, motivoBloqueio: obs ? `Operação pausada: ${obs}` : "Operação pausada" } })
  } else if (action === "retomar") {
    const primeiro = passos.find((s) => s.status === "BLOQUEADO")
    if (primeiro) {
      await prisma.$transaction(async (tx) => {
        // BLOQUEADO → EM_ANDAMENTO é descida de precedência, e o motor a permite
        // explicitamente como restauração de bloqueio. Não é retrabalho.
        const ref = await tx.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: primeiro.id }, select: { ciclo: true, processoId: true, workflowInstanceId: true } })
        await transicionarPassoTx(tx, primeiro.id, "EM_ANDAMENTO", { correlationId, operacao: "documento-controlar-retomar", ciclo: ref.ciclo, processoId: ref.processoId, workflowInstanceId: ref.workflowInstanceId, extra: { motivo: null } })
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


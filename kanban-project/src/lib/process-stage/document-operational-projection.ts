// src/lib/process-stage/document-operational-projection.ts
//
// FONTE ÚNICA da projeção operacional de UM DOCUMENTO para o Drawer operacional.
// Agrega, numa resposta consistente, o cabeçalho do documento + o estado operacional
// resolvido pelo Workflow Interno da FASE ATIVA. Elimina o antigo fluxo de DOIS fetch
// concorrentes (documento + workflow) que fazia o Drawer piscar "Sem operação ativa"
// antes de a operação carregar.
//
// Estados explícitos (o LOADING é do frontend, enquanto esta projeção não resolve):
//   • OPERATIONAL     — existe operação materializada (workflow com passos) na fase ativa.
//   • NOT_MATERIALIZED — o resolver confirmou que NÃO há operação e informa se a criação
//                        é legítima (canStart) e qual a ação inicial do Workflow Interno.
//
// A decisão de "qual fluxo iniciar" pertence ao Workflow Interno (nextAction), NUNCA ao
// Documento.status, ao nome da fase, ao tipo documental ou a stepKey hardcoded no front.

import { prisma } from "@/lib/prisma"
import { getFase, phaseKeyToFaseCode, isFaseReady } from "./fases-catalog"
import { garantirOperacaoDocumentoV2 } from "@/src/services/documento-operacao"
import { chaveDaUnidade, normalizarUnidade, tarefasVivasDasUnidades } from "@/lib/operacional/identidade-da-tarefa"
import { estadoTemporal } from "@/lib/operacional/tempo-operacional"
import type { FaseCode } from "@prisma/client"

export type DocumentOperationalState = "OPERATIONAL" | "NOT_MATERIALIZED"

/**
 * A TAREFA CANÔNICA DESTE DOCUMENTO — a unidade operacional de trabalho.
 *
 * O cabeçalho do Drawer lia responsável, prazo e status do próprio `Documento`
 * (`responsavelId`, `dataPrazoOperacao`, `status`). São campos do REGISTRO, não
 * do trabalho: em produção o documento 2111 tinha responsável Daniela e
 * `dataPrazoOperacao` NULO, então o Drawer mostrava "SLA —" enquanto a tabela da
 * fase mostrava a mesma certidão atrasada. Três telas, três respostas.
 *
 * Agora a resposta vem de onde ela existe: a Tarefa. `null` = não há tarefa viva
 * para esta obrigação, e o Drawer diz isso em vez de inventar dono e prazo.
 */
export interface TarefaCanonicaDoDocumento {
  taskId: number
  statusTarefa: string
  responsavelId: number | null
  responsavelNome: string | null
  dataPrazo: string | null
  /** A frase única do prazo — a MESMA da tabela da fase e da Minha Fila. */
  rotuloDoPrazo: string
  atrasado: boolean
  venceHoje: boolean
  diasParaPrazo: number | null
}

export interface DocumentOperationalProjection {
  processId: string
  phaseId: string
  documentId: string
  state: DocumentOperationalState
  workflowInstanceId: string | null
  stepInstanceId: string | null
  currentStep: { key: string; label: string; status: string } | null
  nextAction: { key: string; label: string } | null
  /** A Tarefa que responde por este documento. Fonte ÚNICA de responsável/prazo/status. */
  tarefa: TarefaCanonicaDoDocumento | null
  permissions: {
    canStart: boolean
    canOperate: boolean
    canPause: boolean
    canCancel: boolean
    canInvalidate: boolean
  }
}

// Status "ativos" (legacy) de um passo do workflow por-documento — o passo em execução.
const STEP_ATIVO = new Set(["em_andamento", "aguardando_terceiro", "disponivel", "pendente"])
const STEP_CONCLUIDO = new Set(["concluida", "concluído", "dispensada", "dispensado"])

interface WfStep {
  id: number | string
  stepKey: string
  title?: string | null
  ordem?: number
  status: string
}
interface WfShape {
  id: number | string
  faseCode?: string | null
  status: string
  progress: number
  steps: WfStep[]
}

export interface DocumentProjectionResult {
  found: boolean
  document: unknown | null
  workflow: WfShape | null
  projection: DocumentOperationalProjection | null
}

/**
 * Resolve, numa passada, o cabeçalho do documento + a projeção operacional oficial.
 * Reusa `garantirOperacaoDocumentoV2` (idempotente, escopado à fase ativa) — 2 aberturas
 * do Drawer NÃO duplicam operação. Nunca cai no workflow de outra fase.
 */
export async function resolveDocumentOperationalProjection(
  documentId: number,
): Promise<DocumentProjectionResult> {
  // Cabeçalho do documento (mesmo shape do GET /api/documentos/[id]).
  const document = await prisma.documento.findUnique({
    where: { id: documentId },
    include: {
      pessoa: {
        include: {
          pai: { select: { id: true, nome: true, sobrenome: true } },
          mae: { select: { id: true, nome: true, sobrenome: true } },
        },
      },
      responsavel: { select: { id: true, nome: true, email: true } },
    },
  })

  if (!document) {
    return { found: false, document: null, workflow: null, projection: null }
  }

  // Processo + fase ativa do documento (via árvore).
  const ctx = await prisma.documento.findUnique({
    where: { id: documentId },
    select: {
      pessoa: {
        select: {
          arvore: {
            select: { processos: { select: { id: true, faseAtualKey: true }, take: 1 } },
          },
        },
      },
    },
  })
  const processo = ctx?.pessoa?.arvore?.processos?.[0] ?? null
  const faseAtualKey = processo?.faseAtualKey ?? null
  const faseCode = (phaseKeyToFaseCode(faseAtualKey) ?? null) as FaseCode | null
  const faseDef = faseCode ? getFase(faseCode) : null

  // Estado operacional oficial — materialização idempotente escopada à fase ativa.
  const { workflow, semWorkflowInterno } = await garantirOperacaoDocumentoV2(documentId)
  const wf = (workflow as unknown as WfShape | null) ?? null
  const temOperacao = !!wf && Array.isArray(wf.steps) && wf.steps.length > 0

  const passoAtivo = temOperacao
    ? wf!.steps.find((s) => STEP_ATIVO.has(String(s.status))) ??
      wf!.steps.find((s) => !STEP_CONCLUIDO.has(String(s.status))) ??
      null
    : null

  // Ação inicial do Workflow Interno (para NOT_MATERIALIZED legítimo) — 1º passo do catálogo.
  const podeMaterializar =
    faseDef?.scope === "DOCUMENTO" && !!faseCode && isFaseReady(faseCode) && !semWorkflowInterno
  const catSteps = faseCode ? getFase(faseCode).steps : []
  const acaoInicial =
    catSteps.length > 0 ? { key: catSteps[0].stepKey, label: catSteps[0].title } : null

  const state: DocumentOperationalState = temOperacao ? "OPERATIONAL" : "NOT_MATERIALIZED"

  // ────────────────────────────────────────────────────────────────────────────
  // A TAREFA CANÔNICA DESTE DOCUMENTO.
  //
  // Pela porta ÚNICA da identidade (`identidade-da-tarefa`), que normaliza a
  // unidade (documento → necessidade → pessoa → ciclo da obrigação) antes de
  // procurar. Uma consulta própria aqui seria uma segunda resposta para "qual é
  // a tarefa deste documento" — e é exatamente essa segunda resposta que já fez
  // a mesma certidão ter duas tarefas vivas.
  // ────────────────────────────────────────────────────────────────────────────
  let tarefa: TarefaCanonicaDoDocumento | null = null
  if (processo?.id != null) {
    const unidade = await normalizarUnidade(prisma, {
      processoId: processo.id,
      documentoId: documentId,
      ciclo: 1,
    })
    const t = (await tarefasVivasDasUnidades(prisma, [unidade])).get(chaveDaUnidade(unidade)) ?? null
    if (t) {
      // A RÉGUA É A CANÔNICA — a mesma frase que a tabela da fase e a Minha
      // Fila mostram sobre esta tarefa. O Drawer tinha a sua (`computeSla`),
      // e por isso conseguia dizer "—" sobre uma tarefa atrasada.
      const tempo = estadoTemporal({
        dataPrazo: t.dataPrazo,
        dataConclusao: t.dataConclusao,
        statusTarefa: t.statusTarefa,
        aguardandoTerceiro: t.statusTarefa === "AGUARDANDO_TERCEIRO" || t.statusTarefa === "AGUARDANDO_CLIENTE",
        slaPausadoEm: t.slaPausadoEm,
        slaPausaAcumuladaMin: t.slaPausaAcumuladaMin,
        criadaEm: t.criadaEm,
      })
      tarefa = {
        taskId: t.id,
        statusTarefa: t.statusTarefa,
        responsavelId: t.responsavelId,
        responsavelNome: t.responsavelNome,
        dataPrazo: t.dataPrazo?.toISOString() ?? null,
        rotuloDoPrazo: tempo.rotulo,
        atrasado: tempo.atrasado,
        venceHoje: tempo.venceHoje,
        diasParaPrazo: tempo.diasParaPrazo,
      }
    }
  }

  const currentStep = passoAtivo
    ? { key: passoAtivo.stepKey, label: String(passoAtivo.title ?? passoAtivo.stepKey), status: String(passoAtivo.status) }
    : null

  const nextAction =
    state === "OPERATIONAL"
      ? currentStep
        ? { key: currentStep.key, label: currentStep.label }
        : null
      : podeMaterializar
        ? acaoInicial
        : null

  const projection: DocumentOperationalProjection = {
    processId: String(processo?.id ?? ""),
    phaseId: faseAtualKey ?? "",
    documentId: String(documentId),
    state,
    workflowInstanceId: wf ? String(wf.id) : null,
    stepInstanceId: passoAtivo ? String(passoAtivo.id) : null,
    currentStep,
    nextAction,
    tarefa,
    // Viabilidade ESTRUTURAL (a UI ainda aplica o gate de papel via usePermissoes).
    permissions: {
      canStart: state === "NOT_MATERIALIZED" && podeMaterializar,
      canOperate: state === "OPERATIONAL",
      canPause: state === "OPERATIONAL",
      canCancel: state === "OPERATIONAL",
      canInvalidate: state === "OPERATIONAL",
    },
  }

  return { found: true, document, workflow: wf, projection }
}

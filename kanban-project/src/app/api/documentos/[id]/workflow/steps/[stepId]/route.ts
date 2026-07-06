// src/app/api/documentos/[id]/workflow/steps/[stepId]/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { recalcularFaseDoProcesso } from "@/src/lib/process-stage/recalcular-fase"

// ============================================================
// PATCH — atualiza um step (status/assignee/dueAt/notes/bloqueio/etc.)
//
// Comportamento canônico:
//
//  CONCLUSÃO (status -> "concluida", saindo de OUTRO estado):
//    - seta completedAt + completedById
//    - libera o PRÓXIMO step bloqueado (status='em_andamento', startedAt, dueAt)
//    - recalcula progress do workflow
//    - se for o último: marca workflow como concluído
//
//  RE-CONCLUSÃO (status -> "concluida", saindo de "concluida"):
//    - no-op (não libera próximo, não toca em completedAt)
//    - protege contra duplo PATCH quando o usuário re-abre o Editor Registral
//      de uma etapa já concluída
//
//  REABERTURA (status -> "em_andamento", saindo de "concluida"):
//    - limpa completedAt + completedById
//    - se houver step posterior em "em_andamento" ou "aguardando_terceiro":
//      retrocede ele pra "bloqueada" (limpa startedAt + dueAt)
//    - recalcula progress
//    - workflow volta a "em_andamento" se estava "concluido"
//
//  INÍCIO (status -> "em_andamento", saindo de "nao_iniciada" ou "bloqueada"):
//    - se startedAt ainda nulo: seta startedAt e dueAt com base no slaDays
// ============================================================

type StatusStep =
  | "nao_iniciada"
  | "bloqueada"
  | "em_andamento"
  | "aguardando_terceiro"
  | "atrasada"
  | "concluida"
  | "cancelada"

const ALLOWED_STATUS: StatusStep[] = [
  "nao_iniciada",
  "bloqueada",
  "em_andamento",
  "aguardando_terceiro",
  "atrasada",
  "concluida",
  "cancelada",
]

interface PatchBody {
  status?: StatusStep
  assigneeId?: number | null
  dueAt?: string | null
  notes?: string | null
  motivoBloqueio?: string | null
  trackingCode?: string | null
  externalProtocol?: string | null
  requestChannel?: string | null
  reviewResult?: string | null
  validationResult?: string | null
  completedById?: number | null

  // Rodada 9 — Solicitar certidão (cartório/atendente + cobrança)
  externalEntityName?: string | null
  costPaid?: number | null
  paymentMethod?: string | null

  // Rodada 12 — Receber + Conferir + Validar
  documentMedium?: string | null
  physicalLocation?: string | null
  reviewChecklist?: Record<string, boolean> | null
  stepObservation?: string | null
  legalOpinion?: string | null
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  try {
    const { id, stepId } = await params
    const documentoId = parseInt(id)
    const stepIdNum = parseInt(stepId)
    if (isNaN(documentoId) || isNaN(stepIdNum)) {
      return NextResponse.json({ error: "IDs inválidos" }, { status: 400 })
    }

    const body = (await request.json()) as PatchBody

    // -- Busca o step + workflow
    const step = await prisma.workflowStep.findUnique({
      where: { id: stepIdNum },
      include: {
        workflow: { select: { id: true, documentoId: true } },
      },
    })
    if (!step) {
      return NextResponse.json({ error: "Step não encontrado" }, { status: 404 })
    }
    if (step.workflow.documentoId !== documentoId) {
      return NextResponse.json({ error: "Step não pertence a este documento" }, { status: 400 })
    }

    // -- Valida status novo (se enviado)
    if (body.status !== undefined && !ALLOWED_STATUS.includes(body.status)) {
      return NextResponse.json({ error: "Status inválido" }, { status: 400 })
    }

    const now = new Date()
    const updateData: Prisma.WorkflowStepUpdateInput = {}

    // ============================================================
    // SNAPSHOTS DO ESTADO ATUAL (antes do update)
    // ============================================================
    const statusAnterior = step.status as StatusStep
    const eraConcluida = statusAnterior === "concluida"
    const vaiSerConcluida = body.status === "concluida"
    const vaiSerReaberta = eraConcluida && body.status === "em_andamento"

    // ============================================================
    // GATES — proteção contra ações inconsistentes
    // ============================================================

    // Gate 1: re-conclusão é NO-OP no que toca a workflow
    // (apenas campos auxiliares como notes/dueAt/etc são salvos)
    const isReConclusao = vaiSerConcluida && eraConcluida

    // Gate 2: liberar próximo step só na PRIMEIRA conclusão
    const liberarProximo = vaiSerConcluida && !eraConcluida

    // ============================================================
    // ✅ HOTFIX — GATE DE CONCLUSÃO REAL (tarefa ≠ passo)
    // Concluir a etapa exige que a condição REAL tenha sido cumprida —
    // não basta clicar "concluir". Sem isso, o passo ia a "concluída"
    // (e o workflow a 100%) com o documento ainda pendente.
    // Só barra na PRIMEIRA conclusão (não em re-conclusão/reabertura).
    // ============================================================
    if (liberarProximo) {
      const bloqueioConclusao = await checarConclusaoDoPasso(step.stepKey, documentoId)
      if (bloqueioConclusao) {
        return NextResponse.json({ error: bloqueioConclusao }, { status: 422 })
      }
    }

    // -- Campos simples (whitelist)
    if (body.assigneeId !== undefined) {
      updateData.assignee = body.assigneeId
        ? { connect: { id: body.assigneeId } }
        : { disconnect: true }
    }
    if (body.dueAt !== undefined) updateData.dueAt = body.dueAt ? new Date(body.dueAt) : null
    if (body.notes !== undefined) updateData.notes = body.notes
    if (body.motivoBloqueio !== undefined) updateData.motivoBloqueio = body.motivoBloqueio
    if (body.trackingCode !== undefined) updateData.trackingCode = body.trackingCode
    if (body.externalProtocol !== undefined) updateData.externalProtocol = body.externalProtocol
    if (body.requestChannel !== undefined) updateData.requestChannel = body.requestChannel
    if (body.reviewResult !== undefined) updateData.reviewResult = body.reviewResult
    if (body.validationResult !== undefined) updateData.validationResult = body.validationResult

    // ============================================================
    // ✅ Rodada 9 — Solicitar certidão (cartório/atendente + cobrança)
    // ============================================================
    if (body.externalEntityName !== undefined) updateData.externalEntityName = body.externalEntityName
    if (body.costPaid !== undefined) updateData.costPaid = body.costPaid
    if (body.paymentMethod !== undefined) updateData.paymentMethod = body.paymentMethod

    // ============================================================
    // ✅ NOVO (rodada 12) — Receber + Conferir + Validar
    // ============================================================
    if (body.documentMedium !== undefined) updateData.documentMedium = body.documentMedium
    if (body.physicalLocation !== undefined) updateData.physicalLocation = body.physicalLocation
    if (body.reviewChecklist !== undefined) {
      // Prisma JSON field aceita objeto direto OU Prisma.JsonNull pra clear
      updateData.reviewChecklist =
        body.reviewChecklist === null
          ? null as unknown as Prisma.InputJsonValue
          : (body.reviewChecklist as Prisma.InputJsonValue)
    }
    if (body.stepObservation !== undefined) updateData.stepObservation = body.stepObservation
    if (body.legalOpinion !== undefined) updateData.legalOpinion = body.legalOpinion

    // ============================================================
    // LÓGICA DE TRANSIÇÃO DE STATUS
    // ============================================================
    if (body.status !== undefined) {
      // Re-conclusão: NÃO sobrescreve status, NÃO mexe em completedAt
      if (!isReConclusao) {
        updateData.status = body.status
      }

      // INÍCIO: marca startedAt + dueAt se for primeira vez ativando
      if (
        body.status === "em_andamento" &&
        !step.startedAt &&
        !vaiSerReaberta
      ) {
        updateData.startedAt = now
        if (!step.dueAt) {
          updateData.dueAt = new Date(now.getTime() + step.slaDays * 86400000)
        }
      }

      // CONCLUSÃO (primeira vez): marca completedAt + completedById
      if (vaiSerConcluida && !eraConcluida) {
        updateData.completedAt = now
        if (body.completedById !== undefined && body.completedById !== null) {
          updateData.completedBy = { connect: { id: body.completedById } }
        }
      }

      // REABERTURA: limpa completedAt e completedById
      if (vaiSerReaberta) {
        updateData.completedAt = null
        updateData.completedBy = { disconnect: true }
        // startedAt original é preservado (não foi reiniciada — só re-aberta)
      }
    }

    // -- Aplica a atualização no step
    await prisma.workflowStep.update({
      where: { id: stepIdNum },
      data: updateData,
    })

    // ============================================================
    // EFEITOS COLATERAIS — só quando faz sentido
    // ============================================================

    // CONCLUSÃO PRIMEIRA VEZ: lock-step + libera próximo
    if (liberarProximo) {
      // ============================================================
      // ✅ LOCK-STEP — documentos do mesmo processo andam juntos
      // ============================================================
      // Regra: ao concluir a etapa N de um doc, o próximo step (N+1)
      // só é liberado se TODOS os outros docs do mesmo processo
      // também já concluíram a etapa N.
      //
      // Se algum doc irmão ainda não concluiu N → o próximo step
      // do doc atual fica BLOQUEADO com motivo "aguardando irmãos".
      //
      // Quando o último doc irmão concluir N → essa rota é chamada
      // por ele e libera N+1 em TODOS os docs do processo de uma vez.
      //
      // Docs ignorados na conta:
      //   - status CANCELADO ou INVALIDO (não fazem parte do lote)
      //   - sem workflow criado (ainda não iniciaram operação)
      // ============================================================

      // 1. Próximo step DESTE doc (potencial liberação/bloqueio)
      const proximo = await prisma.workflowStep.findFirst({
        where: {
          workflowId: step.workflowId,
          status: "bloqueada",
          motivoBloqueio: null,
          ordem: { gt: step.ordem },
        },
        orderBy: { ordem: "asc" },
      })

      if (proximo) {
        // 2. Achar processo(s) deste doc (via doc → pessoa → arvore → processos)
        const docComProcesso = await prisma.documento.findUnique({
          where: { id: documentoId },
          select: {
            pessoa: {
              select: {
                arvore: {
                  select: { processos: { select: { id: true } } },
                },
              },
            },
          },
        })

        const processoIds = docComProcesso?.pessoa?.arvore?.processos.map(p => p.id) ?? []

        // 3. Buscar docs irmãos ATIVOS com workflow + step da mesma ordem N
        const docsIrmaos = await prisma.documento.findMany({
          where: {
            id: { not: documentoId },
            pessoa: {
              arvore: { processos: { some: { id: { in: processoIds } } } },
            },
            status: { notIn: ["CANCELADO", "INVALIDO"] },
            workflows: { some: { status: { notIn: ["arquivado", "cancelado"] } } },
          },
          select: {
            id: true,
            workflows: {
              where: { status: { notIn: ["arquivado", "cancelado"] } },
              select: {
                steps: {
                  where: { ordem: step.ordem },
                  select: { status: true },
                },
              },
            },
          },
        })

        // 4. Todos os irmãos concluíram a etapa N?
        const todosConcluiramOrdemN = docsIrmaos.every(d => {
          const stepN = d.workflows[0]?.steps[0]
          return stepN?.status === "concluida"
        })

        // Prefixo do motivo gerado pelo lock-step (usado pra distinguir
        // de bloqueios manuais do usuário e poder limpar depois)
        const LOCK_STEP_PREFIX = "Aguardando outros documentos do processo"

        if (todosConcluiramOrdemN) {
          // ✅ TODOS concluíram → libera N+1 em TODOS (eu + irmãos travados)

          // 4a. Libera meu próximo
          await prisma.workflowStep.update({
            where: { id: proximo.id },
            data: {
              status: "em_andamento",
              startedAt: now,
              dueAt: new Date(now.getTime() + proximo.slaDays * 86400000),
            },
          })

          // 4b. Libera próximo step dos irmãos que estavam travados pelo lock-step
          //     OU bloqueados sem motivo (não tinham chegado ainda)
          //     Preserva bloqueios manuais do usuário (motivo customizado)
          const proximosIrmaos = await prisma.workflowStep.findMany({
            where: {
              workflow: {
                documentoId: { in: docsIrmaos.map(d => d.id) },
                status: { notIn: ["arquivado", "cancelado"] },
              },
              ordem: proximo.ordem,
              status: "bloqueada",
              OR: [
                { motivoBloqueio: null },
                { motivoBloqueio: { startsWith: LOCK_STEP_PREFIX } },
              ],
            },
          })

          await Promise.all(
            proximosIrmaos.map(p =>
              prisma.workflowStep.update({
                where: { id: p.id },
                data: {
                  status: "em_andamento",
                  startedAt: now,
                  dueAt: new Date(now.getTime() + p.slaDays * 86400000),
                  motivoBloqueio: null,
                },
              })
            )
          )
        } else {
          // ⏸ Falta irmão → meu próximo fica BLOQUEADO com motivo
          await prisma.workflowStep.update({
            where: { id: proximo.id },
            data: {
              status: "bloqueada",
              motivoBloqueio: `${LOCK_STEP_PREFIX} concluírem a etapa ${step.ordem} (${step.title})`,
            },
          })
        }
      }

      await recalcularProgressoWorkflow(step.workflowId, now)
    }

    // REABERTURA: retrocede TODOS os próximos steps ativos + recalcula
    // (usa updateMany para auto-corrigir estados quebrados — múltiplas
    //  etapas ativas simultaneamente — sem mexer em concluídas posteriores)
    if (vaiSerReaberta) {
      await prisma.workflowStep.updateMany({
        where: {
          workflowId: step.workflowId,
          status: { in: ["em_andamento", "aguardando_terceiro", "atrasada"] },
          ordem: { gt: step.ordem },
        },
        data: {
          status: "bloqueada",
          startedAt: null,
          dueAt: null,
          motivoBloqueio: null,
        },
      })

      await recalcularProgressoWorkflow(step.workflowId, now)
    }

    // ============================================================
    // ✅ GANCHO DE AVANÇO DE FASE (Parte 2)
    // Só faz sentido quando uma etapa foi concluída (liberarProximo).
    // Se a conclusão fechou o workflow da fase, o motor avança o card.
    // Idempotente e seguro: se nada mudou, não faz nada.
    // ============================================================
    if (liberarProximo) {
      try {
        const r = await recalcularFaseDoProcesso(documentoId)
        if (r.mudou) {
          console.log(`[avanço de fase] doc ${documentoId}: ${r.faseAnterior} → ${r.faseNova}`)
        }
      } catch (e) {
        // Não derruba a conclusão do step se o avanço falhar — só loga.
        console.error("[avanço de fase] erro ao recalcular:", e)
      }
    }

    // -- Marca movimento no documento
    await prisma.documento.update({
      where: { id: documentoId },
      data: { ultimaMovimentacao: now },
    })

    // -- Retorna o workflow completo atualizado
    const workflow = await prisma.workflow.findFirst({
      where: { documentoId, status: { notIn: ["arquivado", "cancelado"] } },
      orderBy: { createdAt: "desc" },
      include: {
        steps: {
          orderBy: { ordem: "asc" },
          include: {
            assignee: { select: { id: true, nome: true, email: true } },
            completedBy: { select: { id: true, nome: true, email: true } },
          },
        },
      },
    })

    return NextResponse.json({ workflow })
  } catch (error) {
    console.error("[PATCH /api/documentos/[id]/workflow/steps/[stepId]]", error)
    return NextResponse.json(
      { error: "Erro ao atualizar step" },
      { status: 500 }
    )
  }
}

// ============================================================
// HELPER: recalcula progress + status do workflow
// ============================================================
async function recalcularProgressoWorkflow(workflowId: number, now: Date) {
  const allSteps = await prisma.workflowStep.findMany({
    where: { workflowId },
    select: { weight: true, status: true },
  })

  const totalWeight = allSteps.reduce((acc, s) => acc + s.weight, 0)
  const doneWeight = allSteps
    .filter((s) => s.status === "concluida")
    .reduce((acc, s) => acc + s.weight, 0)
  const progress = totalWeight > 0 ? Math.round((doneWeight / totalWeight) * 100) : 0

  const todosConcluidos = allSteps.every(
    (s) => s.status === "concluida" || s.status === "cancelada"
  )

  await prisma.workflow.update({
    where: { id: workflowId },
    data: {
      progress,
      status: todosConcluidos ? "concluido" : "em_andamento",
      completedAt: todosConcluidos ? now : null,
    },
  })
}

// ============================================================
// ✅ HOTFIX — condição REAL de conclusão por etapa
// Retorna mensagem de erro se a etapa NÃO pode ser concluída ainda,
// ou null se pode. Passos sem regra aqui seguem com conclusão manual
// (comportamento antigo) — só travamos onde faz sentido.
// ============================================================
async function checarConclusaoDoPasso(
  stepKey: string,
  documentoId: number
): Promise<string | null> {
  switch (stepKey) {
    // GENEALOGIA — "Buscar documento": localizar o ato e preencher os
    // dados registrais. Só conclui quando o documento tem esses dados
    // preenchidos (= o ato foi de fato localizado no cartório).
    case "buscar_documento": {
      const doc = await prisma.documento.findUnique({
        where: { id: documentoId },
        select: {
          cartorio: true,
          numero_registro: true,
          livro: true,
          folha: true,
          termo: true,
          data_registro: true,
        },
      })
      const localizado = !!(
        doc &&
        (doc.cartorio ||
          doc.numero_registro ||
          doc.livro ||
          doc.folha ||
          doc.termo ||
          doc.data_registro)
      )
      if (!localizado) {
        return 'Não dá para concluir "Buscar documento": o ato ainda não foi localizado. Preencha os dados registrais (cartório, livro/folha/termo ou nº de registro) na aba Dados Registrais antes de concluir.'
      }
      return null
    }

    default:
      return null
  }
}
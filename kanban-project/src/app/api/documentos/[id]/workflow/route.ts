// src/app/api/documentos/[id]/workflow/route.ts
//
// SUBSTITUI o arquivo atual. Mantém GET e POST exatamente como na v2,
// e adiciona PATCH para pausar/retomar/cancelar/invalidar a operação.

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { StatusDocumento } from "@prisma/client"

// ============================================================
// TEMPLATE FIXO — 6 STEPS DO WORKFLOW DOCUMENTAL
// ============================================================

const DEFAULT_STEPS = [
  { ordem: 1, stepKey: "buscar_documento",  title: "Buscar documento",                description: "Localizar o ato no cartório e preencher os dados registrais completos.",  weight: 20, ownerKey: "equipe_documental", slaDays: 5 },
  { ordem: 2, stepKey: "solicitar_certidao", title: "Solicitar certidão",              description: "Enviar requerimento ao cartório e registrar protocolo retornado.",         weight: 25, ownerKey: "daniela_brait",      slaDays: 3 },
  { ordem: 3, stepKey: "aguardar_retorno",   title: "Aguardar retorno do cartório",    description: "Aguardar resposta do cartório · follow-ups manuais e automáticos disponíveis.", weight: 10, ownerKey: "daniela_brait",  slaDays: 15 },
  { ordem: 4, stepKey: "receber_certidao",   title: "Receber certidão",                description: "Upload do PDF da certidão recebida.",                                     weight: 18, ownerKey: "daniela_brait",      slaDays: 2 },
  { ordem: 5, stepKey: "conferir_certidao",  title: "Conferir certidão",               description: "Inspeção operacional: legibilidade, integridade, dados mínimos, apostila, tradução.", weight: 15, ownerKey: "daniela_brait", slaDays: 2 },
  { ordem: 6, stepKey: "validar_certidao",   title: "Validar certidão",                description: "Decisão jurídica final · marca documento como Recebido.",                 weight: 12, ownerKey: "marco_rovatti",     slaDays: 1 },
]

const FIRST_ACTIVE_ORDEM: Record<string, number> = {
  buscar: 1, solicitar: 2, receber: 4,
}

const DOC_STATUS_BY_TIPO: Record<string, StatusDocumento> = {
  buscar: "EM_BUSCA",
  solicitar: "SOLICITAR",
  receber: "RECEBIDO",
  desnecessario: "CANCELADO",
}

// ============================================================
// GET — sem alterações
// ============================================================

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const documentoId = parseInt(id)
    if (isNaN(documentoId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const workflow = await prisma.workflow.findUnique({
      where: { documentoId },
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

    if (!workflow) return NextResponse.json({ workflow: null })
    return NextResponse.json({ workflow })
  } catch (error) {
    console.error("[GET /api/documentos/[id]/workflow]", error)
    return NextResponse.json({ error: "Erro ao buscar workflow" }, { status: 500 })
  }
}

// ============================================================
// POST — sem alterações em relação à v2
// ============================================================

interface InitBody {
  tipoOperacao: "buscar" | "solicitar" | "receber" | "desnecessario"
  responsavelId?: number | null
  dataPrazoInicial?: string | null
  prioridade?: "normal" | "urgente" | "critica"
  observacaoInicial?: string | null
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const documentoId = parseInt(id)
    if (isNaN(documentoId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const body = (await request.json()) as InitBody
    const tipo = body.tipoOperacao
    if (!tipo || !["buscar", "solicitar", "receber", "desnecessario"].includes(tipo)) {
      return NextResponse.json(
        { error: "tipoOperacao inválido. Use: buscar | solicitar | receber | desnecessario" },
        { status: 400 }
      )
    }

    const documento = await prisma.documento.findUnique({
      where: { id: documentoId },
      select: { id: true, status: true },
    })
    if (!documento) {
      return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 })
    }

    const existing = await prisma.workflow.findUnique({
      where: { documentoId },
      select: { id: true },
    })
    if (existing && tipo !== "desnecessario") {
      return NextResponse.json({ error: "Workflow já existe para este documento" }, { status: 409 })
    }

    const now = new Date()
    const prioridade = body.prioridade || "normal"
    const obs = (body.observacaoInicial || "").trim()

    if (tipo === "desnecessario") {
      await prisma.documento.update({
        where: { id: documentoId },
        data: {
          status: "CANCELADO",
          ultimaMovimentacao: now,
          motivoBloqueio: obs ? `Marcado como desnecessário: ${obs}` : "Marcado como desnecessário",
        },
      })
      return NextResponse.json({ workflow: null, status: "CANCELADO" }, { status: 200 })
    }

    const firstActiveOrdem = FIRST_ACTIVE_ORDEM[tipo]
    const firstActiveTemplate = DEFAULT_STEPS.find((s) => s.ordem === firstActiveOrdem)!
    const dueAtFromBody = body.dataPrazoInicial ? new Date(body.dataPrazoInicial) : null
    const dueAtCalc = new Date(now.getTime() + firstActiveTemplate.slaDays * 86400000)
    const dueAt = dueAtFromBody ?? dueAtCalc

    const notasIniciais: string[] = []
    if (obs) notasIniciais.push(obs)
    if (tipo === "solicitar") {
      notasIniciais.unshift("Operação iniciada como Solicitar — busca formal foi pulada.")
    }
    if (tipo === "receber") {
      notasIniciais.unshift("Operação iniciada como Recebimento — etapas de busca/solicitação/aguardo foram puladas.")
    }
    const notes = notasIniciais.join("\n\n") || null

    const workflow = await prisma.workflow.create({
      data: {
        documentoId,
        templateCode: "DOCUMENT_WORKFLOW",
        templateName: "Workflow Documental",
        status: "em_andamento",
        progress: 0,
        prioridade,
        startedAt: now,
        steps: {
          create: DEFAULT_STEPS.map((s) => {
            const isActive = s.ordem === firstActiveOrdem
            const isSkipped = s.ordem < firstActiveOrdem
            return {
              ordem: s.ordem,
              stepKey: s.stepKey,
              title: s.title,
              description: s.description,
              weight: s.weight,
              ownerKey: s.ownerKey,
              slaDays: s.slaDays,
              status: isActive ? "em_andamento" : isSkipped ? "concluida" : "bloqueada",
              startedAt: isActive || isSkipped ? now : null,
              completedAt: isSkipped ? now : null,
              dueAt: isActive ? dueAt : null,
              assigneeId: isActive ? body.responsavelId ?? null : null,
              notes: isActive ? notes : isSkipped ? "Pulada na criação do workflow." : null,
            }
          }),
        },
      },
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

    const totalWeight = DEFAULT_STEPS.reduce((acc, s) => acc + s.weight, 0)
    const doneWeight = DEFAULT_STEPS
      .filter((s) => s.ordem < firstActiveOrdem)
      .reduce((acc, s) => acc + s.weight, 0)
    const progress = Math.round((doneWeight / totalWeight) * 100)

    await prisma.workflow.update({
      where: { id: workflow.id },
      data: { progress },
    })
    workflow.progress = progress

    await prisma.documento.update({
      where: { id: documentoId },
      data: {
        status: DOC_STATUS_BY_TIPO[tipo],
        dataInicioOperacao: now,
        ultimaMovimentacao: now,
        responsavelId: body.responsavelId ?? undefined,
        dataPrazoOperacao: dueAt,
        motivoBloqueio: null,
      },
    })

    return NextResponse.json({ workflow }, { status: 201 })
  } catch (error) {
    console.error("[POST /api/documentos/[id]/workflow]", error)
    return NextResponse.json({ error: "Erro ao iniciar operação" }, { status: 500 })
  }
}

// ============================================================
// PATCH — controles da operação: pausar / retomar / cancelar / invalidar
// ============================================================

type WorkflowAction = "pausar" | "retomar" | "cancelar" | "invalidar"

interface PatchBody {
  action: WorkflowAction
  observacao?: string  // opcional, motivo da ação
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const documentoId = parseInt(id)
    if (isNaN(documentoId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const body = (await request.json()) as PatchBody
    const { action } = body

    if (!action || !["pausar", "retomar", "cancelar", "invalidar"].includes(action)) {
      return NextResponse.json(
        { error: "action inválido. Use: pausar | retomar | cancelar | invalidar" },
        { status: 400 }
      )
    }

    const workflow = await prisma.workflow.findUnique({
      where: { documentoId },
      select: { id: true, status: true },
    })
    if (!workflow) {
      return NextResponse.json({ error: "Workflow não encontrado" }, { status: 404 })
    }

    const now = new Date()
    const obs = (body.observacao || "").trim()

    // ============================================================
    // LÓGICA POR AÇÃO
    // ============================================================
    if (action === "pausar") {
      if (workflow.status !== "em_andamento") {
        return NextResponse.json(
          { error: "Só é possível pausar workflows em andamento" },
          { status: 400 }
        )
      }
      await prisma.workflow.update({
        where: { id: workflow.id },
        data: { status: "pausado" },
      })
      await prisma.documento.update({
        where: { id: documentoId },
        data: {
          ultimaMovimentacao: now,
          motivoBloqueio: obs ? `Operação pausada: ${obs}` : "Operação pausada",
        },
      })
    }

    else if (action === "retomar") {
      if (workflow.status !== "pausado") {
        return NextResponse.json(
          { error: "Só é possível retomar workflows pausados" },
          { status: 400 }
        )
      }
      await prisma.workflow.update({
        where: { id: workflow.id },
        data: { status: "em_andamento" },
      })
      await prisma.documento.update({
        where: { id: documentoId },
        data: {
          ultimaMovimentacao: now,
          motivoBloqueio: null,
        },
      })
    }

    else if (action === "cancelar") {
      // Cancela o workflow inteiro — doc volta a PENDENTE
      await prisma.workflow.update({
        where: { id: workflow.id },
        data: {
          status: "cancelado",
          cancelledAt: now,
        },
      })
      await prisma.documento.update({
        where: { id: documentoId },
        data: {
          status: "PENDENTE",
          ultimaMovimentacao: now,
          dataInicioOperacao: null,
          dataPrazoOperacao: null,
          motivoBloqueio: obs ? `Operação cancelada: ${obs}` : "Operação cancelada",
        },
      })
    }

    else if (action === "invalidar") {
      // Invalidação jurídica — doc fica como INVALIDO
      await prisma.workflow.update({
        where: { id: workflow.id },
        data: {
          status: "cancelado",
          cancelledAt: now,
        },
      })
      await prisma.documento.update({
        where: { id: documentoId },
        data: {
          status: "INVALIDO",
          ultimaMovimentacao: now,
          motivoBloqueio: obs ? `Documento invalidado: ${obs}` : "Documento invalidado",
        },
      })
    }

    // Retorna workflow atualizado
    const updated = await prisma.workflow.findUnique({
      where: { documentoId },
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

    return NextResponse.json({ workflow: updated })
  } catch (error) {
    console.error("[PATCH /api/documentos/[id]/workflow]", error)
    return NextResponse.json({ error: "Erro ao atualizar workflow" }, { status: 500 })
  }
}
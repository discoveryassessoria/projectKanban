// src/app/api/documentos/[id]/workflow/route.ts
// 
// SUBSTITUI o arquivo inteiro existente.
// Adicionado suporte ao body { tipoOperacao, responsavelId, dataPrazoInicial, prioridade, observacaoInicial }

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { StatusDocumento } from "@prisma/client"

// ============================================================
// TEMPLATE FIXO — 6 STEPS DO WORKFLOW DOCUMENTAL
// (espelho do mockup linhas 5609-5618)
// ============================================================

const DEFAULT_STEPS = [
  {
    ordem: 1,
    stepKey: "buscar_documento",
    title: "Buscar documento",
    description: "Localizar o ato no cartório e preencher os dados registrais completos.",
    weight: 20,
    ownerKey: "equipe_documental",
    slaDays: 5,
  },
  {
    ordem: 2,
    stepKey: "solicitar_certidao",
    title: "Solicitar certidão",
    description: "Enviar requerimento ao cartório e registrar protocolo retornado.",
    weight: 25,
    ownerKey: "daniela_brait",
    slaDays: 3,
  },
  {
    ordem: 3,
    stepKey: "aguardar_retorno",
    title: "Aguardar retorno do cartório",
    description: "Aguardar resposta do cartório · follow-ups manuais e automáticos disponíveis.",
    weight: 10,
    ownerKey: "daniela_brait",
    slaDays: 15,
  },
  {
    ordem: 4,
    stepKey: "receber_certidao",
    title: "Receber certidão",
    description: "Upload do PDF da certidão recebida.",
    weight: 18,
    ownerKey: "daniela_brait",
    slaDays: 2,
  },
  {
    ordem: 5,
    stepKey: "conferir_certidao",
    title: "Conferir certidão",
    description: "Inspeção operacional: legibilidade, integridade, dados mínimos, apostila, tradução.",
    weight: 15,
    ownerKey: "daniela_brait",
    slaDays: 2,
  },
  {
    ordem: 6,
    stepKey: "validar_certidao",
    title: "Validar certidão",
    description: "Decisão jurídica final · marca documento como Recebido.",
    weight: 12,
    ownerKey: "marco_rovatti",
    slaDays: 1,
  },
]

// ============================================================
// MAPA: tipoOperacao → ordem da PRIMEIRA etapa ativa
// As etapas anteriores ficam "concluida" (puladas com nota)
// ============================================================

const FIRST_ACTIVE_ORDEM: Record<string, number> = {
  buscar: 1,
  solicitar: 2,
  receber: 4,
}

// Status do documento conforme o tipo de operação iniciada
const DOC_STATUS_BY_TIPO: Record<string, StatusDocumento> = {
  buscar: "EM_BUSCA",
  solicitar: "SOLICITAR",
  receber: "RECEBIDO",
  desnecessario: "CANCELADO",
}

// ============================================================
// GET — busca o workflow do documento (sem alteração)
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

    if (!workflow) {
      return NextResponse.json({ workflow: null })
    }

    return NextResponse.json({ workflow })
  } catch (error) {
    console.error("[GET /api/documentos/[id]/workflow]", error)
    return NextResponse.json(
      { error: "Erro ao buscar workflow" },
      { status: 500 }
    )
  }
}

// ============================================================
// POST — cria workflow conforme tipoOperacao escolhido no modal
// ============================================================

interface InitBody {
  tipoOperacao: "buscar" | "solicitar" | "receber" | "desnecessario"
  responsavelId?: number | null  // null/undefined => mantém ownerKey padrão da etapa
  dataPrazoInicial?: string | null  // ISO date (YYYY-MM-DD)
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

    // -- Confere se documento existe
    const documento = await prisma.documento.findUnique({
      where: { id: documentoId },
      select: { id: true, status: true },
    })
    if (!documento) {
      return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 })
    }

    // -- Já tem workflow?
    const existing = await prisma.workflow.findUnique({
      where: { documentoId },
      select: { id: true },
    })
    if (existing && tipo !== "desnecessario") {
      return NextResponse.json(
        { error: "Workflow já existe para este documento" },
        { status: 409 }
      )
    }

    const now = new Date()
    const prioridade = body.prioridade || "normal"
    const obs = (body.observacaoInicial || "").trim()

    // ============================================================
    // CASO ESPECIAL: DESNECESSÁRIO — não cria workflow
    // ============================================================
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

    // ============================================================
    // CASOS BUSCAR / SOLICITAR / RECEBER
    // Cria workflow com 6 steps; etapas anteriores ao "ativo" ficam puladas
    // ============================================================
    const firstActiveOrdem = FIRST_ACTIVE_ORDEM[tipo]

    // Calcula dueAt da etapa ativa
    const firstActiveTemplate = DEFAULT_STEPS.find((s) => s.ordem === firstActiveOrdem)!
    const dueAtFromBody = body.dataPrazoInicial ? new Date(body.dataPrazoInicial) : null
    const dueAtCalc = new Date(now.getTime() + firstActiveTemplate.slaDays * 86400000)
    const dueAt = dueAtFromBody ?? dueAtCalc

    // Nota inicial pra etapa ativa (junta observação opcional + razão de pular)
    const notasIniciais: string[] = []
    if (obs) notasIniciais.push(obs)
    if (tipo === "solicitar") {
      notasIniciais.unshift("Operação iniciada como Solicitar — busca formal foi pulada.")
    }
    if (tipo === "receber") {
      notasIniciais.unshift(
        "Operação iniciada como Recebimento — etapas de busca/solicitação/aguardo foram puladas."
      )
    }
    const notes = notasIniciais.join("\n\n") || null

    // -- Cria workflow + 6 steps em transação
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
            const isFuture = s.ordem > firstActiveOrdem

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

    // -- Recalcula progress (etapas puladas contam como concluidas)
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

    // -- Atualiza o documento (status + datas + responsavel)
    await prisma.documento.update({
      where: { id: documentoId },
      data: {
        status: DOC_STATUS_BY_TIPO[tipo],
        dataInicioOperacao: now,
        ultimaMovimentacao: now,
        responsavelId: body.responsavelId ?? undefined,
        dataPrazoOperacao: dueAt,
        // limpa eventual bloqueio anterior
        motivoBloqueio: null,
      },
    })

    return NextResponse.json({ workflow }, { status: 201 })
  } catch (error) {
    console.error("[POST /api/documentos/[id]/workflow]", error)
    return NextResponse.json(
      { error: "Erro ao iniciar operação" },
      { status: 500 }
    )
  }
}
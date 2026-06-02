// src/app/api/documentos/[id]/workflow/route.ts
//
// ETAPA 3 · PARTE 1 — POST reescrito para o modelo WORKFLOW-POR-FASE.
//
// Antes: criava sempre um template fixo de 6 etapas (Genealogia+Emissão juntas)
//        e usava tipoOperacao para escolher onde começar.
// Agora: descobre a FASE ATUAL do processo (Status.faseCode da coluna do kanban)
//        e cria o workflow só daquela fase, lendo o catálogo de fases.
//
// GET e PATCH ficam IGUAIS (não mexi neles). Só o POST mudou.

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { StatusDocumento } from "@prisma/client"
import { getFase, isFaseReady } from "@/src/lib/process-stage/fases-catalog"

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
// POST — cria o workflow da FASE ATUAL do processo
// ============================================================

interface InitBody {
  // Mantido por compatibilidade com a UI atual, mas agora SÓ "desnecessario"
  // tem efeito especial. Os demais valores são ignorados: a fase manda.
  tipoOperacao?: "buscar" | "solicitar" | "receber" | "desnecessario"
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
    const now = new Date()
    const prioridade = body.prioridade || "normal"
    const obs = (body.observacaoInicial || "").trim()

    // ── Documento existe? ────────────────────────────────────────────────
    const documento = await prisma.documento.findUnique({
      where: { id: documentoId },
      select: { id: true, status: true },
    })
    if (!documento) {
      return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 })
    }

    // ── Caso especial: marcar como desnecessário (não cria workflow) ─────
    if (body.tipoOperacao === "desnecessario") {
      await prisma.documento.update({
        where: { id: documentoId },
        data: {
          status: "CANCELADO",
          ultimaMovimentacao: now,
          motivoBloqueio: obs
            ? `Marcado como desnecessário: ${obs}`
            : "Marcado como desnecessário",
        },
      })
      return NextResponse.json({ workflow: null, status: "CANCELADO" }, { status: 200 })
    }

    // ── Já existe workflow? (1 por documento por vez) ────────────────────
    const existing = await prisma.workflow.findUnique({
      where: { documentoId },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json(
        { error: "Workflow já existe para este documento" },
        { status: 409 }
      )
    }

    // ── Descobrir a FASE ATUAL do processo ───────────────────────────────
    // Caminho: documento → pessoa → arvore → processos → status → faseCode
    const docComProcesso = await prisma.documento.findUnique({
      where: { id: documentoId },
      select: {
        pessoa: {
          select: {
            arvore: {
              select: {
                processos: {
                  select: { id: true, status: { select: { faseCode: true, nome: true } } },
                },
              },
            },
          },
        },
      },
    })

    const processos = docComProcesso?.pessoa?.arvore?.processos ?? []
    if (processos.length === 0) {
      return NextResponse.json(
        { error: "Documento não está ligado a nenhum processo (via árvore). Não dá pra saber a fase." },
        { status: 422 }
      )
    }

    // Por enquanto assumimos 1 processo por árvore (caso comum). Se houver
    // mais de um, usamos o primeiro e avisamos no log — tratamos multi-processo
    // numa rodada futura, quando aparecer de verdade.
    if (processos.length > 1) {
      console.warn(
        `[POST workflow] documento ${documentoId}: árvore tem ${processos.length} processos. Usando o primeiro (${processos[0].id}).`
      )
    }
    const processo = processos[0]
    const faseCode = processo.status?.faseCode

    // ── Proteção: a coluna do processo precisa ter faseCode preenchido ───
    if (!faseCode) {
      return NextResponse.json(
        {
          error:
            `A coluna do kanban deste processo (status "${processo.status?.nome ?? "?"}") ainda não tem faseCode definido. ` +
            `Rode o backfill de faseCode antes de iniciar workflows.`,
        },
        { status: 422 }
      )
    }

    // ── Proteção: a fase precisa estar especificada no catálogo ──────────
    if (!isFaseReady(faseCode)) {
      return NextResponse.json(
        {
          error:
            `A fase "${faseCode}" ainda não tem etapas definidas no catálogo (pendingSpec). ` +
            `Só Genealogia e Emissão estão prontas nesta versão.`,
        },
        { status: 422 }
      )
    }

    // ── Monta os steps da fase atual a partir do catálogo ────────────────
    const fase = getFase(faseCode)
    const steps = fase.steps // já em ordem

    const firstStep = steps[0]
    const dueAtFromBody = body.dataPrazoInicial ? new Date(body.dataPrazoInicial) : null
    const dueAt = dueAtFromBody ?? new Date(now.getTime() + firstStep.slaDays * 86400000)

    const notes = obs || null

    const workflow = await prisma.workflow.create({
      data: {
        documentoId,
        faseCode, // ← registra de qual fase este workflow nasceu (Etapa 1)
        templateCode: `FASE_${faseCode}`,
        templateName: `Workflow · ${fase.label}`,
        status: "em_andamento",
        progress: 0,
        prioridade,
        startedAt: now,
        steps: {
          create: steps.map((s, i) => {
            const isActive = i === 0 // só a primeira etapa começa ativa
            return {
              ordem: s.ordem,
              stepKey: s.stepKey,
              title: s.title,
              description: s.description,
              weight: s.weight,
              ownerKey: s.ownerKey,
              slaDays: s.slaDays,
              status: isActive ? "em_andamento" : "bloqueada",
              startedAt: isActive ? now : null,
              dueAt: isActive ? dueAt : null,
              assigneeId: isActive ? body.responsavelId ?? null : null,
              notes: isActive ? notes : null,
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

    // ── Atualiza o documento (status operacional + responsável + prazo) ──
    // O status do documento na fase inicial depende da fase. Na Genealogia,
    // a busca está em andamento → EM_BUSCA. Nas demais, deixamos um status
    // coerente com a primeira etapa; por ora só Genealogia e Emissão existem.
    const docStatusInicial: StatusDocumento =
      faseCode === "GENEALOGIA" ? "EM_BUSCA" : "SOLICITAR"

    await prisma.documento.update({
      where: { id: documentoId },
      data: {
        status: docStatusInicial,
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
// (IGUAL à versão atual — não foi alterado)
// ============================================================

type WorkflowAction = "pausar" | "retomar" | "cancelar" | "invalidar"

interface PatchBody {
  action: WorkflowAction
  observacao?: string
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

    if (action === "pausar") {
      if (workflow.status !== "em_andamento") {
        return NextResponse.json({ error: "Só é possível pausar workflows em andamento" }, { status: 400 })
      }
      await prisma.workflow.update({ where: { id: workflow.id }, data: { status: "pausado" } })
      await prisma.documento.update({
        where: { id: documentoId },
        data: { ultimaMovimentacao: now, motivoBloqueio: obs ? `Operação pausada: ${obs}` : "Operação pausada" },
      })
    } else if (action === "retomar") {
      if (workflow.status !== "pausado") {
        return NextResponse.json({ error: "Só é possível retomar workflows pausados" }, { status: 400 })
      }
      await prisma.workflow.update({ where: { id: workflow.id }, data: { status: "em_andamento" } })
      await prisma.documento.update({
        where: { id: documentoId },
        data: { ultimaMovimentacao: now, motivoBloqueio: null },
      })
    } else if (action === "cancelar") {
      await prisma.workflow.update({ where: { id: workflow.id }, data: { status: "cancelado", cancelledAt: now } })
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
    } else if (action === "invalidar") {
      await prisma.workflow.update({ where: { id: workflow.id }, data: { status: "cancelado", cancelledAt: now } })
      await prisma.documento.update({
        where: { id: documentoId },
        data: {
          status: "INVALIDO",
          ultimaMovimentacao: now,
          motivoBloqueio: obs ? `Documento invalidado: ${obs}` : "Documento invalidado",
        },
      })
    }

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
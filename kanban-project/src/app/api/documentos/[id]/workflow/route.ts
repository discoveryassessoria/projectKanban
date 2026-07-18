// src/app/api/documentos/[id]/workflow/route.ts
// CUTOVER V2 — esta rota NÃO lê/escreve mais Workflow/WorkflowStep legado.
// "Iniciar operação", controles e leitura passam pela operação por-documento V2
// (PhaseWorkflowStepInstance com documentoId). O contrato de resposta ({ workflow })
// é preservado pelo adaptador montarWorkflowV2.

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  garantirOperacaoDocumentoV2,
  iniciarOperacaoDocumentoV2,
  controlarOperacaoV2,
} from "@/src/services/documento-operacao"

// GET — workflow (V2) do documento no formato antigo. MATERIALIZA automaticamente a
// operação da fase atual (idempotente) — o fluxo normal não depende de "Iniciar operação".
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const documentoId = parseInt(id)
    if (isNaN(documentoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    const { workflow, semWorkflowInterno } = await garantirOperacaoDocumentoV2(documentoId)
    return NextResponse.json({ workflow, semWorkflowInterno: semWorkflowInterno ?? false })
  } catch (error) {
    console.error("[GET /api/documentos/[id]/workflow]", error)
    return NextResponse.json({ error: "Erro ao buscar workflow" }, { status: 500 })
  }
}

interface InitBody {
  tipoOperacao?: "buscar" | "solicitar" | "receber" | "desnecessario"
  responsavelId?: number | null
  dataPrazoInicial?: string | null
  prioridade?: "normal" | "urgente" | "critica"
  observacaoInicial?: string | null
}

// POST — inicia a operação do documento na fase atual (V2)
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const documentoId = parseInt(id)
    if (isNaN(documentoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const body = (await request.json()) as InitBody
    const documento = await prisma.documento.findUnique({ where: { id: documentoId }, select: { id: true } })
    if (!documento) return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 })

    // Caso especial: marcar como desnecessário (não cria operação)
    if (body.tipoOperacao === "desnecessario") {
      const obs = (body.observacaoInicial || "").trim()
      await prisma.documento.update({
        where: { id: documentoId },
        data: {
          status: "CANCELADO", ultimaMovimentacao: new Date(),
          motivoBloqueio: obs ? `Marcado como desnecessário: ${obs}` : "Marcado como desnecessário",
        },
      })
      return NextResponse.json({ workflow: null, status: "CANCELADO" }, { status: 200 })
    }

    const r = await iniciarOperacaoDocumentoV2(documentoId, {
      responsavelId: body.responsavelId ?? null,
      dataPrazoInicial: body.dataPrazoInicial ? new Date(body.dataPrazoInicial) : null,
      observacaoInicial: body.observacaoInicial ?? null,
    })
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ workflow: r.workflow }, { status: 201 })
  } catch (error) {
    console.error("[POST /api/documentos/[id]/workflow]", error)
    return NextResponse.json({ error: "Erro ao iniciar operação" }, { status: 500 })
  }
}

// PATCH — controles da operação: pausar / retomar / cancelar / invalidar (V2)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const documentoId = parseInt(id)
    if (isNaN(documentoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const body = (await request.json()) as { action?: string; observacao?: string }
    if (!body.action || !["pausar", "retomar", "cancelar", "invalidar"].includes(body.action)) {
      return NextResponse.json({ error: "action inválido. Use: pausar | retomar | cancelar | invalidar" }, { status: 400 })
    }
    const r = await controlarOperacaoV2(documentoId, body.action, body.observacao)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ workflow: r.workflow })
  } catch (error) {
    console.error("[PATCH /api/documentos/[id]/workflow]", error)
    return NextResponse.json({ error: "Erro ao atualizar operação" }, { status: 500 })
  }
}

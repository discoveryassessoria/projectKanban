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
  PERMISSAO_DO_CONTROLE,
} from "@/src/services/documento-operacao"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"

// GET — workflow (V2) do documento no formato antigo. MATERIALIZA automaticamente a
// operação da fase atual (idempotente) — o fluxo normal não depende de "Iniciar operação".
// Cada etapa sai com o EDITOR já resolvido e as AÇÕES PERMITIDAS calculadas para o
// usuário do token: a tela desenha o que recebe, não o que deduz do status.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const documentoId = parseInt(id)
    if (isNaN(documentoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    const usuario = await extrairUsuarioComPermissoes(request)
    const { workflow, semWorkflowInterno } = await garantirOperacaoDocumentoV2(documentoId, {
      usuarioId: usuario?.userId ?? null,
      permissoes: usuario?.permissoes ?? null,
    })
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

    const usuario = await extrairUsuarioComPermissoes(request)
    if (!usuario) return NextResponse.json({ error: "não autenticado" }, { status: 401 })
    // 🔒 Mesma permissão de iniciar operação — este caminho também decide o
    // destino do documento (CANCELADO), e não conferia nada antes.
    if (usuario.permissoes?.[PERMISSAO_DO_CONTROLE.iniciar] !== true) {
      return NextResponse.json({ error: "Sem permissão." }, { status: 403 })
    }

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

    const r = await iniciarOperacaoDocumentoV2(
      documentoId,
      {
        responsavelId: body.responsavelId ?? null,
        dataPrazoInicial: body.dataPrazoInicial ? new Date(body.dataPrazoInicial) : null,
        observacaoInicial: body.observacaoInicial ?? null,
      },
      { usuarioId: usuario.userId, permissoes: usuario.permissoes ?? null, isAdmin: usuario.tipo === "admin" },
    )
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
    const usuario = await extrairUsuarioComPermissoes(request)
    if (!usuario) return NextResponse.json({ error: "não autenticado" }, { status: 401 })
    const r = await controlarOperacaoV2(documentoId, body.action, body.observacao, {
      usuarioId: usuario.userId,
      permissoes: usuario.permissoes ?? null,
      isAdmin: usuario.tipo === "admin",
    })
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ workflow: r.workflow })
  } catch (error) {
    console.error("[PATCH /api/documentos/[id]/workflow]", error)
    return NextResponse.json({ error: "Erro ao atualizar operação" }, { status: 500 })
  }
}

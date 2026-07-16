// src/app/api/gerenciamento/modelos-tarefa-transversal/[id]/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

// PUT — edita (só troca o que veio no corpo)
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, "usuarios.gerenciar")
    if (erro) return erro

    const { id } = await params
    const modeloId = parseInt(id)
    const atual = await prisma.modeloTarefaTransversal.findUnique({ where: { id: modeloId } })
    if (!atual) return NextResponse.json({ error: "Modelo não encontrado" }, { status: 404 })

    const b = await request.json()
    // ARQUITETURA NOVA — modelo transversal descontinuado: só se permite
    // arquivar/desativar, nunca REATIVAR (desarquivar).
    if (b.arquivado === false && atual.arquivado === true) {
      return NextResponse.json({
        error: "Modelos de Tarefa Transversal foram descontinuados e não podem ser reativados — a criação de tarefas obrigatórias é exclusiva do Workflow Interno.",
        code: "TRANSVERSAL_DESATIVADO",
      }, { status: 422 })
    }
    const data: Prisma.ModeloTarefaTransversalUpdateInput = {
      name: b.name !== undefined ? b.name : atual.name,
      type: b.type !== undefined ? b.type : atual.type,
      description: b.description !== undefined ? b.description : atual.description,
      defaultOriginPhase: b.defaultOriginPhase !== undefined ? b.defaultOriginPhase : atual.defaultOriginPhase,
      defaultOperationalPhase: b.defaultOperationalPhase !== undefined ? b.defaultOperationalPhase : atual.defaultOperationalPhase,
      defaultMandatory: b.defaultMandatory !== undefined ? b.defaultMandatory : atual.defaultMandatory,
      defaultResultAction: b.defaultResultAction !== undefined ? b.defaultResultAction : atual.defaultResultAction,
      defaultOriginLinkType: b.defaultOriginLinkType !== undefined ? b.defaultOriginLinkType : atual.defaultOriginLinkType,
      arquivado: b.arquivado !== undefined ? b.arquivado : atual.arquivado,
    }
    // campos Json — só são tocados quando vêm no corpo (evita reescrever null)
    if (b.recommendedForOriginPhases !== undefined) data.recommendedForOriginPhases = b.recommendedForOriginPhases as Prisma.InputJsonValue
    if (b.operationalWorkflow !== undefined) data.operationalWorkflow = b.operationalWorkflow as Prisma.InputJsonValue
    if (b.originLinkConfig !== undefined) data.originLinkConfig = b.originLinkConfig as Prisma.InputJsonValue
    if (b.defaultEffects !== undefined) data.defaultEffects = b.defaultEffects as Prisma.InputJsonValue
    if (b.duplicatePolicy !== undefined) data.duplicatePolicy = b.duplicatePolicy as Prisma.InputJsonValue

    const modelo = await prisma.modeloTarefaTransversal.update({ where: { id: modeloId }, data })
    return NextResponse.json({ modelo })
  } catch (error) {
    console.error("Erro ao editar modelo de tarefa transversal:", error)
    return NextResponse.json({ error: "Erro ao editar modelo" }, { status: 500 })
  }
}

// DELETE — exclui (bloqueia se já estiver em uso)
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, "usuarios.gerenciar")
    if (erro) return erro

    const { id } = await params
    const modeloId = parseInt(id)
    const atual = await prisma.modeloTarefaTransversal.findUnique({ where: { id: modeloId } })
    if (!atual) return NextResponse.json({ error: "Modelo não encontrado" }, { status: 404 })

    if ((atual.usedByCount || 0) > 0) {
      return NextResponse.json({ error: "Este modelo já está em uso. Arquive em vez de excluir." }, { status: 409 })
    }

    await prisma.modeloTarefaTransversal.delete({ where: { id: modeloId } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Erro ao excluir modelo de tarefa transversal:", error)
    return NextResponse.json({ error: "Erro ao excluir modelo" }, { status: 500 })
  }
}
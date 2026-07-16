// src/app/api/gerenciamento/regras-tarefa-transversal/[id]/route.ts

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
    const regraId = parseInt(id)
    const atual = await prisma.regraTarefaTransversal.findUnique({ where: { id: regraId } })
    if (!atual) return NextResponse.json({ error: "Regra não encontrada" }, { status: 404 })

    const b = await request.json()
    // ARQUITETURA NOVA — regra transversal descontinuada: só se permite
    // arquivar/desativar, nunca REATIVAR (desarquivar). Criação de tarefas
    // obrigatórias é exclusiva do Workflow Interno.
    if (b.arquivado === false && atual.arquivado === true) {
      return NextResponse.json({
        error: "Regras de Tarefa Transversal foram descontinuadas e não podem ser reativadas — a criação de tarefas obrigatórias é exclusiva do Workflow Interno.",
        code: "TRANSVERSAL_DESATIVADO",
      }, { status: 422 })
    }
    const data: Prisma.RegraTarefaTransversalUpdateInput = {
      name: b.name !== undefined ? b.name : atual.name,
      tipoProcessoId: b.tipoProcessoId !== undefined ? b.tipoProcessoId : atual.tipoProcessoId,
      originPhase: b.originPhase !== undefined ? b.originPhase : atual.originPhase,
      operationalPhase: b.operationalPhase !== undefined ? b.operationalPhase : atual.operationalPhase,
      templateId: b.templateId !== undefined ? b.templateId : atual.templateId,
      autoCreate: b.autoCreate !== undefined ? b.autoCreate : atual.autoCreate,
      suggested: b.suggested !== undefined ? b.suggested : atual.suggested,
      mandatory: b.mandatory !== undefined ? b.mandatory : atual.mandatory,
      arquivado: b.arquivado !== undefined ? b.arquivado : atual.arquivado,
    }
    // campos Json — só tocados quando vêm no corpo
    if (b.trigger !== undefined) data.trigger = b.trigger as Prisma.InputJsonValue
    if (b.creation !== undefined) data.creation = b.creation as Prisma.InputJsonValue
    if (b.originLink !== undefined) data.originLink = b.originLink as Prisma.InputJsonValue
    if (b.duplicatePolicy !== undefined) data.duplicatePolicy = b.duplicatePolicy as Prisma.InputJsonValue
    if (b.applyResult !== undefined) data.applyResult = b.applyResult as Prisma.InputJsonValue

    const regra = await prisma.regraTarefaTransversal.update({ where: { id: regraId }, data })
    return NextResponse.json({ regra })
  } catch (error) {
    console.error("Erro ao editar regra de tarefa transversal:", error)
    return NextResponse.json({ error: "Erro ao editar regra" }, { status: 500 })
  }
}

// DELETE — exclui (bloqueia se já estiver em uso)
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, "usuarios.gerenciar")
    if (erro) return erro

    const { id } = await params
    const regraId = parseInt(id)
    const atual = await prisma.regraTarefaTransversal.findUnique({ where: { id: regraId } })
    if (!atual) return NextResponse.json({ error: "Regra não encontrada" }, { status: 404 })

    if ((atual.usedByCount || 0) > 0) {
      return NextResponse.json({ error: "Esta regra já está em uso. Arquive em vez de excluir." }, { status: 409 })
    }

    await prisma.regraTarefaTransversal.delete({ where: { id: regraId } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Erro ao excluir regra de tarefa transversal:", error)
    return NextResponse.json({ error: "Erro ao excluir regra" }, { status: 500 })
  }
}
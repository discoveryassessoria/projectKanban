// src/app/api/processos/[processoId]/genealogia/delegar/route.ts
//
// Delega (atribui responsável) do passo localizar_registro de uma NecessidadeDocumental
// da Genealogia — direto na fila, SEM exigir/criar Documento. Grava apenas
// PhaseWorkflowStepInstance.responsavelId. Não toca regras, motor, progresso,
// BlockingEngine nem avanço de fase.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ processoId: string }> }) {
  const erro = await verificarPermissao(request, "processos.editar")
  if (erro) return erro
  try {
    const { processoId } = await params
    const procId = Number(processoId)
    const body = await request.json().catch(() => ({}))
    const necessidadeId = Number(body?.necessidadeId)
    const responsavelId = body?.responsavelId == null || body?.responsavelId === "" ? null : Number(body.responsavelId)
    if (!procId || !necessidadeId) return NextResponse.json({ error: "processoId e necessidadeId são obrigatórios." }, { status: 400 })

    const nec = await prisma.necessidadeDocumental.findUnique({
      where: { id: necessidadeId },
      select: { id: true, processoId: true },
    })
    if (!nec || nec.processoId !== procId) return NextResponse.json({ error: "Necessidade não encontrada neste processo." }, { status: 404 })

    if (responsavelId != null) {
      const u = await prisma.usuario.findUnique({ where: { id: responsavelId }, select: { id: true, nome: true } })
      if (!u) return NextResponse.json({ error: "Usuário responsável inválido." }, { status: 400 })
      await prisma.phaseWorkflowStepInstance.updateMany({
        where: { necessidadeId: nec.id, stepKey: "localizar_registro" },
        data: { responsavelId },
      })
      return NextResponse.json({ ok: true, responsavelId: u.id, responsavelNome: u.nome })
    }

    // desatribuir
    await prisma.phaseWorkflowStepInstance.updateMany({
      where: { necessidadeId: nec.id, stepKey: "localizar_registro" },
      data: { responsavelId: null },
    })
    return NextResponse.json({ ok: true, responsavelId: null, responsavelNome: null })
  } catch (e) {
    console.error("PATCH genealogia/delegar", e)
    return NextResponse.json({ error: "Erro ao delegar a operação." }, { status: 500 })
  }
}

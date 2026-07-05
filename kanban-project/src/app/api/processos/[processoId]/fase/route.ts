// ESTE ARQUIVO VAI EM: src/app/api/processos/[processoId]/fase/route.ts
// (a pasta do projeto é [processoId], não [id])
//
// Move o processo de FASE (arrastar o card no kanban).
// Valida que a fase de destino pertence ao Workflow Macro do TIPO do processo.

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

export async function PUT(request: Request, { params }: { params: Promise<{ processoId: string }> }) {
  const erro = await verificarPermissao(request, "processos.editar_status")
  if (erro) return erro

  try {
    const { processoId: idStr } = await params
    const processoId = parseInt(idStr)
    if (!processoId) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const faseAtualKey = String(body?.faseAtualKey || "").trim()
    if (!faseAtualKey) return NextResponse.json({ error: "Informe a fase." }, { status: 400 })

    const processo = await prisma.processo.findUnique({
      where: { id: processoId },
      select: { id: true, tipoProcessoMotorId: true },
    })
    if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })
    if (!processo.tipoProcessoMotorId) {
      return NextResponse.json({ error: "Processo sem tipo do motor — não é possível mover de fase." }, { status: 400 })
    }

    // a fase de destino tem que existir no workflow do tipo
    const wf = await prisma.macroWorkflow.findUnique({
      where: { tipoProcessoId: processo.tipoProcessoMotorId },
      include: { fases: { where: { showInKanban: true }, select: { phaseKey: true } } },
    })
    const valida = wf?.fases.some((f) => f.phaseKey === faseAtualKey)
    if (!valida) {
      return NextResponse.json({ error: "Fase inválida para o tipo deste processo." }, { status: 400 })
    }

    const atualizado = await prisma.processo.update({
      where: { id: processoId },
      data: { faseAtualKey },
    })

    return NextResponse.json({ processo: atualizado })
  } catch (error) {
    console.error("Erro ao mover processo de fase:", error)
    return NextResponse.json({ error: "Erro ao mover processo de fase" }, { status: 500 })
  }
}
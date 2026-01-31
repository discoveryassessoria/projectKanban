import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// PUT /api/tarefas/reordenar
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { tarefas } = body

    if (!tarefas || !Array.isArray(tarefas)) {
      return NextResponse.json(
        { error: "Array de tarefas é obrigatório" },
        { status: 400 }
      )
    }

    // Atualizar ordem de todas as tarefas em uma transação
    await prisma.$transaction(
      tarefas.map((tarefa: { id: number; ordem: number }) =>
        prisma.tarefa.update({
          where: { id: tarefa.id },
          data: { ordem: tarefa.ordem }
        })
      )
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Erro ao reordenar tarefas:", error)
    return NextResponse.json(
      { error: "Erro ao reordenar tarefas" },
      { status: 500 }
    )
  }
}
// src/app/api/tarefas/reordenar/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { negarSeNaoForDonoDasTarefas } from "@/src/lib/tarefa-acesso"

// PUT /api/tarefas/reordenar
export async function PUT(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'tarefas.editar')
    if (erro) return erro

    const body = await request.json()
    const { tarefas } = body

    if (!tarefas || !Array.isArray(tarefas)) {
      return NextResponse.json(
        { error: "Array de tarefas é obrigatório" },
        { status: 400 }
      )
    }

    // 🔒 E4 — comum só reordena as PRÓPRIAS tarefas (ou sem dono); admin, todas.
    // Como mexe em várias de uma vez, a checagem é em lote.
    const ids = tarefas.map((t: { id: number }) => t.id)
    const negado = await negarSeNaoForDonoDasTarefas(request, ids)
    if (negado) return negado

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
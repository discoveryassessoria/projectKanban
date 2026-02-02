// src/app/api/tarefas/[tarefaId]/iniciar/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// POST - Iniciar tarefa (SEM criar cobrança)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tarefaId: string }> }
) {
  try {
    const { tarefaId } = await params
    const id = parseInt(tarefaId)

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const { prazoCobranca = 5 } = body

    // Buscar tarefa
    const tarefa = await prisma.tarefa.findUnique({
      where: { id }
    })

    if (!tarefa) {
      return NextResponse.json(
        { error: "Tarefa não encontrada" },
        { status: 404 }
      )
    }

    // Verificar se já foi iniciada
    if (tarefa.dataInicio) {
      return NextResponse.json(
        { error: "Tarefa já foi iniciada" },
        { status: 400 }
      )
    }

    // Calcular dataPrazo baseado no prazoCobranca
    const prazoFinal = prazoCobranca || tarefa.prazoCobranca || 5
    const dataPrazo = new Date()
    dataPrazo.setDate(dataPrazo.getDate() + prazoFinal)

    const tarefaAtualizada = await prisma.tarefa.update({
      where: { id },
      data: {
        dataInicio: new Date(),
        dataPrazo,
        prazoCobranca: prazoFinal,
        statusTarefa: "EM_ANDAMENTO"
      }
    })

    return NextResponse.json({ 
      tarefa: tarefaAtualizada
    })
  } catch (error) {
    console.error("Erro ao iniciar tarefa:", error)
    return NextResponse.json(
      { error: "Erro ao iniciar tarefa" },
      { status: 500 }
    )
  }
}
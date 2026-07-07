// src/app/api/tarefas/[tarefaId]/historico/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { negarSeNaoForDonoDaTarefa } from "@/src/lib/tarefa-acesso"

// GET - Listar histórico da tarefa (incluindo comentários)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tarefaId: string }> }
) {
  try {
    const { tarefaId: tarefaIdParam } = await params
    const tarefaId = parseInt(tarefaIdParam)
    if (isNaN(tarefaId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    // 🔒 E4 — confere o dono antes de ler o histórico (a tarefa e suas subtarefas).
    const tarefa = await prisma.tarefa.findUnique({
      where: { id: tarefaId },
      select: { responsavelId: true }
    })
    if (!tarefa) {
      return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 })
    }
    const negado = await negarSeNaoForDonoDaTarefa(request, tarefa.responsavelId)
    if (negado) return negado

    // Buscar histórico da tarefa E de todas as subtarefas
    const historico = await prisma.tarefaHistorico.findMany({
      where: {
        OR: [
          { tarefaId },
          { tarefa: { tarefaPaiId: tarefaId } }
        ]
      },
      include: {
        usuario: {
          select: { id: true, nome: true, email: true }
        },
        tarefa: {
          select: { id: true, titulo: true, tarefaPaiId: true }
        }
      },
      orderBy: { createdAt: "desc" }
    })

    return NextResponse.json({ historico })
  } catch (error) {
    console.error("Erro ao buscar histórico:", error)
    return NextResponse.json(
      { error: "Erro ao buscar histórico" },
      { status: 500 }
    )
  }
}

// POST - Criar comentário ou entrada de histórico
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tarefaId: string }> }
) {
  try {
    const { tarefaId: tarefaIdParam } = await params
    const tarefaId = parseInt(tarefaIdParam)
    if (isNaN(tarefaId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const body = await request.json()
    const { texto, usuarioId, acao = "COMENTARIO" } = body

    if (!texto?.trim()) {
      return NextResponse.json(
        { error: "Texto é obrigatório" },
        { status: 400 }
      )
    }

    // Verificar se a tarefa existe
    const tarefa = await prisma.tarefa.findUnique({
      where: { id: tarefaId }
    })

    if (!tarefa) {
      return NextResponse.json(
        { error: "Tarefa não encontrada" },
        { status: 404 }
      )
    }

    // 🔒 E4 — só o dono (ou admin) comenta/registra nesta tarefa.
    const negado = await negarSeNaoForDonoDaTarefa(request, tarefa.responsavelId)
    if (negado) return negado

    // Criar entrada no histórico
    const entrada = await prisma.tarefaHistorico.create({
      data: {
        tarefaId,
        usuarioId: usuarioId || null,
        acao,
        descricao: texto.trim(),
        dados: acao === "COMENTARIO" ? { tipo: "comentario" } : undefined
      },
      include: {
        usuario: {
          select: { id: true, nome: true, email: true }
        },
        tarefa: {
          select: { id: true, titulo: true }
        }
      }
    })

    return NextResponse.json({ entrada }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar entrada:", error)
    return NextResponse.json(
      { error: "Erro ao criar entrada no histórico" },
      { status: 500 }
    )
  }
}
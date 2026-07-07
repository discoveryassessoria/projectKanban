// src/app/api/tarefas/[tarefaId]/toggle/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { logTarefa } from "@/lib/auditoria"
import { hojeBrasil } from "@/src/lib/date-utils"
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { negarSeNaoForDonoDaTarefa } from "@/src/lib/tarefa-acesso"

async function verificarEConcluirTarefaPai(tarefaPaiId: number) {
  const tarefaPai = await prisma.tarefa.findUnique({
    where: { id: tarefaPaiId },
    include: {
      subtarefas: {
        select: { concluida: true }
      }
    }
  })

  if (!tarefaPai) return

  const todasConcluidas = tarefaPai.subtarefas.length > 0 && 
    tarefaPai.subtarefas.every(sub => sub.concluida)

  if (todasConcluidas && !tarefaPai.concluida) {
    await prisma.tarefa.update({
      where: { id: tarefaPaiId },
      data: {
        concluida: true,
        dataConclusao: hojeBrasil()
      }
    })

    if (tarefaPai.tarefaPaiId) {
      await verificarEConcluirTarefaPai(tarefaPai.tarefaPaiId)
    }
  }
}

async function reabrirTarefaPaiSeNecessario(tarefaPaiId: number) {
  const tarefaPai = await prisma.tarefa.findUnique({
    where: { id: tarefaPaiId }
  })

  if (tarefaPai && tarefaPai.concluida) {
    await prisma.tarefa.update({
      where: { id: tarefaPaiId },
      data: {
        concluida: false,
        dataConclusao: null
      }
    })

    if (tarefaPai.tarefaPaiId) {
      await reabrirTarefaPaiSeNecessario(tarefaPai.tarefaPaiId)
    }
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tarefaId: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'tarefas.iniciar_concluir')
    if (erro) return erro

    const { tarefaId } = await params
    const id = parseInt(tarefaId)

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    const tarefaAtual = await prisma.tarefa.findUnique({
      where: { id },
      include: {
        subtarefas: {
          select: { id: true, concluida: true }
        }
      }
    })

    if (!tarefaAtual) {
      return NextResponse.json(
        { error: "Tarefa não encontrada" },
        { status: 404 }
      )
    }

    // 🔒 E4 — só o dono (ou admin) marca/desmarca esta tarefa.
    const negado = await negarSeNaoForDonoDaTarefa(request, tarefaAtual.responsavelId)
    if (negado) return negado

    const novaConcluida = !tarefaAtual.concluida

    if (novaConcluida && tarefaAtual.subtarefas.length > 0) {
      const subtarefasPendentes = tarefaAtual.subtarefas.filter(s => !s.concluida)
      if (subtarefasPendentes.length > 0) {
        return NextResponse.json(
          { 
            error: `Não é possível concluir. Existem ${subtarefasPendentes.length} subtarefa(s) pendente(s).`,
            subtarefasPendentes: subtarefasPendentes.length
          },
          { status: 400 }
        )
      }
    }

    const tarefa = await prisma.tarefa.update({
      where: { id },
      data: {
        concluida: novaConcluida,
        dataConclusao: novaConcluida ? new Date() : null
      },
      include: {
        responsavel: {
          select: {
            id: true,
            nome: true
          }
        },
        subtarefas: {
          select: {
            id: true,
            titulo: true,
            concluida: true
          },
          orderBy: { ordem: "asc" }
        },
        tarefaPai: {
          select: {
            id: true,
            titulo: true,
            concluida: true
          }
        }
      }
    })

    // ✅ REGISTRAR LOG
    if (novaConcluida) {
      await logTarefa.concluir(tarefa.titulo, tarefa.id)
    } else {
      await logTarefa.reabrir(tarefa.titulo, tarefa.id)
    }

    if (novaConcluida && tarefaAtual.tarefaPaiId) {
      await verificarEConcluirTarefaPai(tarefaAtual.tarefaPaiId)
    }

    if (!novaConcluida && tarefaAtual.tarefaPaiId) {
      await reabrirTarefaPaiSeNecessario(tarefaAtual.tarefaPaiId)
    }

    let tarefaPaiAtualizada = null
    if (tarefaAtual.tarefaPaiId) {
      tarefaPaiAtualizada = await prisma.tarefa.findUnique({
        where: { id: tarefaAtual.tarefaPaiId },
        select: {
          id: true,
          titulo: true,
          concluida: true
        }
      })
    }

    return NextResponse.json({ 
      tarefa,
      tarefaPai: tarefaPaiAtualizada,
      mensagem: novaConcluida ? "Tarefa concluída!" : "Tarefa reaberta!"
    })
  } catch (error) {
    console.error("Erro ao alternar conclusão:", error)
    return NextResponse.json(
      { error: "Erro ao alternar conclusão" },
      { status: 500 }
    )
  }
}
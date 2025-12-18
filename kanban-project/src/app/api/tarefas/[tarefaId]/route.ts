import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { PrioridadeTarefa } from "@prisma/client"

// GET - Buscar tarefa por ID
export async function GET(
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

    const tarefa = await prisma.tarefa.findUnique({
      where: { id },
      include: {
        processo: {
          select: {
            id: true,
            nome: true,
            pais: true,
            contratante: {
              select: {
                id: true,
                nome: true
              }
            }
          }
        },
        responsavel: {
          select: {
            id: true,
            nome: true,
            email: true
          }
        }
      }
    })

    if (!tarefa) {
      return NextResponse.json(
        { error: "Tarefa não encontrada" },
        { status: 404 }
      )
    }

    return NextResponse.json({ tarefa })
  } catch (error) {
    console.error("Erro ao buscar tarefa:", error)
    return NextResponse.json(
      { error: "Erro ao buscar tarefa" },
      { status: 500 }
    )
  }
}

// PUT - Atualizar tarefa
export async function PUT(
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

    const body = await request.json()
    const { 
      titulo, 
      descricao, 
      responsavelId,
      prioridade,
      dataPrazo,
      concluida
    } = body

    // Verificar se a tarefa existe
    const tarefaExistente = await prisma.tarefa.findUnique({
      where: { id }
    })

    if (!tarefaExistente) {
      return NextResponse.json(
        { error: "Tarefa não encontrada" },
        { status: 404 }
      )
    }

    // Verificar se o responsável existe (se fornecido)
    if (responsavelId) {
      const responsavel = await prisma.usuario.findUnique({
        where: { id: responsavelId }
      })

      if (!responsavel) {
        return NextResponse.json(
          { error: "Responsável não encontrado" },
          { status: 404 }
        )
      }
    }

    // Validar prioridade se fornecida
    if (prioridade && !Object.values(PrioridadeTarefa).includes(prioridade)) {
      return NextResponse.json(
        { error: "Prioridade inválida" },
        { status: 400 }
      )
    }

    // Preparar dados de atualização
    const dataAtualizacao: any = {}

    if (titulo !== undefined) dataAtualizacao.titulo = titulo
    if (descricao !== undefined) dataAtualizacao.descricao = descricao
    if (responsavelId !== undefined) dataAtualizacao.responsavelId = responsavelId
    if (prioridade !== undefined) dataAtualizacao.prioridade = prioridade
    if (dataPrazo !== undefined) dataAtualizacao.dataPrazo = dataPrazo ? new Date(dataPrazo) : null
    
    // Se marcando como concluída, registrar data de conclusão
    if (concluida !== undefined) {
      dataAtualizacao.concluida = concluida
      if (concluida && !tarefaExistente.concluida) {
        dataAtualizacao.dataConclusao = new Date()
      } else if (!concluida) {
        dataAtualizacao.dataConclusao = null
      }
    }

    const tarefa = await prisma.tarefa.update({
      where: { id },
      data: dataAtualizacao,
      include: {
        processo: {
          select: {
            id: true,
            nome: true,
            pais: true
          }
        },
        responsavel: {
          select: {
            id: true,
            nome: true,
            email: true
          }
        }
      }
    })

    return NextResponse.json({ tarefa })
  } catch (error) {
    console.error("Erro ao atualizar tarefa:", error)
    return NextResponse.json(
      { error: "Erro ao atualizar tarefa" },
      { status: 500 }
    )
  }
}

// DELETE - Excluir tarefa
export async function DELETE(
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

    // Verificar se existe
    const tarefa = await prisma.tarefa.findUnique({
      where: { id }
    })

    if (!tarefa) {
      return NextResponse.json(
        { error: "Tarefa não encontrada" },
        { status: 404 }
      )
    }

    await prisma.tarefa.delete({
      where: { id }
    })

    return NextResponse.json({ message: "Tarefa excluída com sucesso" })
  } catch (error) {
    console.error("Erro ao excluir tarefa:", error)
    return NextResponse.json(
      { error: "Erro ao excluir tarefa" },
      { status: 500 }
    )
  }
}
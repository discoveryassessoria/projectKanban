import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { PrioridadeTarefa } from "@prisma/client"

// GET - Buscar tarefas (com filtros opcionais)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const processoId = searchParams.get("processoId")
    const responsavelId = searchParams.get("responsavelId")
    const concluida = searchParams.get("concluida")
    const prioridade = searchParams.get("prioridade") as PrioridadeTarefa | null

    const where: any = {}

    if (processoId) {
      where.processoId = parseInt(processoId)
    }

    if (responsavelId) {
      where.responsavelId = parseInt(responsavelId)
    }

    if (concluida !== null) {
      where.concluida = concluida === "true"
    }

    if (prioridade && Object.values(PrioridadeTarefa).includes(prioridade)) {
      where.prioridade = prioridade
    }

    const tarefas = await prisma.tarefa.findMany({
      where,
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
      },
      orderBy: [
        { concluida: "asc" },      // Não concluídas primeiro
        { prioridade: "desc" },     // Maior prioridade primeiro
        { dataPrazo: "asc" },       // Prazo mais próximo primeiro
        { createdAt: "desc" }
      ]
    })

    return NextResponse.json({ tarefas })
  } catch (error) {
    console.error("Erro ao buscar tarefas:", error)
    return NextResponse.json(
      { error: "Erro ao buscar tarefas" },
      { status: 500 }
    )
  }
}

// POST - Criar nova tarefa
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { 
      titulo, 
      descricao, 
      processoId, 
      responsavelId,
      prioridade,
      dataPrazo
    } = body

    if (!titulo) {
      return NextResponse.json(
        { error: "Título é obrigatório" },
        { status: 400 }
      )
    }

    if (!processoId) {
      return NextResponse.json(
        { error: "Processo é obrigatório" },
        { status: 400 }
      )
    }

    // Verificar se o processo existe
    const processo = await prisma.processo.findUnique({
      where: { id: processoId }
    })

    if (!processo) {
      return NextResponse.json(
        { error: "Processo não encontrado" },
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

    // Validar prioridade
    const prioridadeValida = prioridade && Object.values(PrioridadeTarefa).includes(prioridade)
      ? prioridade
      : PrioridadeTarefa.MEDIA

    const tarefa = await prisma.tarefa.create({
      data: {
        titulo,
        descricao: descricao || null,
        processoId,
        responsavelId: responsavelId || null,
        prioridade: prioridadeValida,
        dataPrazo: dataPrazo ? new Date(dataPrazo) : null
      },
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

    return NextResponse.json({ tarefa }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar tarefa:", error)
    return NextResponse.json(
      { error: "Erro ao criar tarefa" },
      { status: 500 }
    )
  }
}
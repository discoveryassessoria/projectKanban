import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { PrioridadeTarefa, Pais } from "@prisma/client"

// GET - Buscar tarefas (com filtros opcionais)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const processoId = searchParams.get("processoId")
    const responsavelId = searchParams.get("responsavelId")
    const concluida = searchParams.get("concluida")
    const prioridade = searchParams.get("prioridade") as PrioridadeTarefa | null
    const pais = searchParams.get("pais") as Pais | null
    const statusId = searchParams.get("statusId")
    const apenasRaiz = searchParams.get("apenasRaiz")

    const where: any = {}

    if (processoId) {
      where.processoId = parseInt(processoId)
    }

    if (responsavelId) {
      where.responsavelId = parseInt(responsavelId)
    }

    if (concluida !== null && concluida !== undefined && concluida !== "") {
      where.concluida = concluida === "true"
    }

    if (prioridade && Object.values(PrioridadeTarefa).includes(prioridade)) {
      where.prioridade = prioridade
    }

    if (pais && Object.values(Pais).includes(pais)) {
      where.pais = pais
    }

    if (statusId) {
      where.statusId = parseInt(statusId)
    }

    if (apenasRaiz === "true") {
      where.tarefaPaiId = null
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
        },
        status: {
          select: {
            id: true,
            nome: true
          }
        },
        subtarefas: {
          include: {
            responsavel: {
              select: {
                id: true,
                nome: true,
                email: true
              }
            },
            subtarefas: {
              include: {
                responsavel: {
                  select: {
                    id: true,
                    nome: true,
                    email: true
                  }
                }
              },
              orderBy: [
                { ordem: "asc" },
                { createdAt: "asc" }
              ]
            }
          },
          orderBy: [
            { ordem: "asc" },
            { createdAt: "asc" }
          ]
        },
        tarefaPai: {
          select: {
            id: true,
            titulo: true
          }
        }
      },
      orderBy: [
        { concluida: "asc" },
        { prioridade: "desc" },
        { dataPrazo: "asc" },
        { ordem: "asc" },
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

// POST - Criar nova tarefa ou subtarefa
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { 
      titulo, 
      descricao, 
      processoId, 
      responsavelId,
      prioridade,
      dataPrazo,
      statusId,
      pais,
      tarefaPaiId,
      ordem
    } = body

    if (!titulo) {
      return NextResponse.json(
        { error: "Título é obrigatório" },
        { status: 400 }
      )
    }

    if (tarefaPaiId) {
      const tarefaPai = await prisma.tarefa.findUnique({
        where: { id: tarefaPaiId }
      })

      if (!tarefaPai) {
        return NextResponse.json(
          { error: "Tarefa pai não encontrada" },
          { status: 404 }
        )
      }
    }

    if (processoId) {
      const processo = await prisma.processo.findUnique({
        where: { id: processoId }
      })

      if (!processo) {
        return NextResponse.json(
          { error: "Processo não encontrado" },
          { status: 404 }
        )
      }
    }

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

    if (statusId) {
      const status = await prisma.status.findUnique({
        where: { id: statusId }
      })

      if (!status) {
        return NextResponse.json(
          { error: "Status não encontrado" },
          { status: 404 }
        )
      }
    }

    const prioridadeValida = prioridade && Object.values(PrioridadeTarefa).includes(prioridade)
      ? prioridade
      : PrioridadeTarefa.MEDIA

    const paisValido = pais && Object.values(Pais).includes(pais) ? pais : null

    // Calcular ordem se não fornecida
    let ordemFinal = ordem
    if (ordemFinal === undefined || ordemFinal === null) {
      const ultimaTarefa = await prisma.tarefa.findFirst({
        where: tarefaPaiId 
          ? { tarefaPaiId } 
          : { tarefaPaiId: null, processoId: processoId || undefined },
        orderBy: { ordem: "desc" }
      })
      ordemFinal = (ultimaTarefa?.ordem ?? -1) + 1
    }

    const tarefa = await prisma.tarefa.create({
      data: {
        titulo,
        descricao: descricao || null,
        processoId: processoId || null,
        responsavelId: responsavelId || null,
        prioridade: prioridadeValida,
        dataPrazo: dataPrazo ? new Date(dataPrazo) : null,
        statusId: statusId || null,
        pais: paisValido,
        tarefaPaiId: tarefaPaiId || null,
        ordem: ordemFinal
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
        },
        status: {
          select: {
            id: true,
            nome: true
          }
        },
        subtarefas: true,
        tarefaPai: {
          select: {
            id: true,
            titulo: true
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
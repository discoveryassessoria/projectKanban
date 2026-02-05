// src/app/api/tarefas/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { PrioridadeTarefa, Pais } from "@prisma/client"
import { logTarefa } from "@/lib/auditoria"
import { toUTCNoon } from "@/src/lib/date-utils"

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
    const excluirEstruturais = searchParams.get("excluirEstruturais")
    const responsavelEmail = searchParams.get("responsavel")
    const dataInicio = searchParams.get("dataInicio")
    const dataFim = searchParams.get("dataFim")
    const status = searchParams.get("status")

    const where: any = {}

    if (processoId) {
      where.processoId = parseInt(processoId)
    }

    if (responsavelId) {
      where.responsavelId = parseInt(responsavelId)
    }

    // Filtro por email do responsável (vem do FilterModal)
    if (responsavelEmail) {
      const usuario = await prisma.usuario.findFirst({
        where: { email: responsavelEmail },
        select: { id: true }
      })
      if (usuario) {
        where.responsavelId = usuario.id
      }
    }

    // Filtro por status (Pendente/Concluída)
    if (status === 'concluida') {
      where.concluida = true
    } else if (status === 'pendente') {
      where.concluida = false
    }

    if (dataInicio || dataFim) {
  where.dataInicio = {}
  if (dataInicio && dataFim) {
    // Range: de dataInicio até dataFim
    where.dataInicio.gte = new Date(dataInicio + 'T00:00:00.000Z')
    where.dataInicio.lte = new Date(dataFim + 'T23:59:59.999Z')
  } else if (dataInicio) {
    // Só data início: filtra exatamente nesse dia
    where.dataInicio.gte = new Date(dataInicio + 'T00:00:00.000Z')
    where.dataInicio.lte = new Date(dataInicio + 'T23:59:59.999Z')
  } else if (dataFim) {
    // Só data fim: filtra até esse dia
    where.dataInicio.lte = new Date(dataFim + 'T23:59:59.999Z')
  }
}

    if (concluida !== null && concluida !== undefined && concluida !== "") {
      where.concluida = concluida === "true"
    }

    if (prioridade && Object.values(PrioridadeTarefa).includes(prioridade)) {
      where.prioridade = prioridade
    }

    if (pais && Object.values(Pais).includes(pais)) {
      // Filtrar por país da tarefa OU do processo vinculado
      const paisCondition = {
        OR: [
          { pais: pais },
          { processo: { pais: pais } }
        ]
      }
      // Combinar com OR existente (excluirEstruturais) via AND
      if (where.OR) {
        const existingOR = where.OR
        delete where.OR
        where.AND = [...(where.AND || []), { OR: existingOR }, paisCondition]
      } else {
        where.AND = [...(where.AND || []), paisCondition]
      }
    }

    if (statusId) {
      where.statusId = parseInt(statusId)
    }

    if (apenasRaiz === "true") {
      where.tarefaPaiId = null
    }

    if (excluirEstruturais === "true") {
      where.OR = [
        { tarefaPaiId: { not: null } },  // É subtarefa (trabalho real)
        { processoId: null }              // É tarefa independente
      ]
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
                },
                // NÍVEL 3 - Cobranças
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

    // Buscar nome do processo se fornecido
    let processoNome: string | undefined
    if (processoId) {
      const processo = await prisma.processo.findUnique({
        where: { id: processoId },
        select: { nome: true }
      })

      if (!processo) {
        return NextResponse.json(
          { error: "Processo não encontrado" },
          { status: 404 }
        )
      }
      processoNome = processo.nome
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
        dataPrazo: toUTCNoon(dataPrazo),
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

    // ✅ REGISTRAR LOG
    await logTarefa.criar(tarefa.titulo, tarefa.id, processoNome)

    // Auto-criar subtarefas para atividades dentro de "Procuração administrativa"
    if (tarefaPaiId) {
      const tarefaPaiCheck = await prisma.tarefa.findUnique({
        where: { id: tarefaPaiId },
        select: { titulo: true }
      })

      console.log("DEBUG - tarefaPaiId:", tarefaPaiId, "titulo:", tarefaPaiCheck?.titulo)

      if (tarefaPaiCheck?.titulo?.toLowerCase().includes("procuração administrativa")) {
        const subtarefasProcuracao = [
          { titulo: "Preparar procuração administrativa", ordem: 0 },
          { titulo: "Conferir procuração administrativa", ordem: 1 },
          { titulo: `Enviar a procuração administrativa ao cliente para assinar`, ordem: 2 },
        ]

        await prisma.tarefa.createMany({
          data: subtarefasProcuracao.map(sub => ({
            titulo: sub.titulo,
            tarefaPaiId: tarefa.id,
            processoId: tarefa.processoId,
            prioridade: tarefa.prioridade,
            ordem: sub.ordem,
          }))
        })
      }
    }

    return NextResponse.json({ tarefa }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar tarefa:", error)
    return NextResponse.json(
      { error: "Erro ao criar tarefa" },
      { status: 500 }
    )
  }
}
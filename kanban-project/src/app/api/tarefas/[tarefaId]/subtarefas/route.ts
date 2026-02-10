import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { PrioridadeTarefa } from "@prisma/client"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

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

    const tarefaPai = await prisma.tarefa.findUnique({
      where: { id }
    })

    if (!tarefaPai) {
      return NextResponse.json(
        { error: "Tarefa não encontrada" },
        { status: 404 }
      )
    }

    const subtarefas = await prisma.tarefa.findMany({
      where: { tarefaPaiId: id },
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
                nome: true
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
    })

    const total = subtarefas.length
    const concluidas = subtarefas.filter(s => s.concluida).length
    const pendentes = total - concluidas
    const progresso = total > 0 ? Math.round((concluidas / total) * 100) : 0

    return NextResponse.json({ 
      subtarefas,
      estatisticas: {
        total,
        concluidas,
        pendentes,
        progresso
      }
    })
  } catch (error) {
    console.error("Erro ao buscar subtarefas:", error)
    return NextResponse.json(
      { error: "Erro ao buscar subtarefas" },
      { status: 500 }
    )
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tarefaId: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'tarefas.criar')
    if (erro) return erro

    const { tarefaId } = await params
    const tarefaPaiId = parseInt(tarefaId)

    if (isNaN(tarefaPaiId)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    const tarefaPai = await prisma.tarefa.findUnique({
      where: { id: tarefaPaiId }
    })

    if (!tarefaPai) {
      return NextResponse.json(
        { error: "Tarefa pai não encontrada" },
        { status: 404 }
      )
    }

    const body = await request.json()
    const { 
      titulo, 
      descricao, 
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

    const prioridadeValida = prioridade && Object.values(PrioridadeTarefa).includes(prioridade)
      ? prioridade
      : tarefaPai.prioridade

    // Calcular ordem
    const ultimaSubtarefa = await prisma.tarefa.findFirst({
      where: { tarefaPaiId },
      orderBy: { ordem: "desc" }
    })
    const ordem = (ultimaSubtarefa?.ordem ?? -1) + 1

    const subtarefa = await prisma.tarefa.create({
      data: {
        titulo,
        descricao: descricao || null,
        tarefaPaiId,
        processoId: tarefaPai.processoId,
        responsavelId: responsavelId || tarefaPai.responsavelId,
        prioridade: prioridadeValida,
        dataPrazo: dataPrazo ? new Date(dataPrazo) : tarefaPai.dataPrazo,
        statusId: tarefaPai.statusId,
        pais: tarefaPai.pais,
        ordem
      },
      include: {
        responsavel: {
          select: {
            id: true,
            nome: true,
            email: true
          }
        },
        tarefaPai: {
          select: {
            id: true,
            titulo: true
          }
        }
      }
    })

    // Registrar no histórico
    await prisma.tarefaHistorico.create({
      data: {
        tarefaId: tarefaPaiId,
        acao: "CRIADA",
        descricao: `Subtarefa "${titulo}" foi criada`
      }
    })

    // Reabrir tarefa pai se estava concluída
    if (tarefaPai.concluida) {
      await prisma.tarefa.update({
        where: { id: tarefaPaiId },
        data: {
          concluida: false,
          dataConclusao: null
        }
      })
    }

    // Auto-criar subtarefas para atividades dentro de "Procuração administrativa"
    if (tarefaPai.titulo?.toLowerCase().includes("procuração administrativa")) {
      await prisma.tarefa.createMany({
        data: [
          { titulo: "Preparar procuração administrativa", tarefaPaiId: subtarefa.id, processoId: tarefaPai.processoId, prioridade: prioridadeValida, ordem: 0 },
          { titulo: "Conferir procuração administrativa", tarefaPaiId: subtarefa.id, processoId: tarefaPai.processoId, prioridade: prioridadeValida, ordem: 1 },
          { titulo: "Enviar a procuração administrativa ao cliente para assinar", tarefaPaiId: subtarefa.id, processoId: tarefaPai.processoId, prioridade: prioridadeValida, ordem: 2 },
        ]
      })
    }

    if (tarefaPai.titulo?.toLowerCase().includes("procuração judicial")) {
      await prisma.tarefa.createMany({
        data: [
          { titulo: "Preparar procuração judicial", tarefaPaiId: subtarefa.id, processoId: tarefaPai.processoId, prioridade: prioridadeValida, ordem: 0 },
          { titulo: "Conferir procuração judicial", tarefaPaiId: subtarefa.id, processoId: tarefaPai.processoId, prioridade: prioridadeValida, ordem: 1 },
          { titulo: "Enviar a procuração judicial ao cliente para assinar", tarefaPaiId: subtarefa.id, processoId: tarefaPai.processoId, prioridade: prioridadeValida, ordem: 2 },
        ]
      })
    }

    return NextResponse.json({ subtarefa }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar subtarefa:", error)
    return NextResponse.json(
      { error: "Erro ao criar subtarefa" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ tarefaId: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'tarefas.editar')
    if (erro) return erro

    const { tarefaId } = await params
    const tarefaPaiId = parseInt(tarefaId)

    if (isNaN(tarefaPaiId)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { ordem } = body

    if (!Array.isArray(ordem)) {
      return NextResponse.json(
        { error: "Ordem deve ser um array de IDs" },
        { status: 400 }
      )
    }

    const updates = ordem.map((subtarefaId: number, index: number) => 
      prisma.tarefa.update({
        where: { id: subtarefaId },
        data: { ordem: index }
      })
    )

    await prisma.$transaction(updates)

    return NextResponse.json({ message: "Ordem atualizada com sucesso" })
  } catch (error) {
    console.error("Erro ao reordenar subtarefas:", error)
    return NextResponse.json(
      { error: "Erro ao reordenar subtarefas" },
      { status: 500 }
    )
  }
}
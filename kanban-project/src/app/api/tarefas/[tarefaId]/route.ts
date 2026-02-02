// src/app/api/tarefas/[tarefaId]/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { PrioridadeTarefa } from "@prisma/client"
import { logTarefa } from "@/lib/auditoria"

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
        dataConclusao: new Date()
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
            contratantes: {
              select: {
                contratante: {
                  select: {
                    id: true,
                    nome: true
                  }
                }
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
      concluida,
      statusId,
      pais,
      ordem,
      observacoes,
      prazoCobranca
    } = body

    const tarefaExistente = await prisma.tarefa.findUnique({
      where: { id },
      include: {
        subtarefas: {
          select: { id: true, concluida: true }
        }
      }
    })

    if (!tarefaExistente) {
      return NextResponse.json(
        { error: "Tarefa não encontrada" },
        { status: 404 }
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

    if (prioridade && !Object.values(PrioridadeTarefa).includes(prioridade)) {
      return NextResponse.json(
        { error: "Prioridade inválida" },
        { status: 400 }
      )
    }

    const dataAtualizacao: any = {}

    if (titulo !== undefined) dataAtualizacao.titulo = titulo
    if (descricao !== undefined) dataAtualizacao.descricao = descricao
    if (observacoes !== undefined) dataAtualizacao.observacoes = observacoes
    if (responsavelId !== undefined) dataAtualizacao.responsavelId = responsavelId
    if (prioridade !== undefined) dataAtualizacao.prioridade = prioridade
    if (dataPrazo !== undefined) dataAtualizacao.dataPrazo = dataPrazo ? new Date(dataPrazo) : null
    if (statusId !== undefined) dataAtualizacao.statusId = statusId
    if (pais !== undefined) dataAtualizacao.pais = pais
    if (ordem !== undefined) dataAtualizacao.ordem = ordem
    if (prazoCobranca !== undefined) dataAtualizacao.prazoCobranca = prazoCobranca

    // Variável para controlar tipo de log
    let tipoLog: "editar" | "concluir" | "reabrir" = "editar"

    if (concluida !== undefined) {
      if (concluida && !tarefaExistente.concluida) {
        if (tarefaExistente.subtarefas.length > 0) {
          const subtarefasPendentes = tarefaExistente.subtarefas.filter(s => !s.concluida)
          if (subtarefasPendentes.length > 0) {
            return NextResponse.json(
              { error: `Não é possível concluir. Existem ${subtarefasPendentes.length} subtarefa(s) pendente(s).` },
              { status: 400 }
            )
          }
        }
        dataAtualizacao.concluida = true
        dataAtualizacao.dataConclusao = new Date()
        tipoLog = "concluir"
      } 
      else if (!concluida && tarefaExistente.concluida) {
        dataAtualizacao.concluida = false
        dataAtualizacao.dataConclusao = null
        tipoLog = "reabrir"
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
                nome: true
              }
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
      }
    })

    // ✅ REGISTRAR LOG
    if (tipoLog === "concluir") {
      await logTarefa.concluir(tarefa.titulo, tarefa.id)
    } else if (tipoLog === "reabrir") {
      await logTarefa.reabrir(tarefa.titulo, tarefa.id)
    } else {
      await logTarefa.editar(tarefa.titulo, tarefa.id)
    }

    if (concluida && tarefaExistente.tarefaPaiId) {
      await verificarEConcluirTarefaPai(tarefaExistente.tarefaPaiId)
    }

    if (concluida === false && tarefaExistente.tarefaPaiId) {
      await reabrirTarefaPaiSeNecessario(tarefaExistente.tarefaPaiId)
    }

    return NextResponse.json({ tarefa })
  } catch (error) {
    console.error("Erro ao atualizar tarefa:", error)
    return NextResponse.json(
      { error: "Erro ao atualizar tarefa" },
      { status: 500 }
    )
  }
}

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

    const tarefa = await prisma.tarefa.findUnique({
      where: { id },
      include: {
        subtarefas: {
          select: { id: true }
        }
      }
    })

    if (!tarefa) {
      return NextResponse.json(
        { error: "Tarefa não encontrada" },
        { status: 404 }
      )
    }

    const tarefaPaiId = tarefa.tarefaPaiId
    const tituloTarefa = tarefa.titulo

    await prisma.tarefa.delete({
      where: { id }
    })

    // ✅ REGISTRAR LOG
    await logTarefa.excluir(tituloTarefa, id)

    if (tarefaPaiId) {
      await verificarEConcluirTarefaPai(tarefaPaiId)
    }

    return NextResponse.json({ 
      message: "Tarefa excluída com sucesso",
      subtarefasExcluidas: tarefa.subtarefas.length
    })
  } catch (error) {
    console.error("Erro ao excluir tarefa:", error)
    return NextResponse.json(
      { error: "Erro ao excluir tarefa" },
      { status: 500 }
    )
  }
}
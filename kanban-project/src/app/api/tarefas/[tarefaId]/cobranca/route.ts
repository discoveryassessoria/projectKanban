// src/app/api/tarefas/[tarefaId]/cobranca/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// POST - Ações de cobrança (recebido, cobrado, não possui, alterar prazo)
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

    const body = await request.json()
    const { acao, observacao, novoPrazo, diasCobranca = 5 } = body

    // Buscar tarefa com pai e avô (para montar título completo)
    const tarefa = await prisma.tarefa.findUnique({
      where: { id },
      include: {
        tarefaPai: {
          include: {
            tarefaPai: true // Avô - a atividade (ex: Carol)
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

    // Determinar se é uma subtarefa de cobrança ou uma tarefa normal
    const isCobranca = tarefa.tipoSubtarefa === "COBRANCA"
    
    // Se for cobrança, o pai é a tarefa (RG) e o avô é a atividade (Carol)
    // Se for tarefa normal (RG), ela mesma é a tarefa e o pai é a atividade (Carol)
    const tarefaDocumento = isCobranca ? tarefa.tarefaPai : tarefa
    const atividadePessoa = isCobranca ? tarefa.tarefaPai?.tarefaPai : tarefa.tarefaPai

    switch (acao) {
      case "recebido": {
        if (isCobranca) {
          // Concluir subtarefa de cobrança e tarefa pai (documento)
          await prisma.$transaction([
            prisma.tarefa.update({
              where: { id },
              data: {
                concluida: true,
                statusTarefa: "CONCLUIDO_RECEBIDO",
                dataConclusao: new Date(),
                observacoes: observacao || "Documento recebido"
              }
            }),
            prisma.tarefa.update({
              where: { id: tarefa.tarefaPaiId! },
              data: {
                concluida: true,
                statusTarefa: "CONCLUIDO_RECEBIDO",
                dataConclusao: new Date(),
                observacoes: observacao || "Documento recebido"
              }
            })
          ])
        } else {
          // Concluir tarefa diretamente
          await prisma.tarefa.update({
            where: { id },
            data: {
              concluida: true,
              statusTarefa: "CONCLUIDO_RECEBIDO",
              dataConclusao: new Date(),
              observacoes: observacao || "Documento recebido"
            }
          })
        }
        
        return NextResponse.json({ 
          message: "Tarefa concluída - documento recebido",
          tarefaConcluida: true
        })
      }

      case "cobrado": {
        // Calcular nova data de cobrança
        const novaDataCobranca = new Date()
        novaDataCobranca.setDate(novaDataCobranca.getDate() + diasCobranca)
        novaDataCobranca.setHours(12, 0, 0, 0)

        // Montar título: "Cobrar RG: Carol"
        const tituloCobranca = `Cobrar ${tarefaDocumento?.titulo || "Documento"}: ${atividadePessoa?.titulo || ""}`

        if (isCobranca) {
          // Concluir cobrança atual e criar nova como irmã (mesmo pai = tarefa documento)
          const [_, novaSubtarefa] = await prisma.$transaction([
            prisma.tarefa.update({
              where: { id },
              data: {
                concluida: true,
                dataConclusao: new Date(),
                observacoes: observacao || "Cobrado, aguardando retorno"
              }
            }),
            prisma.tarefa.create({
              data: {
                titulo: tituloCobranca.trim(),
                tarefaPaiId: tarefa.tarefaPaiId!, // Mesmo pai (tarefa documento)
                processoId: tarefa.processoId,
                prioridade: tarefa.prioridade,
                dataPrazo: novaDataCobranca,
                dataInicio: new Date(),
                tipoSubtarefa: "COBRANCA",
                statusTarefa: "AGUARDANDO_CLIENTE",
                quantidadeCobrancas: (tarefa.quantidadeCobrancas || 0) + 1,
                ultimaCobranca: new Date(),
                ordem: (tarefa.ordem || 0) + 1
              }
            })
          ])

          return NextResponse.json({ 
            message: "Nova cobrança agendada",
            novaSubtarefa
          })
        } else {
          // Criar cobrança como FILHA da tarefa (RG -> Cobrar RG: Carol)
          // E atualizar status da tarefa para AGUARDANDO_CLIENTE
          const [tarefaAtualizada, novaSubtarefa] = await prisma.$transaction([
            prisma.tarefa.update({
              where: { id },
              data: {
                statusTarefa: "AGUARDANDO_CLIENTE",
                quantidadeCobrancas: { increment: 1 },
                ultimaCobranca: new Date()
              }
            }),
            prisma.tarefa.create({
              data: {
                titulo: tituloCobranca.trim(),
                tarefaPaiId: id, // Cobrança é FILHA da tarefa documento (RG)
                processoId: tarefa.processoId,
                prioridade: tarefa.prioridade,
                dataPrazo: novaDataCobranca,
                dataInicio: new Date(),
                tipoSubtarefa: "COBRANCA",
                statusTarefa: "AGUARDANDO_CLIENTE",
                ordem: 0
              }
            })
          ])

          return NextResponse.json({ 
            message: "Cobrança criada",
            novaSubtarefa,
            tarefaAtualizada
          })
        }
      }

      case "nao_possui": {
        if (isCobranca) {
          // Concluir subtarefa e tarefa pai como "não aplicável"
          await prisma.$transaction([
            prisma.tarefa.update({
              where: { id },
              data: {
                concluida: true,
                statusTarefa: "CONCLUIDO_NAO_POSSUI",
                dataConclusao: new Date(),
                observacoes: observacao || "Cliente não possui o documento"
              }
            }),
            prisma.tarefa.update({
              where: { id: tarefa.tarefaPaiId! },
              data: {
                concluida: true,
                statusTarefa: "CONCLUIDO_NAO_POSSUI",
                dataConclusao: new Date(),
                observacoes: observacao || "Cliente não possui o documento"
              }
            })
          ])
        } else {
          await prisma.tarefa.update({
            where: { id },
            data: {
              concluida: true,
              statusTarefa: "CONCLUIDO_NAO_POSSUI",
              dataConclusao: new Date(),
              observacoes: observacao || "Cliente não possui o documento"
            }
          })
        }

        return NextResponse.json({ 
          message: "Tarefa finalizada - cliente não possui",
          tarefaConcluida: true
        })
      }

      case "alterar_prazo": {
        if (!novoPrazo) {
          return NextResponse.json(
            { error: "Novo prazo é obrigatório" },
            { status: 400 }
          )
        }

        await prisma.tarefa.update({
          where: { id },
          data: {
            dataPrazo: new Date(novoPrazo + "T12:00:00"),
            observacoes: observacao
          }
        })

        return NextResponse.json({ 
          message: "Prazo alterado com sucesso"
        })
      }

      case "conferencia": {
  // Calcular data de conferência
  const novaDataConferencia = new Date()
  novaDataConferencia.setDate(novaDataConferencia.getDate() + diasCobranca)
  novaDataConferencia.setHours(12, 0, 0, 0)

  // Montar título: "Conferir Preparar procuração: Carol"
  const tituloConferencia = `Conferir ${tarefaDocumento?.titulo || "Documento"}: ${atividadePessoa?.titulo || ""}`

  // Pegar responsavelId do body (opcional)
  const { responsavelId } = body

  if (isCobranca) {
    // Concluir cobrança atual e criar conferência como irmã
    const [_, novaSubtarefa] = await prisma.$transaction([
      prisma.tarefa.update({
        where: { id },
        data: {
          concluida: true,
          dataConclusao: new Date(),
          observacoes: observacao || "Enviado para conferência"
        }
      }),
      prisma.tarefa.create({
        data: {
          titulo: tituloConferencia.trim(),
          tarefaPaiId: tarefa.tarefaPaiId!,
          processoId: tarefa.processoId,
          prioridade: tarefa.prioridade,
          dataPrazo: novaDataConferencia,
          dataInicio: new Date(),
          tipoSubtarefa: "CONFERENCIA",
          statusTarefa: "AGUARDANDO_TERCEIRO",
          responsavelId: responsavelId || null,
          ordem: (tarefa.ordem || 0) + 1
        }
      })
    ])

    return NextResponse.json({ 
      message: "Conferência agendada",
      novaSubtarefa
    })
  } else {
    // Criar conferência como FILHA da tarefa
    const [tarefaAtualizada, novaSubtarefa] = await prisma.$transaction([
      prisma.tarefa.update({
        where: { id },
        data: {
          statusTarefa: "AGUARDANDO_TERCEIRO"
        }
      }),
      prisma.tarefa.create({
        data: {
          titulo: tituloConferencia.trim(),
          tarefaPaiId: id,
          processoId: tarefa.processoId,
          prioridade: tarefa.prioridade,
          dataPrazo: novaDataConferencia,
          dataInicio: new Date(),
          tipoSubtarefa: "CONFERENCIA",
          statusTarefa: "AGUARDANDO_TERCEIRO",
          responsavelId: responsavelId || null,
          ordem: 0
        }
      })
    ])

    return NextResponse.json({ 
      message: "Conferência criada",
      novaSubtarefa,
      tarefaAtualizada
    })
  }
}

      default:
        return NextResponse.json(
          { error: "Ação inválida" },
          { status: 400 }
        )
    }
  } catch (error) {
    console.error("Erro na ação de cobrança:", error)
    return NextResponse.json(
      { error: "Erro ao processar ação" },
      { status: 500 }
    )
  }
}
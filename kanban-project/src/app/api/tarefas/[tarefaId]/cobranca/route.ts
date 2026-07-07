// src/app/api/tarefas/[tarefaId]/cobranca/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { hojeBrasil, hojeBrasilMaisDias } from "@/src/lib/date-utils"
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { negarSeNaoForDonoDaTarefa } from "@/src/lib/tarefa-acesso"

async function iniciarProximaSubtarefa(tarefaConcluidaId: number, tarefaPaiId: number) {
  console.log("🔄 [COBRANCA] iniciarProximaSubtarefa chamada:", { tarefaConcluidaId, tarefaPaiId })
  
  const subtarefas = await prisma.tarefa.findMany({
    where: { tarefaPaiId },
    orderBy: [
      { ordem: 'asc' },
      { createdAt: 'asc' }
    ]
  })

  const indexAtual = subtarefas.findIndex(s => s.id === tarefaConcluidaId)
  if (indexAtual === -1 || indexAtual >= subtarefas.length - 1) {
    console.log("🔄 [COBRANCA] Sem próxima subtarefa")
    return
  }

  const proxima = subtarefas[indexAtual + 1]

  if (proxima.dataInicio) {
    console.log("🔄 [COBRANCA] Próxima já iniciada:", proxima.titulo)
    return
  }

  const prazoFinal = proxima.prazoCobranca || 5

  await prisma.tarefa.update({
    where: { id: proxima.id },
    data: {
      dataInicio: hojeBrasil(),
      dataPrazo: hojeBrasilMaisDias(prazoFinal),
      prazoCobranca: prazoFinal
    }
  })

  await prisma.tarefaHistorico.create({
    data: {
      tarefaId: proxima.id,
      acao: "INICIADA",
      descricao: `Tarefa iniciada automaticamente com prazo de ${prazoFinal} dias`
    }
  })

  console.log("✅ [COBRANCA] Próxima subtarefa iniciada:", proxima.titulo)
}

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

// POST - Ações de cobrança (recebido, cobrado, não possui, alterar prazo)
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

    // 🔒 E4 — só o dono (ou admin) faz ação de cobrança nesta tarefa.
    const negado = await negarSeNaoForDonoDaTarefa(request, tarefa.responsavelId)
    if (negado) return negado

    // Determinar se é uma subtarefa de cobrança ou uma tarefa normal
    const isCobranca = tarefa.tipoSubtarefa === "COBRANCA"
    
    // Se for cobrança, o pai é a tarefa (RG) e o avô é a atividade (Carol)
    // Se for tarefa normal (RG), ela mesma é a tarefa e o pai é a atividade (Carol)
    const tarefaDocumento = isCobranca ? tarefa.tarefaPai : tarefa
    const atividadePessoa = isCobranca ? tarefa.tarefaPai?.tarefaPai : tarefa.tarefaPai
    const tarefaIdHistorico = isCobranca ? (tarefa.tarefaPaiId || id) : id

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
                dataConclusao: hojeBrasil(),
                observacoes: observacao || "Documento recebido"
              }
            }),
            prisma.tarefa.update({
              where: { id: tarefa.tarefaPaiId! },
              data: {
                concluida: true,
                statusTarefa: "CONCLUIDO_RECEBIDO",
                dataConclusao: hojeBrasil(),
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
              dataConclusao: hojeBrasil(),
              observacoes: observacao || "Documento recebido"
            }
          })
        }

        // Propagar conclusão para cima
        const paiIdRecebido = isCobranca ? tarefa.tarefaPai?.tarefaPaiId : tarefa.tarefaPaiId
        if (paiIdRecebido) {
          await verificarEConcluirTarefaPai(paiIdRecebido)
        }

        // ✅ Iniciar próxima subtarefa automaticamente
        const tarefaConcluidaId = isCobranca ? tarefa.tarefaPaiId! : id
        const paiParaProgressao = isCobranca ? tarefa.tarefaPai?.tarefaPaiId : tarefa.tarefaPaiId
        if (paiParaProgressao) {
          await iniciarProximaSubtarefa(tarefaConcluidaId, paiParaProgressao)
        }

        await prisma.tarefaHistorico.create({
          data: {
            tarefaId: tarefaIdHistorico,
            acao: "CONCLUIDA",
            descricao: `Documento recebido${observacao ? `: ${observacao}` : ""}`
          }
        })
        
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
                dataConclusao: hojeBrasil(),
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

          await prisma.tarefaHistorico.create({
            data: {
              tarefaId: tarefaIdHistorico,
              acao: "COBRADA",
              descricao: `Cobrança realizada - próxima em ${diasCobranca} dias`
            }
          })

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

          await prisma.tarefaHistorico.create({
            data: {
              tarefaId: tarefaIdHistorico,
              acao: "COBRADA",
              descricao: `Cobrança agendada para ${diasCobranca} dias`
            }
          })

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
                dataConclusao: hojeBrasil(),
                observacoes: observacao || "Cliente não possui o documento"
              }
            }),
            prisma.tarefa.update({
              where: { id: tarefa.tarefaPaiId! },
              data: {
                concluida: true,
                statusTarefa: "CONCLUIDO_NAO_POSSUI",
                dataConclusao: hojeBrasil(),
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
              dataConclusao: hojeBrasil(),
              observacoes: observacao || "Cliente não possui o documento"
            }
          })
        }

        // Propagar conclusão para cima
        const paiIdNaoPossui = isCobranca ? tarefa.tarefaPai?.tarefaPaiId : tarefa.tarefaPaiId
        if (paiIdNaoPossui) {
          await verificarEConcluirTarefaPai(paiIdNaoPossui)
        }

        await prisma.tarefaHistorico.create({
          data: {
            tarefaId: tarefaIdHistorico,
            acao: "CONCLUIDA",
            descricao: `Cliente não possui o documento${observacao ? `: ${observacao}` : ""}`
          }
        })

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

        await prisma.tarefaHistorico.create({
          data: {
            tarefaId: tarefaIdHistorico,
            acao: "STATUS_ALTERADO",
            descricao: `Prazo alterado para ${novoPrazo}${observacao ? ` - ${observacao}` : ""}`
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
          dataConclusao: hojeBrasil(),
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

    await prisma.tarefaHistorico.create({
      data: {
        tarefaId: tarefaIdHistorico,
        acao: "CONFERENCIA",
        descricao: `Enviado para conferência - prazo de ${diasCobranca} dias`
      }
    })

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

    await prisma.tarefaHistorico.create({
      data: {
        tarefaId: tarefaIdHistorico,
        acao: "CONFERENCIA",
        descricao: `Enviado para conferência - prazo de ${diasCobranca} dias`
      }
    })

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
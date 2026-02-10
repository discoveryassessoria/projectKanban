import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { hojeBrasil } from "@/src/lib/date-utils"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tarefaId: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'tarefas.iniciar_concluir')
    if (erro) return erro

    const { tarefaId } = await params
    const id = parseInt(tarefaId)
    
    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }
    
    const { status, usuarioId } = await request.json()

    const tarefaAtual = await prisma.tarefa.findUnique({
      where: { id }
    })

    if (!tarefaAtual) {
      return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 })
    }

    let statusTarefa: any
    let observacaoTexto: string
    let motivoConclusao: string

    if (status === "recebido") {
      statusTarefa = "CONCLUIDO_RECEBIDO"
      observacaoTexto = "✅ Documento recebido"
      motivoConclusao = "recebido"
    } else if (status === "nao_possui") {
      statusTarefa = "CONCLUIDO_NAO_POSSUI"
      observacaoTexto = "Cliente não possui o documento"
      motivoConclusao = "nao_possui"
    } else {
      return NextResponse.json({ error: "Status inválido" }, { status: 400 })
    }

    const tarefa = await prisma.tarefa.update({
      where: { id },
      data: {
        statusTarefa,
        concluida: true,
        dataConclusao: hojeBrasil(),
        motivoConclusao,
        observacoes: tarefaAtual.observacoes 
          ? `${tarefaAtual.observacoes}\n${observacaoTexto}` 
          : observacaoTexto
      }
    })

    // Registra no histórico
    await prisma.tarefaHistorico.create({
      data: {
        tarefaId: id,
        usuarioId: usuarioId || null,
        acao: status === "recebido" ? "CONCLUIDA_RECEBIDO" : "CONCLUIDA_NAO_POSSUI",
        descricao: observacaoTexto,
        dados: {
          statusAnterior: tarefaAtual.statusTarefa,
          statusNovo: statusTarefa
        }
      }
    })

    return NextResponse.json({ tarefa })
  } catch (error) {
    console.error("Erro ao concluir tarefa:", error)
    return NextResponse.json({ error: "Erro ao concluir tarefa" }, { status: 500 })
  }
}
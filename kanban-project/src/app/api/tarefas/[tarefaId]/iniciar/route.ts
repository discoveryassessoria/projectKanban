// src/app/api/tarefas/[tarefaId]/iniciar/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { hojeBrasil, hojeBrasilMaisDias } from "@/src/lib/date-utils"
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { negarSeNaoForDonoDaTarefa } from "@/src/lib/tarefa-acesso"
import { iniciarTarefa } from "@/src/services/task-step-sync"

// POST - Iniciar tarefa (SEM criar cobrança)
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

    const body = await request.json().catch(() => ({}))
    const { prazoCobranca = 5 } = body

    // Buscar tarefa
    const tarefa = await prisma.tarefa.findUnique({
      where: { id }
    })

    if (!tarefa) {
      return NextResponse.json(
        { error: "Tarefa não encontrada" },
        { status: 404 }
      )
    }

    // 🔒 E4 — só o dono (ou admin) inicia esta tarefa.
    const negado = await negarSeNaoForDonoDaTarefa(request, tarefa.responsavelId)
    if (negado) return negado

    // CP-4D — delegação ao runtime v2 (inicia o Passo junto). Legado intacto se não for v2.
    if (tarefa.workflowStepInstanceId && tarefa.processoId) {
      const proc = await prisma.processo.findUnique({ where: { id: tarefa.processoId }, select: { workflowRuntime: true } })
      const cfg = await prisma.motorConfig.findUnique({ where: { id: 1 }, select: { runtimeV2Habilitado: true } })
      if ((cfg?.runtimeV2Habilitado ?? false) && proc?.workflowRuntime === "v2") {
        const r = await iniciarTarefa(id, { origem: "USER", usuarioId: body.usuarioId })
        return NextResponse.json(r, { status: r.success ? 200 : 409 })
      }
    }

    // Verificar se já foi iniciada
    if (tarefa.dataInicio) {
      return NextResponse.json(
        { error: "Tarefa já foi iniciada" },
        { status: 400 }
      )
    }

    // Calcular dataPrazo baseado no prazoCobranca
    const prazoFinal = prazoCobranca || tarefa.prazoCobranca || 5
    // Usar meio-dia UTC para evitar problemas de timezone
    // Obter data atual no fuso do Brasil
    const hoje = hojeBrasil()
    const dataPrazo = hojeBrasilMaisDias(prazoFinal)

    const tarefaAtualizada = await prisma.tarefa.update({
      where: { id },
      data: {
        dataInicio: hoje,
        dataPrazo,
        prazoCobranca: prazoFinal,
        statusTarefa: "EM_ANDAMENTO"
      }
    })

    // Registrar no histórico
    await prisma.tarefaHistorico.create({
      data: {
        tarefaId: id,
        acao: "INICIADA",
        descricao: `Tarefa iniciada com prazo de ${prazoFinal} dias`
      }
    })

    return NextResponse.json({ 
      tarefa: tarefaAtualizada
    })
  } catch (error) {
    console.error("Erro ao iniciar tarefa:", error)
    return NextResponse.json(
      { error: "Erro ao iniciar tarefa" },
      { status: 500 }
    )
  }
}
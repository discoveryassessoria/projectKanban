// src/app/api/tarefas/[tarefaId]/concluir/route.ts
// ============================================================================
// CASCA FINA — conclui a tarefa pelo motor canônico e mais nada.
//
// Esta rota já teve um segundo caminho: quando o runtime v2 estava desligado
// (ou a tarefa não tinha passo), ela escrevia `prisma.tarefa.update` direto,
// concluía a tarefa e NÃO tocava no passo. Era a mesma conclusão com duas
// regras — e a que não passava pelo motor não emitia WorkflowEvento, não
// projetava o passo e não deixava rastro no outbox. O estado do passo e o da
// tarefa passavam a discordar sobre a MESMA execução.
//
// Hoje há um caminho só: `concluirTarefa` (task-step-sync), dono das transições
// e de seus efeitos. A rota valida quem pode e delega.
// ============================================================================
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { negarSeNaoForDonoDaTarefa } from "@/src/lib/tarefa-acesso"
import { concluirTarefa } from "@/src/services/task-step-sync"
import { tentarAvancoAutomatico } from "@/src/lib/motor/auto-avanco"

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
      where: { id },
      select: { id: true, responsavelId: true, processoId: true, workflowStepInstanceId: true },
    })
    if (!tarefaAtual) {
      return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 })
    }

    // 🔒 E4 — só o dono (ou admin) conclui esta tarefa.
    const negado = await negarSeNaoForDonoDaTarefa(request, tarefaAtual.responsavelId)
    if (negado) return negado

    // "Cliente não possui o documento" é uma conclusão de natureza DIFERENTE, e
    // o motor canônico ainda não a distingue. Recusar é honesto; concluir como
    // "recebido" registraria um documento que não existe.
    if (status === "nao_possui") {
      return NextResponse.json(
        { error: "Conclusão por 'não possui' ainda não existe no motor canônico — registre a dispensa da etapa.", codigo: "NAO_SUPORTADO" },
        { status: 422 },
      )
    }

    if (!tarefaAtual.workflowStepInstanceId) {
      return NextResponse.json(
        { error: "Tarefa sem etapa vinculada não pode ser concluída por esta porta.", codigo: "SEM_ETAPA" },
        { status: 409 },
      )
    }

    const r = await concluirTarefa(id, { origem: "USER", usuarioId })
    // AUTO-AVANÇO: concluída a tarefa, se a fase ficou sem pendências o card vai sozinho.
    if (r.success) await tentarAvancoAutomatico(tarefaAtual.processoId)
    return NextResponse.json(r, { status: r.success ? 200 : 409 })
  } catch (error) {
    console.error("Erro ao concluir tarefa:", error)
    return NextResponse.json({ error: "Erro ao concluir tarefa" }, { status: 500 })
  }
}

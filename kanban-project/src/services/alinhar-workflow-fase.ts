// src/services/alinhar-workflow-fase.ts
//
// ALINHAMENTO bespoke → Workflow Interno V2.
//
// As fases "por-processo" (Análise, Tradução, Apostilamento, Retificação, Emissão
// Retificada, fases finais) têm um fluxo bespoke em tabelas próprias (AnaliseDocumental,
// PastaTraducao, …) E um Workflow Interno V2 (PhaseWorkflowStepInstance) cujos passos
// obrigatórios são o GATE oficial do avanço. Quando o fluxo bespoke conclui a fase, os
// passos V2 ficavam abertos → o gate nunca liberava → o card não avançava sozinho.
//
// Este helper fecha esse desalinhamento: ao concluir o fluxo bespoke, conclui — pelo
// SERVIÇO CANÔNICO (concluirPasso: idempotente, sincroniza Tarefa, emite eventos/outbox)
// — todos os passos OBRIGATÓRIOS ainda abertos da instância ativa da fase. Com o gate
// liberado, `tentarAvancoAutomatico` efetiva a transição. Best-effort: NUNCA lança
// (não pode derrubar a rota bespoke que o chamou).
//
// A transição direta p/ CONCLUIDO é válida (precedência monotônica: DISPONIVEL/AGUARDANDO
// → CONCLUIDO). Passos que exigem aprovação param em AGUARDANDO_APROVACAO e são aprovados
// pelo sistema (sem violar segregação: aprovador do sistema é nulo).

import { prisma } from "@/lib/prisma"
import { WorkflowInstanceStatus } from "@prisma/client"
import { concluirPasso, aprovarPasso } from "@/src/services/task-step-sync"

const INSTANCIA_ATIVA: WorkflowInstanceStatus[] = [
  WorkflowInstanceStatus.ATIVO,
  WorkflowInstanceStatus.AGUARDANDO,
  WorkflowInstanceStatus.BLOQUEADO,
]

const PASSO_FEITO = new Set(["CONCLUIDO", "DISPENSADO", "SUPERSEDIDO", "CANCELADO", "FALHOU"])

/**
 * Conclui o Workflow Interno V2 da fase (passos obrigatórios abertos) da instância ATIVA,
 * refletindo a conclusão do fluxo bespoke. Retorna quantos passos foram efetivamente
 * concluídos. Best-effort.
 */
export async function concluirWorkflowInternoDaFase(
  processoId: number,
  faseMacroKey: string,
): Promise<{ concluidos: number }> {
  let concluidos = 0
  try {
    const inst = await prisma.phaseWorkflowInstance.findFirst({
      where: { processoId, faseMacroKey, status: { in: INSTANCIA_ATIVA } },
      orderBy: { ciclo: "desc" },
      include: {
        steps: {
          where: { obrigatorio: true },
          orderBy: { ordem: "asc" },
          select: { id: true, status: true },
        },
      },
    })
    if (!inst) return { concluidos }

    for (const s of inst.steps) {
      if (PASSO_FEITO.has(String(s.status))) continue
      await concluirPasso(s.id, { origem: "SYSTEM" })
      // Se exige aprovação, parou em AGUARDANDO_APROVACAO — aprova pelo sistema.
      const depois = await prisma.phaseWorkflowStepInstance.findUnique({ where: { id: s.id }, select: { status: true } })
      if (depois?.status === "AGUARDANDO_APROVACAO") {
        await aprovarPasso(s.id, { origem: "SYSTEM" })
      }
      concluidos++
    }
  } catch (e) {
    console.error(`[alinhar-workflow-fase] falhou p/ processo ${processoId} fase ${faseMacroKey}:`, e)
  }
  return { concluidos }
}

// src/app/api/operacao/tarefas/[tarefaId]/navegacao/route.ts
// ============================================================================
// ONDE ESTÁ ESTE TRABALHO — a resolução do deep-link, no servidor.
//
//   GET /api/operacao/tarefas/{taskId}/navegacao
//
// A Central precisa de IDs para se posicionar: qual pessoa expandir, qual
// documento destacar, qual passo é o atual. Resolver isso no cliente exigiria
// que a tela confiasse na URL — e a URL é do usuário.
//
// ─── POR QUE ISTO É UMA ROTA, E NÃO UMA FUNÇÃO NO FRONT ─────────────────────
// Trocar o número na barra de endereços é o gesto mais fácil do mundo. Aqui a
// permissão é conferida ANTES de devolver qualquer id: quem não pode ver a
// tarefa não descobre nem a que processo ela pertence.
//
// Rota de LEITURA: não escreve, não inicia, não avança nada.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { negarSeNaoForDonoDaTarefa } from '@/src/lib/tarefa-acesso'
import type { AlvoResolvido } from '@/lib/operacional/navegacao'

export async function GET(request: NextRequest, ctx: { params: Promise<{ tarefaId: string }> }) {
  const taskId = Number((await ctx.params).tarefaId)
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return NextResponse.json({ error: 'tarefa inválida' }, { status: 400 })
  }
  const erro = await verificarPermissao(request, 'tarefas.ver')
  if (erro) return erro

  const t = await prisma.tarefa.findUnique({
    where: { id: taskId },
    select: {
      id: true, titulo: true, processoId: true, pessoaId: true, documentoId: true,
      necessidadeId: true, workflowInstanceId: true, workflowStepInstanceId: true,
      statusTarefa: true, causaRemovidaEm: true, responsavelId: true,
      workflowStepInstance: { select: { pessoaId: true, documentoId: true } },
    },
  })
  // NÃO EXISTE e NÃO POSSO VER respondem a mesma coisa de propósito: distinguir
  // as duas ensina quem sonda a URL a mapear o que existe do outro lado.
  if (!t || t.processoId == null) {
    return NextResponse.json({ error: 'tarefa não encontrada' }, { status: 404 })
  }
  const negado = await negarSeNaoForDonoDaTarefa(request, t.responsavelId)
  if (negado) return negado

  const alvo: AlvoResolvido = {
    taskId: t.id,
    processoId: t.processoId,
    // O passo é mais específico que a tarefa: quando ele nomeia a pessoa ou o
    // documento, é ele que diz onde a Central deve parar.
    pessoaId: t.workflowStepInstance?.pessoaId ?? t.pessoaId ?? null,
    documentoId: t.workflowStepInstance?.documentoId ?? t.documentoId ?? null,
    necessidadeId: t.necessidadeId,
    workflowInstanceId: t.workflowInstanceId,
    stepInstanceId: t.workflowStepInstanceId,
    statusTarefa: t.statusTarefa,
    requerDecisao: t.causaRemovidaEm != null,
    titulo: t.titulo,
  }
  return NextResponse.json({ alvo })
}

// src/app/api/operacao/tarefas/[tarefaId]/route.ts
// ============================================================================
// A TAREFA OPERACIONAL — leitura completa de UM trabalho.
//
//   GET /api/operacao/tarefas/{tarefaId}
//
// Devolve o cabeçalho (quem, o quê, qual processo, qual fase, prazo, status) e
// o WORKFLOW INTERNO: as etapas DESTA tarefa, na ordem, com a corrente marcada.
//
// Não é "dossiê" nem entidade nova: é a mesma `Tarefa` que a fila já mostra,
// lida com o detalhe que a execução exige. O `taskId` é o mesmo da linha
// clicada — e continua o mesmo do primeiro ao último passo.
//
// Rota de leitura. Executar etapa, iniciar, esperar e concluir saem todos por
// `POST /api/tarefas/{id}/comando`.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { dossieDaTarefa } from '@/lib/operacional/tarefa-projecoes'

export async function GET(request: NextRequest, ctx: { params: Promise<{ tarefaId: string }> }) {
  const erro = await verificarPermissao(request, 'tarefas.ver')
  if (erro) return erro

  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  const tarefaId = Number((await ctx.params).tarefaId)
  if (!Number.isInteger(tarefaId) || tarefaId <= 0) {
    return NextResponse.json({ error: 'tarefa inválida' }, { status: 400 })
  }

  const tarefa = await dossieDaTarefa(tarefaId)
  if (!tarefa) return NextResponse.json({ error: 'Tarefa não encontrada' }, { status: 404 })

  return NextResponse.json({
    tarefa,
    // O que ESTE usuário pode fazer com ESTA tarefa. A tela usa isto para não
    // oferecer o que o backend recusaria — e o backend confere de novo, sempre.
    podeExecutar: usuario.permissoes['tarefas.iniciar_concluir'] === true && tarefa.responsavelId === usuario.userId,
    podeDistribuir: usuario.permissoes['tarefas.editar'] === true,
    podeForcar: usuario.tipo === 'admin',
  })
}

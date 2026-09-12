// src/app/api/notificacoes/[id]/lida/route.ts
// ============================================================================
// MARCAR NOTIFICAÇÃO COMO LIDA — Etapa 4, item 17 (RBAC) / CASO 17.
//
// A ÚNICA coisa que este endpoint faz é chamar `marcarNotificacaoComoLida`,
// que só atualiza `NotificacaoOperacional.lidaEm`. Ler/arquivar uma
// notificação NUNCA altera Tarefa, workflow, prazo, SLA, ownership,
// acompanhamento, atenção, fase ou histórico — não há nenhuma outra escrita
// aqui, de propósito (a regra-mãe da Etapa 4).
//
// RBAC: só o PRÓPRIO destinatário marca a sua notificação como lida — a
// checagem está dentro de `marcarNotificacaoComoLida`, não duplicada aqui.
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { marcarNotificacaoComoLida } from '@/lib/operacional/notificacao-canonica'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const { id } = await params
  const notificacaoId = parseInt(id)
  if (isNaN(notificacaoId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  try {
    const r = await marcarNotificacaoComoLida(prisma, { notificacaoId, usuarioId: usuario.userId })
    if (!r.ok) {
      const status = r.codigo === 'NAO_ENCONTRADA' ? 404 : 403
      return NextResponse.json({ error: r.codigo }, { status })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao marcar notificação como lida:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

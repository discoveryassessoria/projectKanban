// src/app/api/notificacoes/marcar-todas/route.ts
// ============================================================================
// MARCAR TODAS COMO LIDAS — o botão do sino (redesenho 29/09/2026).
//
// Só o `lidaEm` dos avisos do PRÓPRIO usuário; nunca toca Tarefa, workflow, prazo, fase
// ou histórico (regra-mãe da porta de notificação).
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { marcarTodasComoLidas } from '@/lib/operacional/notificacao-canonica'

export async function POST(request: NextRequest) {
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  try {
    const r = await marcarTodasComoLidas(prisma, usuario.userId)
    return NextResponse.json({ ok: true, quantidade: r.quantidade })
  } catch (error) {
    console.error('Erro ao marcar todas as notificações como lidas:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

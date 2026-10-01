// src/app/api/comentarios/mencoes/route.ts
// ============================================================================
// MENÇÕES NÃO LIDAS DO USUÁRIO — a "notificação" do Bloco E4 (29/09/2026).
//
//   GET   /api/comentarios/mencoes            minhas menções não lidas
//   PATCH /api/comentarios/mencoes  {id}       marca UMA como lida
//
//   PATCH /api/comentarios/mencoes  {processoId} marca TODAS as do processo (a página do processo chama ao abrir #comentarios)
// A entrega no sino (tipo MENCAO) mora em `comentario-tarefa.ts`; abrir o aviso do sino também marca lida.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { mencoesNaoLidas, marcarMencaoComoLida } from '@/src/services/comentario-tarefa'
import { prisma } from '@/lib/prisma'
import { marcarMencoesDoProcessoComoLidas } from '@/lib/operacional/notificacao-canonica'

export async function GET(request: NextRequest) {
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const mencoes = await mencoesNaoLidas(usuario.userId)
  return NextResponse.json({ mencoes })
}

export async function PATCH(request: NextRequest) {
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const b = await request.json().catch(() => ({}))
  // Abrir a página do processo (#comentarios) lê TODAS as menções dela de uma vez: { processoId }.
  if (b?.processoId != null) {
    const processoId = Number(b.processoId)
    if (!Number.isInteger(processoId) || processoId <= 0) return NextResponse.json({ error: 'processoId inválido' }, { status: 400 })
    const r = await marcarMencoesDoProcessoComoLidas(prisma, { usuarioId: usuario.userId, processoId })
    return NextResponse.json({ ok: true, quantidade: r.quantidade })
  }
  const id = Number(b?.id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'id inválido' }, { status: 400 })
  const r = await marcarMencaoComoLida(id, usuario.userId)
  if (!r.ok) return NextResponse.json({ error: 'menção não encontrada, já lida, ou não é sua' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

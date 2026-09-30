// src/app/api/comentarios/mencoes/route.ts
// ============================================================================
// MENÇÕES NÃO LIDAS DO USUÁRIO — a "notificação" do Bloco E4 (29/09/2026).
//
//   GET   /api/comentarios/mencoes            minhas menções não lidas
//   PATCH /api/comentarios/mencoes  {id}       marca UMA como lida
//
// Decidido separado do sino (`notificacao-canonica.ts`, em redesenho
// paralelo): ver `src/services/comentario-tarefa.ts`.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { mencoesNaoLidas, marcarMencaoComoLida } from '@/src/services/comentario-tarefa'

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
  const id = Number(b?.id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'id inválido' }, { status: 400 })
  const r = await marcarMencaoComoLida(id, usuario.userId)
  if (!r.ok) return NextResponse.json({ error: 'menção não encontrada, já lida, ou não é sua' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

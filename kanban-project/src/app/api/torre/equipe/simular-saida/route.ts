// POST /api/torre/equipe/simular-saida { usuarioId, dias? } — o impacto ANTES de aplicar (Bloco H1).
// SÓ LEITURA: não grava tarefa, ausência nem auditoria de mudança — é só o cálculo de hoje.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { simularSaida } from '@/lib/operacional/torre-equipe'

export async function POST(request: NextRequest) {
  const { erro } = await exigirTorre(request, 'usuarios.gerenciar')
  if (erro) return erro
  const b = await request.json().catch(() => ({}))
  const usuarioId = Number(b?.usuarioId)
  const dias = b?.dias == null ? 10 : Number(b.dias)
  if (!Number.isInteger(usuarioId) || usuarioId <= 0) return NextResponse.json({ error: 'usuarioId é obrigatório' }, { status: 400 })
  if (!Number.isInteger(dias) || dias < 1 || dias > 365) return NextResponse.json({ error: 'dias deve ser de 1 a 365' }, { status: 400 })
  const s = await simularSaida(usuarioId, dias)
  if (!s) return NextResponse.json({ error: 'pessoa não encontrada' }, { status: 404 })
  return NextResponse.json(s)
}

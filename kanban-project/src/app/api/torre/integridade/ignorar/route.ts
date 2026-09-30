// POST /api/torre/integridade/ignorar { achadoId, justificativa } — "Ignorar 7 d" (Bloco I1).
// Grava quem, quando (atualizadoEm) e até quando (ignoradoAte) no achado, e uma linha de LogAuditoria.
// O achado segue visível no painel de Saúde; só sai da lista da Torre até o prazo vencer.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { ignorar7Dias } from '@/src/services/precisa-de-voce-acoes'

export async function POST(request: NextRequest) {
  const { usuario, erro } = await exigirTorre(request, 'usuarios.gerenciar')
  if (erro) return erro
  const b = await request.json().catch(() => ({}))
  const achadoId = Number(b?.achadoId)
  const justificativa = typeof b?.justificativa === 'string' ? b.justificativa.trim() : ''
  if (!Number.isInteger(achadoId) || achadoId <= 0) return NextResponse.json({ error: 'achadoId é obrigatório' }, { status: 400 })
  if (!justificativa) return NextResponse.json({ error: 'A justificativa é obrigatória.' }, { status: 400 })
  const r = await ignorar7Dias(achadoId, justificativa, usuario.userId)
  return NextResponse.json(r, { status: r.ok ? 200 : 422 })
}

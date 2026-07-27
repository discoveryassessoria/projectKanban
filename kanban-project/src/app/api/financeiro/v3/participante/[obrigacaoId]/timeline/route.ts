// GET /api/financeiro/v3/participante/[obrigacaoId]/timeline
// Timeline INDIVIDUAL do participante (pagamentos, estornos, cobranças enviadas,
// vencimentos). NUNCA eventos globais. Só leitura.
// Gate: financeiro.ver + flag posicaoRead.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { timelineIndividualParticipante } from '@/lib/financeiro/leitura/timeline-financeira'
import { usuarioFlag } from '../../../_flags'

export async function GET(req: NextRequest, { params }: { params: Promise<{ obrigacaoId: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) return NextResponse.json({ disponivel: false, fallbackLegado: true }, { status: 409 })
  const obrigacaoId = Number((await params).obrigacaoId)
  if (!obrigacaoId) return NextResponse.json({ erro: 'obrigacaoId inválido' }, { status: 400 })
  return NextResponse.json({ disponivel: true, escopo: 'individual', eventos: await timelineIndividualParticipante(obrigacaoId) })
}

// GET /api/financeiro/v3/participante/[obrigacaoId]/conta
// Conta financeira individual do participante (obrigação-filha). Só leitura.
// Gate: financeiro.ver + flag posicaoRead (padrão das rotas V3).
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { carregarContaParticipante } from '@/lib/financeiro/leitura/participante-conta'
import { usuarioFlag } from '../../../_flags'

export async function GET(req: NextRequest, { params }: { params: Promise<{ obrigacaoId: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) return NextResponse.json({ disponivel: false, fallbackLegado: true }, { status: 409 })
  const obrigacaoId = Number((await params).obrigacaoId)
  if (!obrigacaoId) return NextResponse.json({ erro: 'obrigacaoId inválido' }, { status: 400 })
  const conta = await carregarContaParticipante(obrigacaoId)
  if (!conta) return NextResponse.json({ disponivel: false }, { status: 404 })
  return NextResponse.json({ disponivel: true, conta })
}

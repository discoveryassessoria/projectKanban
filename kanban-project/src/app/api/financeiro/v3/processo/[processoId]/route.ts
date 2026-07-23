// /api/financeiro/v3/processo/[processoId] — posição financeira do processo (Ledger).
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { carregarPosicaoProcesso } from '@/lib/financeiro/leitura/posicao-processo'
import { usuarioFlag } from '../../_flags'

export async function GET(req: NextRequest, { params }: { params: Promise<{ processoId: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) return NextResponse.json({ disponivel: false, fallbackLegado: true }, { status: 409 })
  const processoId = Number((await params).processoId)
  if (!processoId) return NextResponse.json({ erro: 'processoId inválido' }, { status: 400 })
  const posicao = await carregarPosicaoProcesso(processoId)
  return NextResponse.json({ disponivel: true, posicao })
}

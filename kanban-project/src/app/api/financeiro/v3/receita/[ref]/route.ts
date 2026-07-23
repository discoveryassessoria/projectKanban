// /api/financeiro/v3/receita/[ref] — detalhe da Receita (tela oficial V3).
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { carregarReceitaDetalhe } from '@/lib/financeiro/leitura/receita-detalhe'
import { usuarioFlag } from '../../_flags'

export async function GET(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) return NextResponse.json({ disponivel: false, fallbackLegado: true }, { status: 409 })
  const receita = await carregarReceitaDetalhe((await params).ref)
  if (!receita) return NextResponse.json({ disponivel: false }, { status: 404 })
  return NextResponse.json({ disponivel: true, receita })
}

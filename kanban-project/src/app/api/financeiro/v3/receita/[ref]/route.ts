// /api/financeiro/v3/receita/[ref] — detalhe da Receita (tela oficial V3).
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { carregarReceitaDetalhe, carregarReceitaConsolidada } from '@/lib/financeiro/leitura/receita-detalhe'
import { usuarioFlag } from '../../_flags'

export async function GET(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) return NextResponse.json({ disponivel: false, fallbackLegado: true }, { status: 409 })
  const ref = (await params).ref
  // ?obrigacao=<id> → visão de UM participante (single). Caso contrário → visão CONSOLIDADA do grupo.
  const obrigacao = req.nextUrl.searchParams.get('obrigacao')
  const receita = obrigacao
    ? await carregarReceitaDetalhe(obrigacao)
    : await carregarReceitaConsolidada(ref)
  if (!receita) return NextResponse.json({ disponivel: false }, { status: 404 })
  return NextResponse.json({ disponivel: true, receita })
}

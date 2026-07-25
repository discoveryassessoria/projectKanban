// GET /api/financeiro/v3/receita/[ref]/escopo
// Dados do drawer "Definir escopo do pagamento": participantes + cobranças abertas
// da Receita consolidada. Flag-gated (posicaoRead). Somente leitura.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { usuarioFlag } from '../../../_flags'
import { carregarEscopoPagamento } from '@/lib/financeiro/leitura/escopo-pagamento'

export async function GET(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const u = await usuarioFlag(req)
  if (!flagAtiva('ocorrencias', u) && !flagAtiva('posicaoRead', u)) {
    return NextResponse.json({ ok: false, erro: 'Escopo V3 não habilitado.' }, { status: 409 })
  }
  const { ref } = await params
  try {
    const escopo = await carregarEscopoPagamento(ref)
    if (!escopo) return NextResponse.json({ ok: false, erro: 'Receita não encontrada.' }, { status: 404 })
    return NextResponse.json({ ok: true, escopo })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao carregar escopo.' }, { status: 422 })
  }
}

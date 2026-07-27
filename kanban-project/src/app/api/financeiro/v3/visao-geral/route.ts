// GET /api/financeiro/v3/visao-geral?processoId= — fonte ÚNICA V3 para a
// Visão Geral Financeira do Processo (src/components/financeiro/subabas/VisaoGeral.tsx).
// Substitui os fetches legados (/api/financeiro/receitas + /custos) e os
// nativos (/v3/obrigacoes?origemTipo=nativo): tudo sourced de
// ObrigacaoEconomica, com parcelas reais. Ver lib/financeiro/leitura/visao-geral-processo.ts.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { carregarVisaoGeralProcesso } from '@/lib/financeiro/leitura/visao-geral-processo'
import { usuarioFlag } from '../_flags'

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) return NextResponse.json({ disponivel: false, fallbackLegado: true }, { status: 409 })
  const processoId = Number(req.nextUrl.searchParams.get('processoId'))
  if (!processoId) return NextResponse.json({ erro: 'processoId inválido' }, { status: 400 })
  try {
    const { receitas, custos } = await carregarVisaoGeralProcesso(processoId)
    return NextResponse.json({ disponivel: true, receitas, custos })
  } catch (e) {
    return NextResponse.json({ disponivel: false, erro: e instanceof Error ? e.message : 'Falha ao carregar a visão geral financeira.' }, { status: 500 })
  }
}

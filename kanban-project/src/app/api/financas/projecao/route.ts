// §6 — GET /api/financas/projecao — Financeiro Geral como PROJEÇÃO (leitura) dos
// lançamentos de origem (Receita/Custo) + corporativos (ContaPagar). Fonte única.
import { NextRequest, NextResponse } from 'next/server'
import { projetarFinanceiroGeral } from '@/lib/financeiro/financeiro-geral-projecao'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

export async function GET(req: NextRequest) {
  // 🔒 Sem checagem nenhuma antes — expunha a projeção financeira geral pra
  // qualquer usuário autenticado.
  const erro = await verificarPermissao(req, 'financeiro.ver')
  if (erro) return erro
  try {
    const projecao = await projetarFinanceiroGeral()
    return NextResponse.json(projecao)
  } catch (e) {
    console.error('GET financas/projecao', e)
    return NextResponse.json({ error: 'Erro ao projetar Financeiro Geral' }, { status: 500 })
  }
}

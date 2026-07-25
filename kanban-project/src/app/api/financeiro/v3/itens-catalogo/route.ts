// /api/financeiro/v3/itens-catalogo — itens do Catálogo Mestre (Gerenciamento)
// para o lançamento manual de Custo. Leitura enxuta, gated por 'financeiro.ver'
// (o cadastro/edição continua exclusivo do Gerenciamento). Fonte ÚNICA:
// ItemCatalogo. Nunca cria/edita — só lista itens ATIVOS.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const NAT_RECEITA = ['SERVICO', 'HONORARIO', 'PRODUTO', 'TAXA', 'OUTRO', 'LOGISTICA']

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  // ?paraReceita=1 (ou natureza=RECEITA): só itens ELEGÍVEIS a Receita manual — ativos,
  // natureza compatível e com Configuração Financeira que permita receita (não só-custo).
  const paraReceita = req.nextUrl.searchParams.get('paraReceita') === '1' || req.nextUrl.searchParams.get('natureza') === 'RECEITA'
  let itens = await prisma.itemCatalogo.findMany({
    where: { ativo: true, ...(paraReceita ? { natureza: { in: NAT_RECEITA as never } } : {}) },
    orderBy: [{ natureza: 'asc' }, { name: 'asc' }],
    select: { id: true, code: true, name: true, natureza: true, categoria: true, unidade: true },
  })
  if (paraReceita && itens.length) {
    const configs = await prisma.produtoFinanceiro.findMany({
      where: { itemCatalogoId: { in: itens.map((i) => i.id) }, OR: [{ naturezaFin: { in: ['SOMENTE_RECEITA', 'CUSTO_E_RECEITA'] } }, { possuiReceita: true }] },
      select: { itemCatalogoId: true },
    }).catch(() => [] as { itemCatalogoId: number | null }[])
    const okIds = new Set(configs.map((c) => c.itemCatalogoId).filter((v): v is number => v != null))
    itens = itens.filter((i) => okIds.has(i.id))
  }
  return NextResponse.json({ itens })
}

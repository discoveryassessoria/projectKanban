// /api/financeiro/v3/itens-catalogo — itens do Catálogo Mestre (Gerenciamento)
// para o lançamento manual de Custo. Leitura enxuta, gated por 'financeiro.ver'
// (o cadastro/edição continua exclusivo do Gerenciamento). Fonte ÚNICA:
// ItemCatalogo. Nunca cria/edita — só lista itens ATIVOS.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const itens = await prisma.itemCatalogo.findMany({
    where: { ativo: true },
    orderBy: [{ natureza: 'asc' }, { name: 'asc' }],
    select: { id: true, code: true, name: true, natureza: true, categoria: true, unidade: true },
  })
  return NextResponse.json({ itens })
}

// /api/financeiro/v3/centros-custo — centros de custo ativos p/ o lançamento
// manual de custo. Leitura enxuta gated por 'financeiro.ver' (o cadastro fica no
// Gerenciamento). Fonte única: CentroCusto.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const centros = await prisma.centroCusto.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } })
  return NextResponse.json({ centros })
}

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { sincronizarItemDeServico } from '@/src/services/catalogo-sync'

function toStrOrNull(v: any): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}
function toIdArray(v: any): number[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => Number(x)).filter((n) => Number.isFinite(n))
}

// GET - Listar serviços (com itens vinculados) + todos os itens do Catálogo Financeiro (p/ checkboxes)
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const [servicos, produtosFinanceiros] = await Promise.all([
      prisma.servicoProduto.findMany({
        orderBy: { code: 'asc' },
        include: { itensFinanceiros: { select: { id: true, codigo: true, nome: true } } },
      }),
      prisma.produtoFinanceiro.findMany({
        orderBy: { codigo: 'asc' },
        select: { id: true, codigo: true, nome: true },
      }),
    ])

    return NextResponse.json({ servicos, produtosFinanceiros })
  } catch (error) {
    console.error('Erro ao listar produtos e serviços:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - Criar serviço
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const b = await request.json()
    if (!b.code || !String(b.code).trim()) {
      return NextResponse.json({ error: 'Informe o código.' }, { status: 400 })
    }
    if (!b.name || !String(b.name).trim()) {
      return NextResponse.json({ error: 'Informe o nome.' }, { status: 400 })
    }

    const ids = toIdArray(b.itensFinanceirosIds)
    const code = String(b.code).trim()
    const name = String(b.name).trim()
    const category = toStrOrNull(b.category)
    // LOTE B — dual-write: ItemCatalogo (mestre) primeiro; vincula ServicoProduto por ID.
    const servico = await prisma.$transaction(async (tx) => {
      const itemCatalogoId = await sincronizarItemDeServico(tx, { code, name, category })
      return tx.servicoProduto.create({
        data: {
          code,
          name,
          category,
          nationality: (b.nationality && String(b.nationality).trim()) || 'all',
          ativo: b.ativo !== undefined ? !!b.ativo : true,
          itemCatalogoId,
          itensFinanceiros: ids.length ? { connect: ids.map((id) => ({ id })) } : undefined,
        },
        include: { itensFinanceiros: { select: { id: true, codigo: true, nome: true } } },
      })
    })

    return NextResponse.json({ servico })
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return NextResponse.json({ error: 'Já existe um serviço com esse código.' }, { status: 409 })
    }
    console.error('Erro ao criar produto/serviço:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
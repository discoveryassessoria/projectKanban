import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { sincronizarItemDeServico } from '@/src/services/catalogo-sync'

function toStrOrNull(v: any): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}
// GET - Cadastro MESTRE operacional de Serviços (sem financeiro).
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    // A relação M2M legada (itensFinanceiros) permanece no banco (dados preservados),
    // mas NÃO é exibida/gerenciada aqui — o vínculo financeiro é feito em Configurações Financeiras.
    const servicos = await prisma.servicoProduto.findMany({ orderBy: { code: 'asc' } })

    return NextResponse.json({ servicos })
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

    const code = String(b.code).trim()
    const name = String(b.name).trim()
    const category = toStrOrNull(b.category)
    // dual-write: ItemCatalogo (mestre, natureza SERVICO) — é o que o Financeiro referencia.
    const servico = await prisma.$transaction(async (tx) => {
      const itemCatalogoId = await sincronizarItemDeServico(tx, { code, name, category })
      return tx.servicoProduto.create({
        data: {
          code,
          name,
          category,
          descricao: toStrOrNull(b.descricao),
          unidadePadrao: b.unidadePadrao || null,
          nationality: (b.nationality && String(b.nationality).trim()) || 'all',
          ativo: b.ativo !== undefined ? !!b.ativo : true,
          itemCatalogoId,
        },
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
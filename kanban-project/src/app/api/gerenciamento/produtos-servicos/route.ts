import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { sincronizarItemDeServico } from '@/src/services/catalogo-sync'
import { garantirConfigFinanceiraDeServico } from '@/src/services/config-financeira-auto'
import { slugTecnico, gerarChaveUnica } from '@/src/lib/catalogo/chave-tecnica-interna'

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
    //
    // ADITIVO: o espelho no Cadastro Mestre vem junto (natureza/unidade + contadores
    // de vínculo). É o que permite ao Catálogo de Serviços ser a ÚNICA tela sobre o
    // mestre — mostrando tipo, unidade e vínculos sem uma segunda tela técnica.
    const servicos = await prisma.servicoProduto.findMany({
      orderBy: { code: 'asc' },
      include: {
        itemCatalogo: {
          select: {
            id: true, natureza: true, unidade: true,
            _count: { select: { tiposDocumento: true, produtos: true, servicos: true, precos: true } },
          },
        },
      },
    })

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
    if (!b.name || !String(b.name).trim()) {
      return NextResponse.json({ error: 'Informe o nome.' }, { status: 400 })
    }

    const name = String(b.name).trim()
    const category = toStrOrNull(b.category)
    // dual-write: ItemCatalogo (mestre, natureza SERVICO) — é o que o Financeiro referencia.
    const servico = await prisma.$transaction(async (tx) => {
      // CHAVE TÉCNICA INTERNA: gerada no backend a partir do nome (o operador NUNCA
      // informa nem vê `code`). Igual ao publicCode — automática, única, invisível.
      const code = await gerarChaveUnica(slugTecnico(name, 'SERVICO'), async (c) =>
        !!(await tx.servicoProduto.findUnique({ where: { code: c }, select: { id: true } })) ||
        !!(await tx.itemCatalogo.findUnique({ where: { code: c }, select: { id: true } })),
      )
      const itemCatalogoId = await sincronizarItemDeServico(tx, { code, name, category })
      const s = await tx.servicoProduto.create({
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
      // FLUXO: Cadastro Mestre (Serviço) → Configuração Financeira criada AUTOMATICAMENTE
      // (vínculo estrutural itemCatalogoId; idempotente). Não cria preço — só a config.
      await garantirConfigFinanceiraDeServico(tx, { itemCatalogoId, nome: name })
      return s
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
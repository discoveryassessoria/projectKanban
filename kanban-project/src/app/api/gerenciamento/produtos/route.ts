// src/app/api/gerenciamento/produtos/route.ts
// GET  - Listar produtos financeiros / itens cobrados
// POST - Criar produto (Catálogo Financeiro)
// Campos do mockup: codigo(req), nome(req), especie, naturezaFinanceira,
//   categoriaId(→Categoria), planoContaId(→Conta contábil), moedaPadrao,
//   valorPadrao, cobravelDoCliente, custoInterno, repasse, reembolsavel.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { sincronizarItemDeProduto } from '@/src/services/catalogo-sync'

const MOEDAS = ['BRL', 'EUR', 'USD']
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
function parseDecimal(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// GET - Listar
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    // F3.2 — além dos itens, devolve os MESTRES para o select pesquisável por origem.
    const [produtos, tiposDocumento, servicos, honorarios, tiposProcesso, fornecedores] = await Promise.all([
      prisma.produtoFinanceiro.findMany({
        orderBy: { nome: 'asc' },
        include: {
          categoria: { select: { id: true, nome: true } },
          planoConta: { select: { id: true, codigo: true, nome: true } },
        },
      }),
      prisma.tipoDocumentoCadastro.findMany({ where: { ativo: true }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.itemCatalogo.findMany({ where: { natureza: 'SERVICO', ativo: true }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.honorario.findMany({ where: { ativo: true }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.tipoProcessoNacionalidade.findMany({ where: { ativo: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.fornecedor.findMany({ where: { ativo: true }, select: { id: true, nome: true }, orderBy: { nome: 'asc' } }),
    ])

    return NextResponse.json({ produtos, mestres: { tiposDocumento, servicos, honorarios, tiposProcesso, fornecedores } })
  } catch (error) {
    console.error('Erro ao listar produtos:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - Criar
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const b = await request.json()

    if (!b.codigo || !String(b.codigo).trim()) {
      return NextResponse.json({ error: 'Código é obrigatório' }, { status: 400 })
    }
    if (!b.nome || !String(b.nome).trim()) {
      return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 })
    }
    if (b.moedaPadrao && !MOEDAS.includes(b.moedaPadrao)) {
      return NextResponse.json({ error: 'Moeda inválida' }, { status: 400 })
    }

    const codigo = String(b.codigo).trim()
    const nome = String(b.nome).trim()
    const PAPEIS_VALIDOS = ['CUSTO', 'RECEITA', 'REPASSE', 'REEMBOLSO', 'DESPESA_INTERNA', 'TAXA', 'HONORARIO']
    // LOTE B — dual-write: ItemCatalogo (mestre, natureza PRODUTO) e vínculo por ID.
    const produto = await prisma.$transaction(async (tx) => {
      // F3.2 — o pivô itemCatalogoId vem do MESTRE escolhido (não recria mirror):
      //   documento → itemCatalogo do TipoDocumento;  serviço → o próprio ItemCatalogo.
      //   Só cria mirror PRD_ quando não há mestre com item (honorário/processo/legado).
      let itemCatalogoId: number | null = null
      if (b.tipoDocumentoId) {
        const td = await tx.tipoDocumentoCadastro.findUnique({ where: { id: Number(b.tipoDocumentoId) }, select: { itemCatalogoId: true } })
        itemCatalogoId = td?.itemCatalogoId ?? null
      } else if (b.itemCatalogoId) {
        itemCatalogoId = Number(b.itemCatalogoId)
      }
      if (itemCatalogoId == null) itemCatalogoId = await sincronizarItemDeProduto(tx, { codigo, nome })
      return tx.produtoFinanceiro.create({
        data: {
          codigo,
          nome,
          especie: s(b.especie),
          naturezaFinanceira: b.naturezaFinanceira || 'revenue',
          categoriaId: b.categoriaId ? Number(b.categoriaId) : null,
          planoContaId: b.planoContaId ? Number(b.planoContaId) : null,
          moedaPadrao: b.moedaPadrao || 'BRL',
          valorPadrao: parseDecimal(b.valorPadrao),
          cobravelDoCliente: !!b.cobravelDoCliente,
          custoInterno: !!b.custoInterno,
          repasse: !!b.repasse,
          reembolsavel: !!b.reembolsavel,
          ativo: b.ativo === undefined ? true : !!b.ativo,
          // F3 — Configuração Financeira: papel + FKs diretas aos mestres reais (não recria mestre)
          papelFinanceiro: PAPEIS_VALIDOS.includes(String(b.papelFinanceiro)) ? b.papelFinanceiro : (((b.naturezaFinanceira || 'revenue') === 'cost') ? 'CUSTO' : 'RECEITA'),
          tipoDocumentoId: b.tipoDocumentoId ? Number(b.tipoDocumentoId) : null,
          honorarioId: b.honorarioId ? Number(b.honorarioId) : null,
          tipoProcessoId: b.tipoProcessoId ? Number(b.tipoProcessoId) : null,
          fornecedorPadraoId: b.fornecedorPadraoId ? Number(b.fornecedorPadraoId) : null,
          itemCatalogoId,
        },
      })
    })

    return NextResponse.json({ produto }, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar produto:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
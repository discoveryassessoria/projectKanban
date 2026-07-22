import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { validarTaxa, paraColunasTaxa } from './campos'

// GET — taxas + cadastros de apoio (formas/moedas/serviços) para os seletores.
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const [taxas, formasPagamento, moedas, servicos] = await Promise.all([
      prisma.taxaPagamento.findMany({ orderBy: [{ prioridade: 'desc' }, { name: 'asc' }] }),
      prisma.formaPagamentoCadastro.findMany({ where: { ativo: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      prisma.moedaCadastro.findMany({ orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } }),
      prisma.servicoProduto.findMany({ where: { ativo: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, code: true } }),
    ])

    return NextResponse.json({ taxas, formasPagamento, moedas, servicos })
  } catch (error) {
    console.error('Erro ao listar taxas de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST — Criar taxa
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const b = await request.json()
    const erros = validarTaxa(b)
    if (erros.length) return NextResponse.json({ error: erros[0].mensagem, erros }, { status: 400 })

    const taxa = await prisma.taxaPagamento.create({ data: paraColunasTaxa(b) })
    return NextResponse.json({ taxa })
  } catch (error) {
    console.error('Erro ao criar taxa de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

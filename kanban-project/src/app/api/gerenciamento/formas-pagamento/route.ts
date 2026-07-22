import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { gerarCodigoPublico } from '@/lib/codigos/code-generator'
import { validarForma, paraColunasForma } from './campos'

// GET — formas + cadastros de apoio (moedas/carteiras/contas) para os seletores.
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const [formasPagamento, moedas, carteiras, contas] = await Promise.all([
      prisma.formaPagamentoCadastro.findMany({ orderBy: [{ ordem: 'asc' }, { name: 'asc' }] }),
      prisma.moedaCadastro.findMany({ where: { ativo: true }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } }),
      prisma.carteiraRecebimento.findMany({ where: { ativo: true }, orderBy: [{ isDefault: 'desc' }, { nome: 'asc' }], select: { id: true, nome: true, moeda: true } }),
      prisma.contaBancaria.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true, moeda: true } }),
    ])

    return NextResponse.json({ formasPagamento, moedas, carteiras, contas })
  } catch (error) {
    console.error('Erro ao listar formas de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST — Criar forma de pagamento
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const b = await request.json()
    const erros = validarForma(b)
    if (erros.length) return NextResponse.json({ error: erros[0].mensagem, erros }, { status: 400 })

    // Código público FPG-n: gerado pelo CodeGeneratorService (sequência atômica, sem
    // reuso) dentro da mesma transação da criação. Nunca vem do cliente.
    const forma = await prisma.$transaction(async (tx) => {
      const code = await gerarCodigoPublico(tx, 'PAYMENT_METHOD')
      return tx.formaPagamentoCadastro.create({ data: { ...paraColunasForma(b), code } })
    })
    return NextResponse.json({ forma })
  } catch (error) {
    console.error('Erro ao criar forma de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

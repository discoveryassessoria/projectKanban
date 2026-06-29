// src/app/api/gerenciamento/contas/[id]/route.ts
// PUT    - Atualizar conta bancária
// DELETE - Excluir conta bancária (bloqueia se houver movimento)
//
// ✅ Next 15: params é Promise → await params.
// REFEITA p/ mockup: edita bankId, tipoConta, moeda, iban, swift,
//   isDefaultReceiving, isDefaultPayment. saldoAtual NÃO é editado aqui.
// Só UMA conta padrão recebimento e só UMA padrão pagamento.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const MOEDAS = ['BRL', 'EUR', 'USD']

function parseDecimal(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// PUT - Atualizar
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idParam } = await params
    const id = Number(idParam)
    if (!id || Number.isNaN(id)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const atual = await prisma.contaBancaria.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 })
    }

    const body = await request.json()
    const {
      nome, bankId, tipoConta, moeda, agencia, conta, iban, swift,
      chavePix, saldoInicial, cor, ativo, isDefaultReceiving, isDefaultPayment,
    } = body

    if (nome !== undefined && !nome.trim()) {
      return NextResponse.json({ error: 'Nome não pode ficar vazio' }, { status: 400 })
    }
    if (moeda !== undefined && moeda && !MOEDAS.includes(moeda)) {
      return NextResponse.json({ error: 'Moeda inválida' }, { status: 400 })
    }

    const ehReceb = isDefaultReceiving !== undefined ? !!isDefaultReceiving : atual.isDefaultReceiving
    const ehPgto = isDefaultPayment !== undefined ? !!isDefaultPayment : atual.isDefaultPayment

    const contaAtualizada = await prisma.$transaction(async (tx) => {
      if (ehReceb) {
        await tx.contaBancaria.updateMany({ where: { id: { not: id } }, data: { isDefaultReceiving: false } })
      }
      if (ehPgto) {
        await tx.contaBancaria.updateMany({ where: { id: { not: id } }, data: { isDefaultPayment: false } })
      }
      return tx.contaBancaria.update({
        where: { id },
        data: {
          nome: nome?.trim() ?? atual.nome,
          bankId: bankId !== undefined ? (bankId ? Number(bankId) : null) : atual.bankId,
          tipoConta: tipoConta !== undefined ? (tipoConta || null) : atual.tipoConta,
          moeda: moeda !== undefined ? (moeda || 'BRL') : atual.moeda,
          agencia: agencia !== undefined ? (agencia?.trim() || null) : atual.agencia,
          conta: conta !== undefined ? (conta?.trim() || null) : atual.conta,
          iban: iban !== undefined ? (iban?.trim() || null) : atual.iban,
          swift: swift !== undefined ? (swift?.trim() || null) : atual.swift,
          chavePix: chavePix !== undefined ? (chavePix?.trim() || null) : atual.chavePix,
          saldoInicial: saldoInicial !== undefined ? parseDecimal(saldoInicial) : atual.saldoInicial,
          // saldoAtual NÃO mexe aqui (mantido pelos lançamentos)
          cor: cor !== undefined ? (cor || null) : atual.cor,
          ativo: ativo !== undefined ? !!ativo : atual.ativo,
          isDefaultReceiving: ehReceb,
          isDefaultPayment: ehPgto,
        },
      })
    })

    return NextResponse.json({ conta: contaAtualizada })
  } catch (error) {
    console.error('Erro ao atualizar conta:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// DELETE - Excluir
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idParam } = await params
    const id = Number(idParam)
    if (!id || Number.isNaN(id)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const atual = await prisma.contaBancaria.findUnique({
      where: { id },
      include: { _count: { select: { contasPagar: true, transacoes: true } } },
    })
    if (!atual) {
      return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 })
    }

    const { contasPagar, transacoes } = atual._count
    if (contasPagar > 0 || transacoes > 0) {
      const partes: string[] = []
      if (contasPagar > 0) partes.push(`${contasPagar} conta(s) a pagar`)
      if (transacoes > 0) partes.push(`${transacoes} transação(ões)`)
      return NextResponse.json(
        { error: `Conta com movimento (${partes.join(', ')}). Não é possível excluir — desative-a no lugar.` },
        { status: 409 }
      )
    }

    await prisma.contaBancaria.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir conta:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
// src/app/api/gerenciamento/contas/route.ts
// GET  - Listar contas bancárias
// POST - Criar conta bancária
//
// REFEITA p/ bater com o mockup (fin_accounts):
//   nome, bankId(→Banco), tipoConta(accountType), moeda(BRL/EUR/USD),
//   agencia, conta(accountNumber), iban, swift, chavePix(pixKey),
//   isDefaultReceiving, isDefaultPayment + saldoInicial/cor/ativo (mantidos).
// Regras: saldoAtual = saldoInicial na criação. Só UMA conta "padrão
//   recebimento" e só UMA "padrão pagamento" (independentes).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const MOEDAS = ['BRL', 'EUR', 'USD']

function parseDecimal(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// GET - Listar
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const contas = await prisma.contaBancaria.findMany({
      orderBy: [{ isDefaultPayment: 'desc' }, { nome: 'asc' }],
      include: {
        bank: { select: { id: true, nome: true, sigla: true } },
        _count: { select: { contasPagar: true, transacoes: true } },
      },
    })

    return NextResponse.json({ contas })
  } catch (error) {
    console.error('Erro ao listar contas:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - Criar
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const body = await request.json()
    const {
      nome, bankId, tipoConta, moeda, agencia, conta, iban, swift,
      chavePix, saldoInicial, cor, ativo, isDefaultReceiving, isDefaultPayment,
    } = body

    if (!nome || !nome.trim()) {
      return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 })
    }
    if (moeda && !MOEDAS.includes(moeda)) {
      return NextResponse.json({ error: 'Moeda inválida' }, { status: 400 })
    }

    const saldo = parseDecimal(saldoInicial)
    const ehReceb = !!isDefaultReceiving
    const ehPgto = !!isDefaultPayment

    const novaConta = await prisma.$transaction(async (tx) => {
      if (ehReceb) await tx.contaBancaria.updateMany({ data: { isDefaultReceiving: false } })
      if (ehPgto) await tx.contaBancaria.updateMany({ data: { isDefaultPayment: false } })
      return tx.contaBancaria.create({
        data: {
          nome: nome.trim(),
          bankId: bankId ? Number(bankId) : null,
          tipoConta: tipoConta || null,
          moeda: moeda || 'BRL',
          agencia: agencia?.trim() || null,
          conta: conta?.trim() || null,
          iban: iban?.trim() || null,
          swift: swift?.trim() || null,
          chavePix: chavePix?.trim() || null,
          saldoInicial: saldo,
          saldoAtual: saldo,
          cor: cor || null,
          ativo: ativo === undefined ? true : !!ativo,
          isDefaultReceiving: ehReceb,
          isDefaultPayment: ehPgto,
        },
      })
    })

    return NextResponse.json({ conta: novaConta }, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar conta:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
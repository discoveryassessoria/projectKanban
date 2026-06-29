// src/app/api/gerenciamento/bancos/route.ts
// GET  - Listar bancos
// POST - Criar banco
//
// Tabela Banco (nova). Campos do mockup (fin_banks):
//   codigo, nome (obrigatório), sigla, pais, website, ativo.
// Banco é referenciado por ContaBancaria (bankId).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// GET - Listar
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const bancos = await prisma.banco.findMany({
      orderBy: { nome: 'asc' },
      include: { _count: { select: { contas: true } } },
    })

    return NextResponse.json({ bancos })
  } catch (error) {
    console.error('Erro ao listar bancos:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - Criar
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const body = await request.json()
    const { codigo, nome, sigla, pais, website, ativo } = body

    if (!nome || !nome.trim()) {
      return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 })
    }

    const banco = await prisma.banco.create({
      data: {
        codigo: codigo?.trim() || null,
        nome: nome.trim(),
        sigla: sigla?.trim() || null,
        pais: pais?.trim() || null,
        website: website?.trim() || null,
        ativo: ativo === undefined ? true : !!ativo,
      },
    })

    return NextResponse.json({ banco }, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar banco:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
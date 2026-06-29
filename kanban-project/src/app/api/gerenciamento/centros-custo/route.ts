// src/app/api/gerenciamento/centros-custo/route.ts
// GET  - Listar centros de custo
// POST - Criar centro de custo
//
// Mesmo padrão das rotas de Perfis (/api/perfis):
//   - guard verificarPermissao(request, 'usuarios.gerenciar')
//   - prisma de '@/lib/prisma'
//   - resposta embrulhada: { centros } / { centro }
// Tabela CentroCusto já existe no schema (nome, descricao, cor, ativo).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// GET - Listar
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const centros = await prisma.centroCusto.findMany({
      orderBy: { nome: 'asc' },
    })

    return NextResponse.json({ centros })
  } catch (error) {
    console.error('Erro ao listar centros de custo:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - Criar
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const body = await request.json()
    const { nome, descricao, cor, ativo } = body

    if (!nome || !nome.trim()) {
      return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 })
    }

    const centro = await prisma.centroCusto.create({
      data: {
        nome: nome.trim(),
        descricao: descricao?.trim() || null,
        cor: cor || null,
        ativo: ativo === undefined ? true : !!ativo,
      },
    })

    return NextResponse.json({ centro }, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar centro de custo:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
// src/app/api/perfis/route.ts
// CRUD de perfis de permissão

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { PERMISSOES } from '@/src/lib/permissoes'

// GET - Listar todos os perfis
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const perfis = await prisma.perfil.findMany({
      orderBy: { nome: 'asc' },
      include: {
        _count: {
          select: { usuarios: true },
        },
      },
    })

    return NextResponse.json({ perfis })
  } catch (error) {
    console.error('Erro ao listar perfis:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - Criar novo perfil
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const body = await request.json()
    const { nome, descricao, cor, permissoes } = body

    if (!nome || !permissoes) {
      return NextResponse.json(
        { error: 'Nome e permissões são obrigatórios' },
        { status: 400 }
      )
    }

    // Validar que todas as chaves de permissão são válidas
    const chavesValidas = Object.keys(PERMISSOES)
    const chavesInvalidas = Object.keys(permissoes).filter(k => !chavesValidas.includes(k))
    if (chavesInvalidas.length > 0) {
      return NextResponse.json(
        { error: `Permissões inválidas: ${chavesInvalidas.join(', ')}` },
        { status: 400 }
      )
    }

    const perfil = await prisma.perfil.create({
      data: {
        nome,
        descricao: descricao || null,
        cor: cor || null,
        permissoes,
      },
    })

    return NextResponse.json({ perfil }, { status: 201 })
  } catch (error: any) {
    if (error.code === 'P2002') {
      return NextResponse.json(
        { error: 'Já existe um perfil com este nome' },
        { status: 409 }
      )
    }
    console.error('Erro ao criar perfil:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// ========================================
// src/app/api/perfis/[id]/route.ts
// ========================================
// PUT - Atualizar perfil
// DELETE - Excluir perfil (se não for do sistema)
// Criar este arquivo separado em src/app/api/perfis/[id]/route.ts

// ========================================
// src/app/api/usuarios/[id]/permissoes/route.ts  
// ========================================
// GET - Buscar permissões efetivas do usuário
// PUT - Atualizar perfil e/ou permissões custom do usuário
// Criar este arquivo em src/app/api/usuarios/[id]/permissoes/route.ts
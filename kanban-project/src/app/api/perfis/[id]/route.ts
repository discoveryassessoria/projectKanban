// src/app/api/perfis/[id]/route.ts
// PUT    - Atualizar perfil (bloqueia SÓ o Administrador)
// DELETE - Excluir perfil (bloqueia o Administrador e perfis em uso)

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { PERMISSOES } from '@/src/lib/permissoes'

// Só o Administrador é protegido (não pode editar nem excluir). O resto é livre.
const ehAdministrador = (nome: string) => (nome || '').trim().toLowerCase() === 'administrador'

// PUT - Atualizar perfil
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

    const atual = await prisma.perfil.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Perfil não encontrado' }, { status: 404 })
    }
    if (ehAdministrador(atual.nome)) {
      return NextResponse.json(
        { error: 'O perfil Administrador não pode ser editado' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { nome, descricao, cor, permissoes } = body

    if (!nome || !permissoes) {
      return NextResponse.json(
        { error: 'Nome e permissões são obrigatórios' },
        { status: 400 }
      )
    }

    // Mesma validação de chaves do POST
    const chavesValidas = Object.keys(PERMISSOES)
    const chavesInvalidas = Object.keys(permissoes).filter(
      (k) => !chavesValidas.includes(k)
    )
    if (chavesInvalidas.length > 0) {
      return NextResponse.json(
        { error: `Permissões inválidas: ${chavesInvalidas.join(', ')}` },
        { status: 400 }
      )
    }

    const perfil = await prisma.perfil.update({
      where: { id },
      data: {
        nome,
        descricao: descricao || null,
        cor: cor || null,
        permissoes,
      },
    })

    return NextResponse.json({ perfil })
  } catch (error: any) {
    if (error.code === 'P2002') {
      return NextResponse.json(
        { error: 'Já existe um perfil com este nome' },
        { status: 409 }
      )
    }
    console.error('Erro ao atualizar perfil:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// DELETE - Excluir perfil
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

    const atual = await prisma.perfil.findUnique({
      where: { id },
      include: { _count: { select: { usuarios: true } } },
    })
    if (!atual) {
      return NextResponse.json({ error: 'Perfil não encontrado' }, { status: 404 })
    }
    if (ehAdministrador(atual.nome)) {
      return NextResponse.json(
        { error: 'O perfil Administrador não pode ser excluído' },
        { status: 403 }
      )
    }
    if (atual._count.usuarios > 0) {
      return NextResponse.json(
        {
          error: `Há ${atual._count.usuarios} usuário(s) usando este perfil. Reatribua-os antes de excluir.`,
        },
        { status: 409 }
      )
    }

    await prisma.perfil.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir perfil:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
// src/app/api/usuarios/[id]/permissoes/route.ts
// Gerenciar permissões de um usuário específico

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { calcularPermissoes, PERMISSOES, type MapaPermissoes } from '@/src/lib/permissoes'

// GET - Buscar permissões efetivas do usuário
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const resolvedParams = await Promise.resolve(context.params)
    const id = parseInt(resolvedParams.id)
    if (isNaN(id)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const usuario = await prisma.usuario.findUnique({
      where: { id },
      select: {
        id: true,
        nome: true,
        email: true,
        tipo: true,
        perfilId: true,
        permissoesCustom: true,
        perfil: {
          select: {
            id: true,
            nome: true,
            permissoes: true,
          },
        },
      },
    })

    if (!usuario) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
    }

    const perfilPermissoes = usuario.perfil?.permissoes as MapaPermissoes | null
    const permissoesCustom = usuario.permissoesCustom as MapaPermissoes | null

    // Permissões efetivas (perfil + overrides)
    const permissoesEfetivas = calcularPermissoes(
      usuario.tipo,
      perfilPermissoes,
      permissoesCustom
    )

    return NextResponse.json({
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        tipo: usuario.tipo,
        perfilId: usuario.perfilId,
        perfilNome: usuario.perfil?.nome || null,
      },
      // Permissões do perfil (base)
      perfilPermissoes: perfilPermissoes || {},
      // Overrides do usuário
      permissoesCustom: permissoesCustom || {},
      // Resultado final (o que vale de fato)
      permissoesEfetivas,
    })
  } catch (error) {
    console.error('Erro ao buscar permissões:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// PUT - Atualizar perfil e/ou permissões custom do usuário
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const resolvedParams = await Promise.resolve(context.params)
    const id = parseInt(resolvedParams.id)
    if (isNaN(id)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const body = await request.json()
    const { perfilId, permissoesCustom } = body

    // Validar que o perfil existe (se informado)
    if (perfilId !== undefined && perfilId !== null) {
      const perfil = await prisma.perfil.findUnique({
        where: { id: perfilId },
      })
      if (!perfil) {
        return NextResponse.json({ error: 'Perfil não encontrado' }, { status: 404 })
      }
    }

    // Limpar chaves de permissão inválidas/obsoletas
    if (permissoesCustom) {
      const chavesValidas = Object.keys(PERMISSOES)
      Object.keys(permissoesCustom).forEach(k => {
        if (!chavesValidas.includes(k)) {
          delete permissoesCustom[k]
        }
      })
    }

    // Atualizar
    const updateData: any = {}

    if (perfilId !== undefined) {
      updateData.perfilId = perfilId // null = remover perfil
    }

    if (permissoesCustom !== undefined) {
      // Se enviar null ou {}, limpa as customizações
      const temCustom = permissoesCustom && Object.keys(permissoesCustom).length > 0
      updateData.permissoesCustom = temCustom ? permissoesCustom : null
    }

    const usuario = await prisma.usuario.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        nome: true,
        perfilId: true,
        permissoesCustom: true,
        perfil: {
          select: {
            nome: true,
            permissoes: true,
          },
        },
      },
    })

    return NextResponse.json({ usuario, message: 'Permissões atualizadas' })
  } catch (error) {
    console.error('Erro ao atualizar permissões:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
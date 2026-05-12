// src/lib/verificar-permissao.ts
// Middleware para verificar permissões nas rotas da API

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { extrairUsuarioKanban } from '@/lib/kanban-auth'
import {
  calcularPermissoes,
  temPermissao,
  type PermissaoChave,
  type MapaPermissoes,
} from './permissoes'

interface UsuarioComPermissoes {
  userId: number
  nome: string
  email: string
  tipo: string
  permissoes: MapaPermissoes
}

/**
 * Extrai o usuário do request e calcula suas permissões efetivas.
 * Retorna null se não autenticado.
 */
export async function extrairUsuarioComPermissoes(
  request: Request
): Promise<UsuarioComPermissoes | null> {
  // 🆕 await: extrairUsuarioKanban virou async (JWT é async)
  const usuario = await extrairUsuarioKanban(request)
  if (!usuario) return null

  // Admin sempre tem tudo — nem precisa buscar perfil
  if (usuario.tipo === 'admin') {
    return {
      userId: usuario.userId,
      nome: '',
      email: usuario.email,
      tipo: 'admin',
      permissoes: calcularPermissoes('admin'),
    }
  }

  // Buscar perfil e permissões custom do usuário
  const usuarioDB = await prisma.usuario.findUnique({
    where: { id: usuario.userId },
    select: {
      id: true,
      nome: true,
      email: true,
      tipo: true,
      permissoesCustom: true,
      perfil: {
        select: {
          permissoes: true,
        },
      },
    },
  })

  if (!usuarioDB) return null

  const perfilPermissoes = usuarioDB.perfil?.permissoes as MapaPermissoes | null
  const permissoesCustom = usuarioDB.permissoesCustom as MapaPermissoes | null

  return {
    userId: usuarioDB.id,
    nome: usuarioDB.nome,
    email: usuarioDB.email,
    tipo: usuarioDB.tipo,
    permissoes: calcularPermissoes(
      usuarioDB.tipo,
      perfilPermissoes,
      permissoesCustom
    ),
  }
}

/**
 * Verifica se o usuário tem a permissão necessária.
 * Retorna NextResponse com erro 403 se não tiver.
 * Retorna null se tiver permissão (pode prosseguir).
 *
 * Uso nas rotas:
 *
 * ```ts
 * export async function DELETE(request: Request) {
 *   const erro = await verificarPermissao(request, 'tarefas.excluir')
 *   if (erro) return erro
 *
 *   // ... lógica normal
 * }
 * ```
 */
export async function verificarPermissao(
  request: Request,
  permissao: PermissaoChave
): Promise<NextResponse | null> {
  const usuario = await extrairUsuarioComPermissoes(request)

  if (!usuario) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  if (!temPermissao(usuario.permissoes, permissao)) {
    return NextResponse.json(
      { error: 'Sem permissão para esta ação', permissao },
      { status: 403 }
    )
  }

  return null // Tem permissão, pode prosseguir
}

/**
 * Verifica múltiplas permissões (precisa ter TODAS).
 */
export async function verificarPermissoes(
  request: Request,
  permissoes: PermissaoChave[]
): Promise<NextResponse | null> {
  const usuario = await extrairUsuarioComPermissoes(request)

  if (!usuario) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const semPermissao = permissoes.filter(
    (p) => !temPermissao(usuario.permissoes, p)
  )

  if (semPermissao.length > 0) {
    return NextResponse.json(
      {
        error: 'Sem permissão para esta ação',
        permissoesFaltando: semPermissao,
      },
      { status: 403 }
    )
  }

  return null
}
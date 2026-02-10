// src/app/api/me/permissoes/route.ts
// Retorna as permissões efetivas do usuário logado
// O frontend usa isso para esconder/mostrar botões e menus

import { NextRequest, NextResponse } from 'next/server'
import { extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'

export async function GET(request: NextRequest) {
  try {
    const usuario = await extrairUsuarioComPermissoes(request)

    if (!usuario) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    return NextResponse.json({
      userId: usuario.userId,
      tipo: usuario.tipo,
      permissoes: usuario.permissoes,
    })
  } catch (error) {
    console.error('Erro ao buscar permissões:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
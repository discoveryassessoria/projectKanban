import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUsuario } from '@/src/lib/guard'

export async function PUT(request: NextRequest) {
  try {
    // CP-SEC — exige autenticação e opera SOMENTE no próprio usuário.
    // O id vem do token verificado, nunca do body (evita account-takeover).
    const { usuario, erro } = await requireUsuario(request)
    if (erro) return erro

    const body = await request.json()
    const { newEmail } = body
    const userId = usuario.userId

    if (!newEmail) {
      return NextResponse.json(
        { message: 'Email é obrigatório' },
        { status: 400 }
      )
    }

    // Validar formato do email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(newEmail)) {
      return NextResponse.json(
        { message: 'Formato de email inválido' },
        { status: 400 }
      )
    }

    // Verificar se o email já existe em outro usuário
    const existingUser = await prisma.usuario.findUnique({
      where: { email: newEmail }
    })

    if (existingUser && existingUser.id !== userId) {
      return NextResponse.json(
        { message: 'Este email já está sendo usado por outro usuário' },
        { status: 409 }
      )
    }

    // Atualizar o email do próprio usuário autenticado
    const updatedUser = await prisma.usuario.update({
      where: { id: userId },
      data: { email: newEmail },
      select: {
        id: true,
        nome: true,
        email: true,
        tipo: true
      }
    })

    return NextResponse.json(updatedUser, { status: 200 })

  } catch (error) {
    console.error('Erro ao atualizar email:', error)
    return NextResponse.json(
      { message: 'Erro interno do servidor' },
      { status: 500 }
    )
  }
}

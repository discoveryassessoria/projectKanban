import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { newEmail, userId } = body

    console.log('Dados recebidos:', { newEmail, userId, bodyComplete: body })

    if (!newEmail || !userId) {
      console.log('Dados obrigatórios ausentes:', { newEmail: !!newEmail, userId: !!userId })
      return NextResponse.json(
        { message: 'Email e ID do usuário são obrigatórios' },
        { status: 400 }
      )
    }

    // Validar formato do email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(newEmail)) {
      console.log('Formato de email inválido:', newEmail)
      return NextResponse.json(
        { message: 'Formato de email inválido' },
        { status: 400 }
      )
    }

    console.log('Verificando se email já existe:', newEmail)
    // Verificar se o email já existe
    const existingUser = await prisma.usuario.findUnique({
      where: { email: newEmail }
    })

    if (existingUser && existingUser.id !== parseInt(userId)) {
      console.log('Email já existe para outro usuário:', { existingUserId: existingUser.id, requestUserId: userId })
      return NextResponse.json(
        { message: 'Este email já está sendo usado por outro usuário' },
        { status: 409 }
      )
    }

    console.log('Atualizando email do usuário:', { userId, newEmail })
    // Atualizar o email
    const updatedUser = await prisma.usuario.update({
      where: { id: parseInt(userId) },
      data: { email: newEmail },
      select: {
        id: true,
        nome: true,
        email: true,
        tipo: true
      }
    })

    console.log('Email atualizado com sucesso:', updatedUser)
    return NextResponse.json(updatedUser, { status: 200 })

  } catch (error) {
    console.error('Erro ao atualizar email:', error)
    return NextResponse.json(
      { message: 'Erro interno do servidor' },
      { status: 500 }
    )
  }
}
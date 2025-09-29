import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcrypt'

export async function PUT(request: NextRequest) {
  try {
    const { currentPassword, newPassword, userId } = await request.json()

    if (!currentPassword || !newPassword || !userId) {
      return NextResponse.json(
        { message: 'Senha atual, nova senha e ID do usuário são obrigatórios' },
        { status: 400 }
      )
    }

    // Validar tamanho da nova senha
    if (newPassword.length < 6) {
      return NextResponse.json(
        { message: 'A nova senha deve ter pelo menos 6 caracteres' },
        { status: 400 }
      )
    }

    // Buscar usuário atual
    const user = await prisma.usuario.findUnique({
      where: { id: userId }
    })

    if (!user) {
      return NextResponse.json(
        { message: 'Usuário não encontrado' },
        { status: 404 }
      )
    }

    // Verificar senha atual
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.senha)
    if (!isCurrentPasswordValid) {
      return NextResponse.json(
        { message: 'Senha atual incorreta' },
        { status: 401 }
      )
    }

    // Gerar hash da nova senha
    const saltRounds = 10
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds)

    // Atualizar a senha
    await prisma.usuario.update({
      where: { id: userId },
      data: { senha: hashedNewPassword }
    })

    return NextResponse.json(
      { message: 'Senha atualizada com sucesso' },
      { status: 200 }
    )

  } catch (error) {
    console.error('Erro ao atualizar senha:', error)
    return NextResponse.json(
      { message: 'Erro interno do servidor' },
      { status: 500 }
    )
  }
}
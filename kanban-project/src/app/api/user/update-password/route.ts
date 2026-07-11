import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcrypt'
import { requireUsuario } from '@/src/lib/guard'

export async function PUT(request: NextRequest) {
  try {
    // CP-SEC — exige autenticação e troca a senha SOMENTE do próprio usuário.
    const { usuario, erro } = await requireUsuario(request)
    if (erro) return erro

    const { currentPassword, newPassword } = await request.json()
    const userId = usuario.userId

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { message: 'Senha atual e nova senha são obrigatórias' },
        { status: 400 }
      )
    }

    // Validar tamanho da nova senha
    if (newPassword.length < 8) {
      return NextResponse.json(
        { message: 'A nova senha deve ter pelo menos 8 caracteres' },
        { status: 400 }
      )
    }

    // Buscar o próprio usuário autenticado
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
    const hashedNewPassword = await bcrypt.hash(newPassword, 10)

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

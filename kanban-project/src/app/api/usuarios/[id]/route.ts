import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { hash } from "bcrypt"
import { UserType } from "@/src/utils/userTypes"

// Função auxiliar para verificar se o usuário é admin
function verifyAdmin(request: NextRequest): { isAdmin: boolean; userId?: number; tipo?: string } {
  try {
    const authHeader = request.headers.get("authorization")
    const token = authHeader?.replace("Bearer ", "")

    if (!token) {
      return { isAdmin: false }
    }

    const decoded = JSON.parse(atob(token))
    
    // Verificar se o token não expirou
    if (decoded.exp && Date.now() > decoded.exp) {
      return { isAdmin: false }
    }

    return {
      isAdmin: decoded.tipo === "admin",
      userId: decoded.userId,
      tipo: decoded.tipo,
    }
  } catch (error) {
    return { isAdmin: false }
  }
}

// PUT - Atualizar usuário
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { isAdmin, userId: requesterId } = verifyAdmin(request)

    if (!isAdmin) {
      return NextResponse.json({ error: "Acesso negado. Apenas administradores podem atualizar usuários." }, { status: 403 })
    }

    const { id: idParam } = await params
    const userId = parseInt(idParam)
    if (isNaN(userId)) {
      return NextResponse.json({ error: "ID de usuário inválido" }, { status: 400 })
    }

    const { nome, email, senha, tipo } = await request.json()

    // Verificar se o usuário a ser atualizado existe
    const usuarioExistente = await prisma.usuario.findUnique({
      where: { id: userId }
    })

    if (!usuarioExistente) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 })
    }

    // Impedir que admin edite outro admin (exceto a si mesmo)
    if (usuarioExistente.tipo === "admin" && usuarioExistente.id !== requesterId) {
      return NextResponse.json({ error: "Você não pode editar outro administrador." }, { status: 403 })
    }

    // Validar tipo de usuário se estiver sendo alterado
    if (tipo && !Object.values(UserType).includes(tipo as UserType)) {
      return NextResponse.json({ error: "Tipo de usuário inválido" }, { status: 400 })
    }

    // Verificar se o email já está em uso por outro usuário
    if (email && email !== usuarioExistente.email) {
      const emailEmUso = await prisma.usuario.findUnique({
        where: { email }
      })

      if (emailEmUso) {
        return NextResponse.json({ error: "Este email já está em uso" }, { status: 409 })
      }
    }

    // Preparar dados para atualização
    const dadosAtualizacao: any = {}
    if (nome) dadosAtualizacao.nome = nome
    if (email) dadosAtualizacao.email = email
    if (tipo) dadosAtualizacao.tipo = tipo
    if (senha) {
      // Hash da nova senha se fornecida
      dadosAtualizacao.senha = await hash(senha, 10)
    }

    // Atualizar usuário
    const usuarioAtualizado = await prisma.usuario.update({
      where: { id: userId },
      data: dadosAtualizacao,
      select: {
        id: true,
        nome: true,
        email: true,
        tipo: true,
      }
    })

    return NextResponse.json({
      message: "Usuário atualizado com sucesso",
      usuario: usuarioAtualizado,
    })
  } catch (error) {
    console.error("Erro ao atualizar usuário:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// DELETE - Deletar usuário
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { isAdmin, userId: requesterId, tipo: requesterTipo } = verifyAdmin(request)

    const { id: idParam } = await params
    const userId = parseInt(idParam)
    if (isNaN(userId)) {
      return NextResponse.json({ error: "ID de usuário inválido" }, { status: 400 })
    }

    // Verificar se o usuário a ser deletado existe
    const usuarioExistente = await prisma.usuario.findUnique({
      where: { id: userId }
    })

    if (!usuarioExistente) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 })
    }

    // Verificar se é a própria conta ou se é admin deletando outro
    const isDeletandoPropriaConta = usuarioExistente.id === requesterId

    // Se não é admin e não está deletando a própria conta
    if (!isAdmin && !isDeletandoPropriaConta) {
      return NextResponse.json({ error: "Acesso negado. Você só pode deletar sua própria conta." }, { status: 403 })
    }

    // Admin tentando deletar OUTRO admin (não permitido)
    if (isAdmin && usuarioExistente.tipo === "admin" && !isDeletandoPropriaConta) {
      return NextResponse.json({ error: "Você não pode deletar outro administrador" }, { status: 403 })
    }

    // Se é um admin deletando a própria conta, verificar se existe outro admin
    if (usuarioExistente.tipo === "admin" && isDeletandoPropriaConta) {
      const outrosAdmins = await prisma.usuario.count({
        where: {
          tipo: "admin",
          id: { not: userId }
        }
      })

      if (outrosAdmins === 0) {
        return NextResponse.json({ 
          error: "Você é o único administrador do sistema. Promova outro usuário a administrador antes de excluir sua conta." 
        }, { status: 403 })
      }
    }

    // Deletar usuário
    await prisma.usuario.delete({
      where: { id: userId }
    })

    return NextResponse.json({
      message: "Usuário deletado com sucesso",
    })
  } catch (error) {
    console.error("Erro ao deletar usuário:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
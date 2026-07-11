import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { hash } from "bcrypt"
import { UserType } from "@/src/utils/userTypes"
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'

// PUT - Atualizar usuário
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.editar')
    if (erro) return erro

    // CP-SEC — identidade verificada (jose), não mais o decoder inseguro.
    const requester = await extrairUsuarioComPermissoes(request)
    if (!requester) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
    }
    const requesterId = requester.userId

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
    const erro = await verificarPermissao(request, 'usuarios.excluir')
    if (erro) return erro

    // CP-SEC — identidade verificada (jose), não mais o decoder inseguro.
    const requester = await extrairUsuarioComPermissoes(request)
    if (!requester) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
    }
    const requesterId = requester.userId
    const isAdmin = requester.tipo === 'admin'

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
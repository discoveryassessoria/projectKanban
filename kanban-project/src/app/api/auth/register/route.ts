import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { UserType } from "@/src/utils/userTypes"
import { hash } from "bcrypt"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.criar')
    if (erro) return erro

    const { nome, email, senha, tipo } = await request.json()

    if (!nome || !email || !senha || !tipo) {
      return NextResponse.json({ error: "Todos os campos são obrigatórios" }, { status: 400 })
    }

    // Validar tipo de usuário usando o enum
    if (!Object.values(UserType).includes(tipo as UserType)) {
      return NextResponse.json({ error: "Tipo de usuário inválido" }, { status: 400 })
    }

    // Verificar se o email já existe
    const usuarioExistente = await prisma.usuario.findUnique({
      where: { email }
    })

    if (usuarioExistente) {
      return NextResponse.json({ error: "Este email já está em uso" }, { status: 409 })
    }

    // Hash da senha
    const senhaHash = await hash(senha, 10)

    // Criar usuário no banco
    const novoUsuario = await prisma.usuario.create({
      data: {
        nome,
        email,
        senha: senhaHash,
        tipo
      },
      select: {
        id: true,
        nome: true,
        email: true,
        tipo: true,
      }
    })

    return NextResponse.json(
      {
        message: "Usuário criado com sucesso",
        user: novoUsuario,
      },
      { status: 201 },
    )
  } catch (error) {
    console.error("Erro no registro:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
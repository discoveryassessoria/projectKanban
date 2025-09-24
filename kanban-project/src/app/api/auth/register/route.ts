import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const { nome, email, senha, tipo } = await request.json()

    if (!nome || !email || !senha || !tipo) {
      return NextResponse.json({ error: "Todos os campos são obrigatórios" }, { status: 400 })
    }

    // Validar tipo de usuário
    const tiposValidos = ["admin", "usuario", "gestor"]
    if (!tiposValidos.includes(tipo)) {
      return NextResponse.json({ error: "Tipo de usuário inválido" }, { status: 400 })
    }

    // Simulação de usuários existentes para demonstração
    const usuariosExistentes = ["admin@teste.com", "usuario@teste.com", "gestor@teste.com"]

    // Verificar se o email já existe
    if (usuariosExistentes.includes(email)) {
      return NextResponse.json({ error: "Este email já está em uso" }, { status: 409 })
    }

    // Simular criação de usuário
    const novoUsuario = {
      id: Date.now(), // ID simples baseado em timestamp
      nome,
      email,
      tipo,
      criadoEm: new Date().toISOString(),
    }

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

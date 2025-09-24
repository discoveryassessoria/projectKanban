import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const { email, senha } = await request.json()

    if (!email || !senha) {
      return NextResponse.json({ error: "Email e senha são obrigatórios" }, { status: 400 })
    }

    // Simulação de usuários para demonstração
    const usuarios = [
      {
        id: 1,
        nome: "Admin",
        email: "admin@teste.com",
        senha: "123456",
        tipo: "admin",
      },
      {
        id: 2,
        nome: "Usuário",
        email: "usuario@teste.com",
        senha: "123456",
        tipo: "usuario",
      },
      {
        id: 3,
        nome: "Gestor",
        email: "gestor@teste.com",
        senha: "123456",
        tipo: "gestor",
      },
    ]

    // Buscar usuário
    const usuario = usuarios.find((u) => u.email === email)

    if (!usuario) {
      return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 })
    }

    // Verificar senha (simplificado para demonstração)
    if (senha !== usuario.senha) {
      return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 })
    }

    // Gerar token simples (apenas para demonstração)
    const token = btoa(
      JSON.stringify({
        userId: usuario.id,
        email: usuario.email,
        tipo: usuario.tipo,
        exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 dias
      }),
    )

    // Retornar dados do usuário (sem a senha)
    const { senha: _, ...usuarioSemSenha } = usuario

    return NextResponse.json({
      message: "Login realizado com sucesso",
      token,
      user: usuarioSemSenha,
    })
  } catch (error) {
    console.error("Erro no login:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { compare } from "bcrypt"

export async function POST(request: NextRequest) {
  try {
    console.log("🔐 Requisição de login recebida")
    const { email, senha } = await request.json()
    console.log("📧 Email recebido:", email)

    if (!email || !senha) {
      console.log("❌ Email ou senha faltando")
      return NextResponse.json({ error: "Email e senha são obrigatórios" }, { status: 400 })
    }

    // Buscar usuário no banco de dados
    console.log("🔍 Buscando usuário no banco...")
    const usuario = await prisma.usuario.findUnique({
      where: { email },
    })

    if (!usuario) {
      console.log("❌ Usuário não encontrado")
      return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 })
    }

    console.log("✅ Usuário encontrado:", usuario.email)

    // Verificar a senha
    console.log("🔑 Verificando senha...")
    const senhaCorreta = await compare(senha, usuario.senha)

    if (!senhaCorreta) {
      console.log("❌ Senha incorreta")
      return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 })
    }

    console.log("✅ Senha correta!")

    // Gerar token simples (apenas para demonstração)
    const token = btoa(
      JSON.stringify({
        userId: usuario.id,
        email: usuario.email,
        tipo: usuario.tipo,
        exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 dias
      }),
    )

    console.log("🎫 Token gerado com sucesso")

    // Retornar dados do usuário (sem a senha)
    const { senha: _, ...usuarioSemSenha } = usuario

    console.log("✅ Login bem-sucedido para:", usuario.email)
    return NextResponse.json({
      message: "Login realizado com sucesso",
      token,
      user: usuarioSemSenha,
    })
  } catch (error) {
    console.error("❌ Erro no login:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

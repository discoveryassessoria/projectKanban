import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { compare } from "bcrypt"

export async function POST(request: NextRequest) {
  try {
    const { email, senha } = await request.json()

    if (!email || !senha) {
      return NextResponse.json({ error: "Email e senha são obrigatórios" }, { status: 400 })
    }

    // Buscar usuário no banco de dados
    const usuario = await prisma.usuario.findUnique({
      where: { email },
    })

    if (!usuario) {
      return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 })
    }

    // Verificar a senha
    const senhaCorreta = await compare(senha, usuario.senha)

    if (!senhaCorreta) {
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
    //senha: _ --> Em vez de criar uma variável chamada senha, ela a renomeia para _ (underline). Por convenção, _ é usado como um nome para uma variável cujo valor não será utilizado. 
    //...usuarioSemSenha: Esta é a sintaxe de "resto". Ela coleta todas as propriedades restantes do objeto usuario (ou seja, todas exceto senha) e as agrupa em um novo objeto chamado usuarioSemSenha.
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

// src/app/api/auth/login/route.ts
import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { compare } from "bcrypt"
import { signAuthToken } from "@/lib/auth-jwt"

// TRILHA DE ACESSO (aditiva) — alimenta Usuários e Acessos › Auditoria de Acessos.
// Grava em LogAuditoria com entidade "ACESSO". NUNCA registra a senha, NUNCA
// bloqueia o login: qualquer falha ao auditar é engolida de propósito.
async function registrarAcesso(
  acao: "LOGIN" | "LOGIN_NEGADO",
  descricao: string,
  usuarioId: number | null,
  request: NextRequest,
) {
  try {
    await prisma.logAuditoria.create({
      data: {
        acao,
        entidade: "ACESSO",
        entidadeId: usuarioId ?? undefined,
        descricao,
        usuarioId: usuarioId ?? undefined,
        detalhes: {
          ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
          agente: request.headers.get("user-agent")?.slice(0, 200) ?? null,
        },
      },
    })
  } catch {
    /* auditar nunca derruba a autenticação */
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log("🔐 Requisição de login recebida")
    const { email, senha } = await request.json()
    console.log("📧 Email recebido:", email)

    if (!email || !senha) {
      console.log("❌ Email ou senha faltando")
      return NextResponse.json(
        { error: "Email e senha são obrigatórios" },
        { status: 400 }
      )
    }

    // Buscar usuário no banco de dados
    console.log("🔍 Buscando usuário no banco...")
    const usuario = await prisma.usuario.findUnique({
      where: { email },
    })

    if (!usuario) {
      console.log("❌ Usuário não encontrado")
      await registrarAcesso("LOGIN_NEGADO", `Tentativa de acesso com e-mail não cadastrado: ${email}`, null, request)
      return NextResponse.json(
        { error: "Credenciais inválidas" },
        { status: 401 }
      )
    }

    console.log("✅ Usuário encontrado:", usuario.email)

    // Verificar a senha
    console.log("🔑 Verificando senha...")
    const senhaCorreta = await compare(senha, usuario.senha)

    if (!senhaCorreta) {
      console.log("❌ Senha incorreta")
      await registrarAcesso("LOGIN_NEGADO", `Senha incorreta para ${usuario.email}`, usuario.id, request)
      return NextResponse.json(
        { error: "Credenciais inválidas" },
        { status: 401 }
      )
    }

    console.log("✅ Senha correta!")

    // 🆕 JWT real assinado com HS256 (jose), expira em 7 dias.
    // Antes era btoa(JSON.stringify(...)) — só encoding, sem assinatura,
    // então qualquer um podia forjar token com qualquer userId.
    const token = await signAuthToken({
      userId: usuario.id,
      email: usuario.email,
      tipo: usuario.tipo,
    })

    console.log("🎫 Token JWT gerado com sucesso")
    await registrarAcesso("LOGIN", `Acesso concedido a ${usuario.email}`, usuario.id, request)

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
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}
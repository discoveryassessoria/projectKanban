import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// Função auxiliar para verificar autenticação
function verifyAuth(request: NextRequest): { isAuthenticated: boolean; isAdmin: boolean } {
  try {
    const authHeader = request.headers.get("authorization")
    const token = authHeader?.replace("Bearer ", "")

    if (!token) {
      return { isAuthenticated: false, isAdmin: false }
    }

    const decoded = JSON.parse(atob(token))
    
    // Verificar se o token não expirou
    if (decoded.exp && Date.now() > decoded.exp) {
      return { isAuthenticated: false, isAdmin: false }
    }

    return {
      isAuthenticated: true,
      isAdmin: decoded.tipo === "admin",
    }
  } catch (error) {
    return { isAuthenticated: false, isAdmin: false }
  }
}

export async function GET(request: NextRequest) {
  try {
    const { isAuthenticated, isAdmin } = verifyAuth(request)

    if (!isAuthenticated) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''
    const includeAll = searchParams.get('all') === 'true' // Para admin ver todos

    const usuarios = await prisma.usuario.findMany({
      select: {
        id: true,
        nome: true,
        email: true,
        tipo: true, // Incluir tipo de usuário
      },
      where: search ? {
        OR: [
          { nome: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } }
        ]
      } : undefined,
      take: isAdmin && includeAll ? undefined : 10, // Admin pode ver todos
      orderBy: { nome: 'asc' }
    })

    return NextResponse.json({ usuarios })
  } catch (error) {
    console.error("Erro ao buscar usuários:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
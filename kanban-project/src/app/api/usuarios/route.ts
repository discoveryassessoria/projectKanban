import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'

export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    // CP-SEC — identidade verificada (jose), não mais o decoder inseguro.
    const usuario = await extrairUsuarioComPermissoes(request)
    if (!usuario) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
    }
    const isAdmin = usuario.tipo === 'admin'

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
// CRIAR EM: src/app/api/categorias-financeiras/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// GET - Listar categorias
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const tipo = searchParams.get("tipo") // ENTRADA ou SAIDA

    const where: any = { ativo: true }
    
    if (tipo) {
      where.tipo = tipo
    }

    const categorias = await prisma.categoriaFinanceira.findMany({
      where,
      orderBy: { nome: "asc" },
      include: {
        subcategorias: {
          where: { ativo: true }
        }
      }
    })

    return NextResponse.json(categorias)
  } catch (error) {
    console.error("Erro ao listar categorias:", error)
    return NextResponse.json(
      { error: "Erro ao listar categorias" },
      { status: 500 }
    )
  }
}

// POST - DESATIVADO. Categoria financeira NÃO é mais cadastro de texto livre:
// ela deve REFERENCIAR um cadastro mestre por FK. Use POST /api/gerenciamento/categorias
// (origem + mestre). Este endpoint só serve leitura (consumo em selects).
export async function POST() {
  return NextResponse.json(
    {
      error:
        'Criação por texto livre desativada. Categorias financeiras referenciam um cadastro mestre por FK. Use /api/gerenciamento/categorias (origem + mestre).',
    },
    { status: 410 }
  )
}
// CRIAR EM: src/app/api/categorias-financeiras/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

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

// POST - Criar categoria
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const categoria = await prisma.categoriaFinanceira.create({
      data: {
        nome: body.nome,
        tipo: body.tipo,
        cor: body.cor || null,
        icone: body.icone || null,
        descricao: body.descricao || null,
        categoriaPaiId: body.categoriaPaiId ? parseInt(body.categoriaPaiId) : null,
        ativo: true,
      },
    })

    return NextResponse.json(categoria, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar categoria:", error)
    return NextResponse.json(
      { error: "Erro ao criar categoria" },
      { status: 500 }
    )
  }
}
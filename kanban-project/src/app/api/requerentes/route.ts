import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const requerentes = await prisma.requerente.findMany({
      orderBy: {
        nome: 'asc'
      }
    })

    return NextResponse.json({ requerentes })
  } catch (error) {
    console.error("Erro ao buscar requerentes:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { nome, cpf, rg, endereco, telefone } = await request.json()

    if (!nome || !nome.trim()) {
      return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 })
    }

    const requerente = await prisma.requerente.create({
      data: {
        nome: nome.trim(),
        cpf: cpf?.trim() || null,
        rg: rg?.trim() || null,
        endereco: endereco?.trim() || null,
        telefone: telefone?.trim() || null,
      },
    })

    return NextResponse.json({ requerente }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar requerente:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
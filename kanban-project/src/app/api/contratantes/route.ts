import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const contratantes = await prisma.contratante.findMany({
      orderBy: {
        nome: 'asc'
      }
    })

    return NextResponse.json({ contratantes })
  } catch (error) {
    console.error("Erro ao buscar contratantes:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { nome, cpf, rg, endereco, telefone } = await request.json()

    if (!nome || !nome.trim()) {
      return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 })
    }

    const contratante = await prisma.contratante.create({
      data: {
        nome: nome.trim(),
        cpf: cpf?.trim() || null,
        rg: rg?.trim() || null,
        endereco: endereco?.trim() || null,
        telefone: telefone?.trim() || null,
      },
    })

    return NextResponse.json({ contratante }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar contratante:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
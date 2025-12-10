import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import type { CamposPersonalizados } from "@/src/types/campoPersonalizado"

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
    const { nome, cpf, rg, endereco, telefone, campos_personalizados } = await request.json()

    if (!nome || !nome.trim()) {
      return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 })
    }

    // Validar campos personalizados se fornecidos
    let camposPersonalizadosData: any = undefined
    if (campos_personalizados) {
      if (!campos_personalizados.campos || !Array.isArray(campos_personalizados.campos)) {
        return NextResponse.json({ error: "Campos personalizados inválidos" }, { status: 400 })
      }
      
      if (campos_personalizados.campos.length > 5) {
        return NextResponse.json({ error: "Máximo de 5 campos personalizados permitidos" }, { status: 400 })
      }
      
      camposPersonalizadosData = campos_personalizados
    }

    const requerente = await prisma.requerente.create({
      data: {
        nome: nome.trim(),
        cpf: cpf?.trim() || null,
        rg: rg?.trim() || null,
        endereco: endereco?.trim() || null,
        telefone: telefone?.trim() || null,
        ...(camposPersonalizadosData && { campos_personalizados: camposPersonalizadosData }),
      },
    })

    return NextResponse.json({ requerente }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar requerente:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
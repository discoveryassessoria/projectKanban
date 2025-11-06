import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const requerente = await prisma.requerente.findUnique({
      where: { id },
    })

    if (!requerente) {
      return NextResponse.json({ error: "Requerente não encontrado" }, { status: 404 })
    }

    return NextResponse.json({ requerente })
  } catch (error) {
    console.error("Erro ao buscar requerente:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const { nome, cpf, rg, endereco, telefone, campos_personalizados } = await request.json()

    if (!nome || !nome.trim()) {
      return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 })
    }

    // Validar campos personalizados se fornecidos
    let camposPersonalizadosData: any = undefined
    if (campos_personalizados !== undefined) {
      if (campos_personalizados === null) {
        camposPersonalizadosData = null
      } else {
        if (!campos_personalizados.campos || !Array.isArray(campos_personalizados.campos)) {
          return NextResponse.json({ error: "Campos personalizados inválidos" }, { status: 400 })
        }
        
        if (campos_personalizados.campos.length > 5) {
          return NextResponse.json({ error: "Máximo de 5 campos personalizados permitidos" }, { status: 400 })
        }
        
        camposPersonalizadosData = campos_personalizados
      }
    }

    const requerente = await prisma.requerente.update({
      where: { id },
      data: {
        nome: nome.trim(),
        cpf: cpf?.trim() || null,
        rg: rg?.trim() || null,
        endereco: endereco?.trim() || null,
        telefone: telefone?.trim() || null,
        ...(camposPersonalizadosData !== undefined && { campos_personalizados: camposPersonalizadosData }),
      },
    })

    return NextResponse.json({ requerente })
  } catch (error) {
    console.error("Erro ao atualizar requerente:", error)
    if ((error as any).code === 'P2025') {
      return NextResponse.json({ error: "Requerente não encontrado" }, { status: 404 })
    }
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    await prisma.requerente.delete({
      where: { id },
    })

    return NextResponse.json({ message: "Requerente excluído com sucesso" })
  } catch (error) {
    console.error("Erro ao excluir requerente:", error)
    if ((error as any).code === 'P2025') {
      return NextResponse.json({ error: "Requerente não encontrado" }, { status: 404 })
    }
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

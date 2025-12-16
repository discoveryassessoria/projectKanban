import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET - Buscar contratante por ID
export async function GET(
  request: Request,
  { params }: { params: Promise<{ contratanteId: string }> }
) {
  try {
    const { contratanteId } = await params
    const id = parseInt(contratanteId)

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    const contratante = await prisma.contratante.findUnique({
      where: { id },
      include: {
        atividades: {
          include: {
            status: true,
          }
        },
      },
    })

    if (!contratante) {
      return NextResponse.json(
        { error: "Contratante não encontrado" },
        { status: 404 }
      )
    }

    return NextResponse.json({ contratante })
  } catch (error) {
    console.error("Erro ao buscar contratante:", error)
    return NextResponse.json(
      { error: "Erro ao buscar contratante" },
      { status: 500 }
    )
  }
}

// PUT - Atualizar contratante
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ contratanteId: string }> }
) {
  try {
    const { contratanteId } = await params
    const id = parseInt(contratanteId)

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    const body = await request.json()

    // Verificar se existe
    const existente = await prisma.contratante.findUnique({
      where: { id },
    })

    if (!existente) {
      return NextResponse.json(
        { error: "Contratante não encontrado" },
        { status: 404 }
      )
    }

    // Montar objeto de dados para update
    const updateData: Record<string, unknown> = {}

    if (body.tipo !== undefined) updateData.tipo = body.tipo || null
    if (body.nome !== undefined) updateData.nome = body.nome?.trim() || null
    if (body.cpf !== undefined) updateData.cpf = body.cpf || null
    if (body.rg !== undefined) updateData.rg = body.rg || null
    if (body.dataNascimento !== undefined) {
      updateData.dataNascimento = body.dataNascimento ? new Date(body.dataNascimento) : null
    }
    if (body.sexo !== undefined) updateData.sexo = body.sexo || null
    if (body.estadoCivil !== undefined) updateData.estadoCivil = body.estadoCivil || null
    if (body.nacionalidade !== undefined) updateData.nacionalidade = body.nacionalidade || null
    if (body.telefone !== undefined) updateData.telefone = body.telefone || null
    if (body.email !== undefined) updateData.email = body.email || null
    if (body.endereco !== undefined) updateData.endereco = body.endereco || null
    if (body.numero !== undefined) updateData.numero = body.numero || null
    if (body.complemento !== undefined) updateData.complemento = body.complemento || null
    if (body.bairro !== undefined) updateData.bairro = body.bairro || null
    if (body.cidade !== undefined) updateData.cidade = body.cidade || null
    if (body.estado !== undefined) updateData.estado = body.estado || null
    if (body.cep !== undefined) updateData.cep = body.cep || null
    if (body.observacoes !== undefined) updateData.observacoes = body.observacoes || null

    const contratante = await prisma.contratante.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json({ contratante })
  } catch (error) {
    console.error("Erro ao atualizar contratante:", error)
    return NextResponse.json(
      { error: "Erro ao atualizar contratante" },
      { status: 500 }
    )
  }
}

// DELETE - Excluir contratante
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ contratanteId: string }> }
) {
  try {
    const { contratanteId } = await params
    const id = parseInt(contratanteId)

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    // Verificar se existe e se está em uso
    const contratante = await prisma.contratante.findUnique({
      where: { id },
      include: {
        _count: { select: { atividades: true } }
      },
    })

    if (!contratante) {
      return NextResponse.json(
        { error: "Contratante não encontrado" },
        { status: 404 }
      )
    }

    if (contratante._count.atividades > 0) {
      return NextResponse.json(
        { error: `Este contratante está vinculado a ${contratante._count.atividades} processo(s). Desvincule primeiro.` },
        { status: 400 }
      )
    }

    await prisma.contratante.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Erro ao excluir contratante:", error)
    return NextResponse.json(
      { error: "Erro ao excluir contratante" },
      { status: 500 }
    )
  }
}
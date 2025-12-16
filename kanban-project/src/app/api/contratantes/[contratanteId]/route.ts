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
        anexos: true,
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
    const {
      nome,
      cpf,
      rg,
      dataNascimento,
      sexo,
      estadoCivil,
      nacionalidade,
      telefone,
      email,
      endereco,
      numero,
      complemento,
      bairro,
      cidade,
      estado,
      cep,
      observacoes,
    } = body

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

    const contratante = await prisma.contratante.update({
      where: { id },
      data: {
        nome: nome !== undefined ? nome.trim() : undefined,
        cpf: cpf !== undefined ? cpf || null : undefined,
        rg: rg !== undefined ? rg || null : undefined,
        dataNascimento: dataNascimento !== undefined 
          ? (dataNascimento ? new Date(dataNascimento) : null) 
          : undefined,
        sexo: sexo !== undefined ? sexo || null : undefined,
        estadoCivil: estadoCivil !== undefined ? estadoCivil || null : undefined,
        nacionalidade: nacionalidade !== undefined ? nacionalidade || null : undefined,
        telefone: telefone !== undefined ? telefone || null : undefined,
        email: email !== undefined ? email || null : undefined,
        endereco: endereco !== undefined ? endereco || null : undefined,
        numero: numero !== undefined ? numero || null : undefined,
        complemento: complemento !== undefined ? complemento || null : undefined,
        bairro: bairro !== undefined ? bairro || null : undefined,
        cidade: cidade !== undefined ? cidade || null : undefined,
        estado: estado !== undefined ? estado || null : undefined,
        cep: cep !== undefined ? cep || null : undefined,
        observacoes: observacoes !== undefined ? observacoes || null : undefined,
      },
      include: {
        anexos: true,
      },
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
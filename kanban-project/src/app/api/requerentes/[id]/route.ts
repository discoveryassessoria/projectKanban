import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// GET - Buscar requerente por ID
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const parsedId = parseInt(id)

    if (isNaN(parsedId)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    const requerente = await prisma.requerente.findUnique({
      where: { id: parsedId },
      include: {
        processos: {
          include: {
            processo: {
              include: {
                status: true,
              }
            }
          }
        },
      },
    })

    if (!requerente) {
      return NextResponse.json(
        { error: "Requerente não encontrado" },
        { status: 404 }
      )
    }

    return NextResponse.json({ requerente })
  } catch (error) {
    console.error("Erro ao buscar requerente:", error)
    return NextResponse.json(
      { error: "Erro ao buscar requerente" },
      { status: 500 }
    )
  }
}

// PUT - Atualizar requerente
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'clientes.editar')
    if (erro) return erro

    const { id } = await params
    const parsedId = parseInt(id)

    if (isNaN(parsedId)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    const body = await request.json()

    // Verificar se existe
    const existente = await prisma.requerente.findUnique({
      where: { id: parsedId },
    })

    if (!existente) {
      return NextResponse.json(
        { error: "Requerente não encontrado" },
        { status: 404 }
      )
    }

    // Montar objeto de dados para update
    const updateData: Record<string, unknown> = {}

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

    const requerente = await prisma.requerente.update({
      where: { id: parsedId },
      data: updateData,
    })

    return NextResponse.json({ requerente })
  } catch (error) {
    console.error("Erro ao atualizar requerente:", error)
    return NextResponse.json(
      { error: "Erro ao atualizar requerente" },
      { status: 500 }
    )
  }
}

// DELETE - Excluir requerente
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'clientes.excluir')
    if (erro) return erro

    const { id } = await params
    const parsedId = parseInt(id)

    if (isNaN(parsedId)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    // Verificar se existe e se está em uso
    const requerente = await prisma.requerente.findUnique({
      where: { id: parsedId },
      include: {
        _count: { select: { processos: true } }
      },
    })

    if (!requerente) {
      return NextResponse.json(
        { error: "Requerente não encontrado" },
        { status: 404 }
      )
    }

    if (requerente._count.processos > 0) {
      return NextResponse.json(
        { error: `Este requerente está vinculado a ${requerente._count.processos} processo(s). Desvincule primeiro.` },
        { status: 400 }
      )
    }

    await prisma.requerente.delete({
      where: { id: parsedId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Erro ao excluir requerente:", error)
    return NextResponse.json(
      { error: "Erro ao excluir requerente" },
      { status: 500 }
    )
  }
}
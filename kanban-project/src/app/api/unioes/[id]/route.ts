import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// GET - Buscar união por ID
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: idParam } = await params
    const id = Number.parseInt(idParam)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const uniao = await prisma.uniao.findUnique({
      where: { id },
      include: {
        pessoa1: {
          include: {
            pai: true,
            mae: true,
            documentos: true,
          }
        },
        pessoa2: {
          include: {
            pai: true,
            mae: true,
            documentos: true,
          }
        },
      },
    })

    if (!uniao) {
      return NextResponse.json({ error: "União não encontrada" }, { status: 404 })
    }

    return NextResponse.json(uniao)
  } catch (error) {
    console.error("Erro ao buscar união:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// PUT - Atualizar união
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'processos.editar')
    if (erro) return erro

    const { id: idParam } = await params
    const id = Number.parseInt(idParam)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const body = await request.json()

    const dataToUpdate: Prisma.UniaoUpdateInput = {}

    // Campos existentes
    if (body.data_inicio !== undefined) dataToUpdate.data_inicio = body.data_inicio ? new Date(body.data_inicio) : null
    if (body.data_fim !== undefined) dataToUpdate.data_fim = body.data_fim ? new Date(body.data_fim) : null
    if (body.tipo !== undefined) dataToUpdate.tipo = body.tipo
    if (body.local !== undefined) dataToUpdate.local = body.local

    // ✅ NOVOS CAMPOS
    if (body.estado !== undefined) dataToUpdate.estado = body.estado
    if (body.pais !== undefined) dataToUpdate.pais = body.pais
    if (body.cartorio !== undefined) dataToUpdate.cartorio = body.cartorio
    if (body.livro !== undefined) dataToUpdate.livro = body.livro
    if (body.folha !== undefined) dataToUpdate.folha = body.folha
    if (body.termo !== undefined) dataToUpdate.termo = body.termo
    if (body.numero_registro !== undefined) dataToUpdate.numero_registro = body.numero_registro
    if (body.data_registro !== undefined) dataToUpdate.data_registro = body.data_registro ? new Date(body.data_registro) : null
    if (body.observacoes !== undefined) dataToUpdate.observacoes = body.observacoes

    const uniaoAtualizada = await prisma.uniao.update({
      where: { id },
      data: dataToUpdate,
      include: {
        pessoa1: true,
        pessoa2: true,
      },
    })

    return NextResponse.json(uniaoAtualizada)
  } catch (error) {
    console.error("Erro ao atualizar união:", error)

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "União não encontrada" }, { status: 404 })
      }
    }

    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// DELETE - Excluir união
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'processos.editar')
    if (erro) return erro
    
    const { id: idParam } = await params
    const id = Number.parseInt(idParam)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    await prisma.uniao.delete({
      where: { id },
    })

    return NextResponse.json({ message: "União excluída com sucesso" })
  } catch (error) {
    console.error("Erro ao excluir união:", error)

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "União não encontrada" }, { status: 404 })
      }
    }

    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
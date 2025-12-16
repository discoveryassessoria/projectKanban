import { NextRequest, NextResponse } from "next/server"
import { PrismaClient, Pais } from "@prisma/client"

const prisma = new PrismaClient()

// GET - Buscar atividade por ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const atividadeId = parseInt(id)

    const atividade = await prisma.atividade.findUnique({
      where: { id: atividadeId },
      include: {
        status: true,
        contratante: true,
        usuarios: {
          include: {
            usuario: {
              select: {
                id: true,
                nome: true,
                email: true
              }
            }
          }
        },
        requerentes: {
          include: {
            requerente: true
          }
        },
        arvore: true
      }
    })

    if (!atividade) {
      return NextResponse.json(
        { error: "Atividade não encontrada" },
        { status: 404 }
      )
    }

    return NextResponse.json({ atividade })
  } catch (error) {
    console.error("Erro ao buscar atividade:", error)
    return NextResponse.json(
      { error: "Erro ao buscar atividade" },
      { status: 500 }
    )
  }
}

// PUT - Atualizar atividade
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const atividadeId = parseInt(id)
    const body = await request.json()

    const { 
      nome, 
      descricao, 
      pais,
      statusId, 
      contratanteId,
      requerenteIds,
      arvore_id,
      data_termino 
    } = body

    if (pais && !Object.values(Pais).includes(pais)) {
      return NextResponse.json(
        { error: "País inválido" },
        { status: 400 }
      )
    }

    const updateData: any = {}
    
    if (nome !== undefined) updateData.nome = nome
    if (descricao !== undefined) updateData.descricao = descricao
    if (pais !== undefined) updateData.pais = pais
    if (statusId !== undefined) updateData.statusId = statusId
    if (contratanteId !== undefined) updateData.contratanteId = contratanteId
    if (arvore_id !== undefined) updateData.arvore_id = arvore_id
    if (data_termino !== undefined) {
      updateData.data_termino = data_termino ? new Date(data_termino) : null
    }

    const atividade = await prisma.atividade.update({
      where: { id: atividadeId },
      data: updateData,
      include: {
        status: true,
        contratante: true,
        requerentes: {
          include: {
            requerente: true
          }
        }
      }
    })

    if (requerenteIds !== undefined) {
      await prisma.atividadeRequerente.deleteMany({
        where: { atividadeId }
      })

      if (requerenteIds.length > 0) {
        await prisma.atividadeRequerente.createMany({
          data: requerenteIds.map((requerenteId: number) => ({
            atividadeId,
            requerenteId
          }))
        })
      }

      const atividadeAtualizada = await prisma.atividade.findUnique({
        where: { id: atividadeId },
        include: {
          status: true,
          contratante: true,
          requerentes: {
            include: {
              requerente: true
            }
          }
        }
      })

      return NextResponse.json({ atividade: atividadeAtualizada })
    }

    return NextResponse.json({ atividade })
  } catch (error) {
    console.error("Erro ao atualizar atividade:", error)
    return NextResponse.json(
      { error: "Erro ao atualizar atividade" },
      { status: 500 }
    )
  }
}

// DELETE - Excluir atividade
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const atividadeId = parseInt(id)

    await prisma.atividade.delete({
      where: { id: atividadeId }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Erro ao excluir atividade:", error)
    return NextResponse.json(
      { error: "Erro ao excluir atividade" },
      { status: 500 }
    )
  }
}
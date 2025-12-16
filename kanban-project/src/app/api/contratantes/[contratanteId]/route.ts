import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ contratanteId: string }> }
) {
  try {
    const { contratanteId: contratanteIdStr } = await params
    const contratanteId = Number.parseInt(contratanteIdStr)

    if (Number.isNaN(contratanteId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const { nome, cpf, rg, endereco, telefone } = await request.json()

    if (!nome || !nome.trim()) {
      return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 })
    }

    // Verificar se o contratante existe
    const contratanteExistente = await prisma.contratante.findUnique({
      where: { id: contratanteId }
    })

    if (!contratanteExistente) {
      return NextResponse.json({ error: "Contratante não encontrado" }, { status: 404 })
    }

    const contratante = await prisma.contratante.update({
      where: { id: contratanteId },
      data: {
        nome: nome.trim(),
        cpf: cpf?.trim() || null,
        rg: rg?.trim() || null,
        endereco: endereco?.trim() || null,
        telefone: telefone?.trim() || null,
      },
    })

    return NextResponse.json({ contratante })
  } catch (error) {
    console.error("Erro ao atualizar contratante:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ contratanteId: string }> }
) {
  try {
    const { contratanteId: contratanteIdStr } = await params
    const contratanteId = Number.parseInt(contratanteIdStr)

    if (Number.isNaN(contratanteId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    // Verificar se o contratante existe
    const contratanteExistente = await prisma.contratante.findUnique({
      where: { id: contratanteId }
    })

    if (!contratanteExistente) {
      return NextResponse.json({ error: "Contratante não encontrado" }, { status: 404 })
    }

    // Verificar se o contratante está sendo usado em alguma atividade
    const atividadesComContratante = await prisma.atividade.count({
      where: { contratanteId: contratanteId }
    })

    if (atividadesComContratante > 0) {
      return NextResponse.json(
        { error: "Não é possível excluir este contratante pois ele está associado a uma ou mais atividades" },
        { status: 400 }
      )
    }

    await prisma.contratante.delete({
      where: { id: contratanteId }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Erro ao deletar contratante:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
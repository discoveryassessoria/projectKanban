// src/app/api/contratantes/[contratanteId]/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { logContratante } from "@/lib/auditoria"

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
        processos: {
          include: {
            processo: {
              include: {
                status: true
              }
            }
          }
        }
      }
    })

    if (!contratante) {
      return NextResponse.json(
        { error: "Contratante não encontrado" },
        { status: 404 }
      )
    }

    const contratanteFormatado = {
      ...contratante,
      processos: contratante.processos.map(pc => pc.processo)
    }

    return NextResponse.json({ contratante: contratanteFormatado })
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

    const contratanteExistente = await prisma.contratante.findUnique({
      where: { id }
    })

    if (!contratanteExistente) {
      return NextResponse.json(
        { error: "Contratante não encontrado" },
        { status: 404 }
      )
    }

    const updateData: Record<string, unknown> = {}

    if (body.nome !== undefined) updateData.nome = body.nome
    if (body.cpf !== undefined) updateData.cpf = body.cpf
    if (body.rg !== undefined) updateData.rg = body.rg
    if (body.passaporte !== undefined) updateData.passaporte = body.passaporte  // ✅ NOVO
    if (body.crnm !== undefined) updateData.crnm = body.crnm                    // ✅ NOVO
    if (body.dataNascimento !== undefined) {
      updateData.dataNascimento = body.dataNascimento ? new Date(body.dataNascimento) : null
    }
    if (body.sexo !== undefined) updateData.sexo = body.sexo
    if (body.estadoCivil !== undefined) updateData.estadoCivil = body.estadoCivil
    if (body.nacionalidade !== undefined) updateData.nacionalidade = body.nacionalidade
    if (body.telefone !== undefined) updateData.telefone = body.telefone
    if (body.email !== undefined) updateData.email = body.email
    if (body.pais !== undefined) updateData.pais = body.pais                    // ✅ NOVO (se não tiver)
    if (body.endereco !== undefined) updateData.endereco = body.endereco
    if (body.numero !== undefined) updateData.numero = body.numero
    if (body.complemento !== undefined) updateData.complemento = body.complemento
    if (body.bairro !== undefined) updateData.bairro = body.bairro
    if (body.cidade !== undefined) updateData.cidade = body.cidade
    if (body.estado !== undefined) updateData.estado = body.estado
    if (body.cep !== undefined) updateData.cep = body.cep
    if (body.observacoes !== undefined) updateData.observacoes = body.observacoes
    if (body.fotoUrl !== undefined) updateData.fotoUrl = body.fotoUrl

    const contratante = await prisma.contratante.update({
      where: { id },
      data: updateData,
      include: {
        processos: {
          include: {
            processo: {
              include: {
                status: true
              }
            }
          }
        }
      }
    })

    // ✅ REGISTRAR LOG
    await logContratante.editar(contratante.nome, contratante.id)

    const contratanteFormatado = {
      ...contratante,
      processos: contratante.processos.map(pc => pc.processo)
    }

    return NextResponse.json({ contratante: contratanteFormatado })
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

    const contratanteExistente = await prisma.contratante.findUnique({
      where: { id }
    })

    if (!contratanteExistente) {
      return NextResponse.json(
        { error: "Contratante não encontrado" },
        { status: 404 }
      )
    }

    const nomeContratante = contratanteExistente.nome

    await prisma.contratante.delete({
      where: { id }
    })

    // ✅ REGISTRAR LOG
    await logContratante.excluir(nomeContratante, id)

    return NextResponse.json({ message: "Contratante excluído com sucesso" })
  } catch (error) {
    console.error("Erro ao excluir contratante:", error)
    return NextResponse.json(
      { error: "Erro ao excluir contratante" },
      { status: 500 }
    )
  }
}
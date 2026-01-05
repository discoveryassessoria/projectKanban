// CRIAR EM: src/app/api/fornecedores/[id]/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET - Buscar fornecedor por ID
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)

    const fornecedor = await prisma.fornecedor.findUnique({
      where: { id },
      include: {
        contasPagar: {
          orderBy: { dataVencimento: "desc" },
          take: 10
        }
      }
    })

    if (!fornecedor) {
      return NextResponse.json(
        { error: "Fornecedor não encontrado" },
        { status: 404 }
      )
    }

    return NextResponse.json(fornecedor)
  } catch (error) {
    console.error("Erro ao buscar fornecedor:", error)
    return NextResponse.json(
      { error: "Erro ao buscar fornecedor" },
      { status: 500 }
    )
  }
}

// PUT - Atualizar fornecedor
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)
    const body = await request.json()

    const fornecedor = await prisma.fornecedor.update({
      where: { id },
      data: {
        nome: body.nome,
        nomeFantasia: body.nomeFantasia,
        tipo: body.tipo,
        cpfCnpj: body.cpfCnpj,
        inscricaoEstadual: body.inscricaoEstadual,
        inscricaoMunicipal: body.inscricaoMunicipal,
        telefone: body.telefone,
        celular: body.celular,
        email: body.email,
        website: body.website,
        cep: body.cep,
        endereco: body.endereco,
        numero: body.numero,
        complemento: body.complemento,
        bairro: body.bairro,
        cidade: body.cidade,
        estado: body.estado,
        banco: body.banco,
        agencia: body.agencia,
        conta: body.conta,
        tipoConta: body.tipoConta,
        chavePix: body.chavePix,
        tipoChavePix: body.tipoChavePix,
        observacoes: body.observacoes,
        ativo: body.ativo,
      },
    })

    return NextResponse.json(fornecedor)
  } catch (error) {
    console.error("Erro ao atualizar fornecedor:", error)
    return NextResponse.json(
      { error: "Erro ao atualizar fornecedor" },
      { status: 500 }
    )
  }
}

// DELETE - Excluir fornecedor
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)

    // Verificar se há contas vinculadas
    const contasVinculadas = await prisma.contaPagar.count({
      where: { fornecedorId: id }
    })

    if (contasVinculadas > 0) {
      // Desativar ao invés de excluir
      await prisma.fornecedor.update({
        where: { id },
        data: { ativo: false }
      })
      return NextResponse.json({ message: "Fornecedor desativado (possui contas vinculadas)" })
    }

    await prisma.fornecedor.delete({
      where: { id },
    })

    return NextResponse.json({ message: "Fornecedor excluído com sucesso" })
  } catch (error) {
    console.error("Erro ao excluir fornecedor:", error)
    return NextResponse.json(
      { error: "Erro ao excluir fornecedor" },
      { status: 500 }
    )
  }
}
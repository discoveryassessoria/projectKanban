// CRIAR EM: src/app/api/fornecedores/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET - Listar fornecedores
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const ativo = searchParams.get("ativo")
    const busca = searchParams.get("busca")

    const where: any = {}
    
    if (ativo !== null) {
      where.ativo = ativo === "true"
    }
    
    if (busca) {
      where.OR = [
        { nome: { contains: busca, mode: "insensitive" } },
        { nomeFantasia: { contains: busca, mode: "insensitive" } },
        { cpfCnpj: { contains: busca } },
      ]
    }

    const fornecedores = await prisma.fornecedor.findMany({
      where,
      orderBy: { nome: "asc" },
      include: {
        _count: {
          select: { contasPagar: true }
        }
      }
    })

    // Calcular total pago por fornecedor
    const fornecedoresComTotais = await Promise.all(
      fornecedores.map(async (fornecedor) => {
        const totalPago = await prisma.contaPagar.aggregate({
          where: {
            fornecedorId: fornecedor.id,
            status: "PAGO"
          },
          _sum: {
            valorPago: true
          }
        })

        return {
          ...fornecedor,
          totalContas: fornecedor._count.contasPagar,
          totalPago: totalPago._sum.valorPago?.toNumber() || 0
        }
      })
    )

    return NextResponse.json(fornecedoresComTotais)
  } catch (error) {
    console.error("Erro ao listar fornecedores:", error)
    return NextResponse.json(
      { error: "Erro ao listar fornecedores" },
      { status: 500 }
    )
  }
}

// POST - Criar fornecedor
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const fornecedor = await prisma.fornecedor.create({
      data: {
        nome: body.nome,
        nomeFantasia: body.nomeFantasia || null,
        tipo: body.tipo || "PJ",
        cpfCnpj: body.cpfCnpj || null,
        inscricaoEstadual: body.inscricaoEstadual || null,
        inscricaoMunicipal: body.inscricaoMunicipal || null,
        telefone: body.telefone || null,
        celular: body.celular || null,
        email: body.email || null,
        website: body.website || null,
        cep: body.cep || null,
        endereco: body.endereco || null,
        numero: body.numero || null,
        complemento: body.complemento || null,
        bairro: body.bairro || null,
        cidade: body.cidade || null,
        estado: body.estado || null,
        banco: body.banco || null,
        agencia: body.agencia || null,
        conta: body.conta || null,
        tipoConta: body.tipoConta || null,
        chavePix: body.chavePix || null,
        tipoChavePix: body.tipoChavePix || null,
        observacoes: body.observacoes || null,
        ativo: true,
      },
    })

    return NextResponse.json(fornecedor, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar fornecedor:", error)
    return NextResponse.json(
      { error: "Erro ao criar fornecedor" },
      { status: 500 }
    )
  }
}
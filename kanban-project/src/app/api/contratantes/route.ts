import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET - Buscar todos os contratantes
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search") || ""

    const where = search
      ? {
          OR: [
            { nome: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
            { cpf: { contains: search, mode: "insensitive" as const } },
            { telefone: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}

    const contratantes = await prisma.contratante.findMany({
      where,
      include: {
        anexos: true,
        _count: {
          select: { atividades: true }
        }
      },
      orderBy: { nome: "asc" },
    })

    return NextResponse.json({ contratantes })
  } catch (error) {
    console.error("Erro ao buscar contratantes:", error)
    return NextResponse.json(
      { error: "Erro ao buscar contratantes" },
      { status: 500 }
    )
  }
}

// POST - Criar novo contratante
export async function POST(request: Request) {
  try {
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

    if (!nome || nome.trim() === "") {
      return NextResponse.json(
        { error: "Nome é obrigatório" },
        { status: 400 }
      )
    }

    const contratante = await prisma.contratante.create({
      data: {
        nome: nome.trim(),
        cpf: cpf || null,
        rg: rg || null,
        dataNascimento: dataNascimento ? new Date(dataNascimento) : null,
        sexo: sexo || null,
        estadoCivil: estadoCivil || null,
        nacionalidade: nacionalidade || null,
        telefone: telefone || null,
        email: email || null,
        endereco: endereco || null,
        numero: numero || null,
        complemento: complemento || null,
        bairro: bairro || null,
        cidade: cidade || null,
        estado: estado || null,
        cep: cep || null,
        observacoes: observacoes || null,
      },
      include: {
        anexos: true,
      },
    })

    return NextResponse.json({ contratante }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar contratante:", error)
    return NextResponse.json(
      { error: "Erro ao criar contratante" },
      { status: 500 }
    )
  }
}
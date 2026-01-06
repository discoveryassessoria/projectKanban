// src/app/api/contratantes/route.ts
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { logContratante } from "@/lib/auditoria"

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
        _count: {
          select: { processos: true }
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

    if (!body.nome || body.nome.trim() === "") {
      return NextResponse.json(
        { error: "Nome é obrigatório" },
        { status: 400 }
      )
    }

    const createData: Record<string, unknown> = {
      nome: body.nome.trim(),
    }

    if (body.cpf) createData.cpf = body.cpf
    if (body.rg) createData.rg = body.rg
    if (body.passaporte) createData.passaporte = body.passaporte  // ✅ NOVO
    if (body.crnm) createData.crnm = body.crnm                    // ✅ NOVO
    if (body.dataNascimento) createData.dataNascimento = new Date(body.dataNascimento)
    if (body.sexo) createData.sexo = body.sexo
    if (body.estadoCivil) createData.estadoCivil = body.estadoCivil
    if (body.nacionalidade) createData.nacionalidade = body.nacionalidade
    if (body.telefone) createData.telefone = body.telefone
    if (body.email) createData.email = body.email
    if (body.pais) createData.pais = body.pais                    // ✅ NOVO (se não tiver)
    if (body.endereco) createData.endereco = body.endereco
    if (body.numero) createData.numero = body.numero
    if (body.complemento) createData.complemento = body.complemento
    if (body.bairro) createData.bairro = body.bairro
    if (body.cidade) createData.cidade = body.cidade
    if (body.estado) createData.estado = body.estado
    if (body.cep) createData.cep = body.cep
    if (body.observacoes) createData.observacoes = body.observacoes

    const contratante = await prisma.contratante.create({
      data: createData as any,
    })

    // ✅ REGISTRAR LOG
    await logContratante.criar(contratante.nome, contratante.id)

    return NextResponse.json({ contratante }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar contratante:", error)
    return NextResponse.json(
      { error: "Erro ao criar contratante" },
      { status: 500 }
    )
  }
}
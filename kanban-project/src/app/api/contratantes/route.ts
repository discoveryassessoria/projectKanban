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

    // ✅ VALIDAÇÃO: Nome obrigatório
    if (!body.nome || body.nome.trim() === "") {
      return NextResponse.json(
        { error: "Nome é obrigatório", campo: "nome" },
        { status: 400 }
      )
    }

    // ✅ VALIDAÇÃO: CPF obrigatório
    if (!body.cpf || body.cpf.trim() === "") {
      return NextResponse.json(
        { error: "CPF é obrigatório", campo: "cpf" },
        { status: 400 }
      )
    }

    // ✅ Limpar CPF (remover pontos e traço)
    const cpfLimpo = body.cpf.replace(/\D/g, "")
    
    // ✅ Formatar CPF com máscara para busca em dados antigos
    const cpfComMascara = cpfLimpo.length === 11 
      ? cpfLimpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")
      : null

    // ✅ VALIDAÇÃO: Verificar se já existe contratante com mesmo NOME
    const contratanteComMesmoNome = await prisma.contratante.findFirst({
      where: {
        nome: {
          equals: body.nome.trim(),
          mode: "insensitive"
        }
      }
    })

    if (contratanteComMesmoNome) {
      return NextResponse.json(
        { 
          error: `Já existe um cliente cadastrado com o nome "${body.nome.trim()}"`,
          campo: "nome",
          contratanteExistente: {
            id: contratanteComMesmoNome.id,
            nome: contratanteComMesmoNome.nome
          }
        },
        { status: 409 }
      )
    }

    // ✅ VALIDAÇÃO: Verificar se já existe contratante com mesmo CPF
    // Busca tanto com máscara quanto sem máscara (para dados antigos)
    const cpfConditions = [{ cpf: cpfLimpo }]
    if (cpfComMascara) {
      cpfConditions.push({ cpf: cpfComMascara })
    }

    const contratanteComMesmoCPF = await prisma.contratante.findFirst({
      where: {
        OR: cpfConditions
      }
    })

    if (contratanteComMesmoCPF) {
      return NextResponse.json(
        { 
          error: `Já existe um cliente cadastrado com este CPF: ${contratanteComMesmoCPF.nome}`,
          campo: "cpf",
          contratanteExistente: {
            id: contratanteComMesmoCPF.id,
            nome: contratanteComMesmoCPF.nome
          }
        },
        { status: 409 }
      )
    }

    const createData: Record<string, unknown> = {
      nome: body.nome.trim(),
      cpf: cpfLimpo, // Salvar CPF sem máscara (padrão novo)
    }

    if (body.rg) createData.rg = body.rg
    if (body.passaporte) createData.passaporte = body.passaporte
    if (body.crnm) createData.crnm = body.crnm
    if (body.dataNascimento) createData.dataNascimento = new Date(body.dataNascimento)
    if (body.sexo) createData.sexo = body.sexo
    if (body.estadoCivil) createData.estadoCivil = body.estadoCivil
    if (body.nacionalidade) createData.nacionalidade = body.nacionalidade
    if (body.telefone) createData.telefone = body.telefone
    if (body.email) createData.email = body.email
    if (body.pais) createData.pais = body.pais
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
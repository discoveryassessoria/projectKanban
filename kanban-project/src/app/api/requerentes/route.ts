// src/app/api/requerentes/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { gerarCodigoPublico } from "@/lib/codigos/code-generator"
import { logRequerente } from "@/lib/auditoria"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// GET - Buscar todos os requerentes
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search") || ""

    const where = search
      ? {
          OR: [
            { publicCode: { contains: search, mode: "insensitive" as const } },
            { nome: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
            { cpf: { contains: search, mode: "insensitive" as const } },
            { telefone: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}

    const requerentes = await prisma.requerente.findMany({
      where,
      include: {
        _count: {
          select: { processos: true }
        }
      },
      orderBy: { nome: "asc" },
    })

    return NextResponse.json({ requerentes })
  } catch (error) {
    console.error("Erro ao buscar requerentes:", error)
    return NextResponse.json(
      { error: "Erro ao buscar requerentes" },
      { status: 500 }
    )
  }
}

// POST - Criar novo requerente
export async function POST(request: Request) {
  try {
    const erro = await verificarPermissao(request, 'clientes.criar')
    if (erro) return erro

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

    // ✅ VALIDAÇÃO: Verificar se já existe requerente com mesmo NOME
    const requerenteComMesmoNome = await prisma.requerente.findFirst({
      where: {
        nome: {
          equals: body.nome.trim(),
          mode: "insensitive"
        }
      }
    })

    if (requerenteComMesmoNome) {
      return NextResponse.json(
        { 
          error: `Já existe um cliente cadastrado com o nome "${body.nome.trim()}"`,
          campo: "nome",
          requerenteExistente: {
            id: requerenteComMesmoNome.id,
            nome: requerenteComMesmoNome.nome
          }
        },
        { status: 409 }
      )
    }

    // ✅ VALIDAÇÃO: Verificar se já existe requerente com mesmo CPF
    // Busca tanto com máscara quanto sem máscara (para dados antigos)
    const cpfConditions = [{ cpf: cpfLimpo }]
    if (cpfComMascara) {
      cpfConditions.push({ cpf: cpfComMascara })
    }

    const requerenteComMesmoCPF = await prisma.requerente.findFirst({
      where: {
        OR: cpfConditions
      }
    })

    if (requerenteComMesmoCPF) {
      return NextResponse.json(
        { 
          error: `Já existe um cliente cadastrado com este CPF: ${requerenteComMesmoCPF.nome}`,
          campo: "cpf",
          requerenteExistente: {
            id: requerenteComMesmoCPF.id,
            nome: requerenteComMesmoCPF.nome
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

    // CÓDIGO PÚBLICO — obrigatório, único, imutável, gerado no BACKEND.
    //
    // A criação nunca chamou o CodeGeneratorService: o cliente nascia com
    // `publicCode` null e a ficha mostrava "—". Gerar aqui, e não no frontend,
    // é o que torna o código à prova de concorrência — a sequência avança por
    // uma única instrução atômica no Postgres (INSERT ... ON CONFLICT DO UPDATE
    // ... RETURNING), e o lock de linha serializa criações simultâneas.
    //
    // Sequência e criação na MESMA transação: se o create falhar, o rollback
    // desfaz tudo e nenhum cliente fica sem código. O contador não retrocede —
    // um número queimado é preferível a um código reutilizado.
    const requerente = await prisma.$transaction(async (tx) => {
      const publicCode = await gerarCodigoPublico(tx, 'CLIENT')
      return tx.requerente.create({ data: { ...createData, publicCode } as any })
    })

    // ✅ REGISTRAR LOG
    await logRequerente.criar(requerente.nome, requerente.id)

    return NextResponse.json({ requerente }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar requerente:", error)
    return NextResponse.json(
      { error: "Erro ao criar requerente" },
      { status: 500 }
    )
  }
}
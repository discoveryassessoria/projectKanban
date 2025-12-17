import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Pais } from "@prisma/client"

// GET - Buscar processos (filtrado por país opcionalmente)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const pais = searchParams.get("pais") as Pais | null

    const where = pais ? { pais } : {}

    const processos = await prisma.processo.findMany({
      where,
      include: {
        status: true,
        contratante: true,
        arvore: true,
        requerentes: {
          include: {
            requerente: true
          }
        },
        tarefas: {
          include: {
            responsavel: true
          },
          orderBy: { createdAt: "desc" }
        },
        _count: {
          select: { 
            tarefas: true,
            anexos: true 
          }
        }
      },
      orderBy: { createdAt: "desc" }
    })

    // Formatar para incluir requerentes como array simples
    const processosFormatados = processos.map(p => ({
      ...p,
      requerentes: p.requerentes.map(r => r.requerente)
    }))

    return NextResponse.json({ processos: processosFormatados })
  } catch (error) {
    console.error("Erro ao buscar processos:", error)
    return NextResponse.json(
      { error: "Erro ao buscar processos" },
      { status: 500 }
    )
  }
}

// POST - Criar novo processo
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { 
      nome, 
      descricao, 
      observacoes,
      statusId, 
      pais, 
      contratanteId, 
      arvoreId,
      previsaoTermino,
      requerenteIds // Array de IDs de requerentes
    } = body

    if (!nome) {
      return NextResponse.json(
        { error: "Nome é obrigatório" },
        { status: 400 }
      )
    }

    if (!statusId) {
      return NextResponse.json(
        { error: "Status é obrigatório" },
        { status: 400 }
      )
    }

    if (!pais) {
      return NextResponse.json(
        { error: "País é obrigatório" },
        { status: 400 }
      )
    }

    // Validar se o país é válido
    if (!Object.values(Pais).includes(pais)) {
      return NextResponse.json(
        { error: "País inválido" },
        { status: 400 }
      )
    }

    // Verificar se o status existe e pertence ao país correto
    const status = await prisma.status.findUnique({
      where: { id: statusId }
    })

    if (!status) {
      return NextResponse.json(
        { error: "Status não encontrado" },
        { status: 404 }
      )
    }

    if (status.pais !== pais) {
      return NextResponse.json(
        { error: "Status não pertence a este país" },
        { status: 400 }
      )
    }

    // Criar o processo
    const processo = await prisma.processo.create({
      data: {
        nome,
        descricao: descricao || null,
        observacoes: observacoes || null,
        pais,
        statusId,
        contratanteId: contratanteId || null,
        arvoreId: arvoreId || null,
        previsaoTermino: previsaoTermino ? new Date(previsaoTermino) : null,
        // Criar relacionamentos com requerentes se fornecidos
        requerentes: requerenteIds?.length > 0 ? {
          create: requerenteIds.map((id: number) => ({
            requerenteId: id
          }))
        } : undefined
      },
      include: {
        status: true,
        contratante: true,
        arvore: true,
        requerentes: {
          include: {
            requerente: true
          }
        }
      }
    })

    // Formatar resposta
    const processoFormatado = {
      ...processo,
      requerentes: processo.requerentes.map(r => r.requerente)
    }

    return NextResponse.json({ processo: processoFormatado }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar processo:", error)
    return NextResponse.json(
      { error: "Erro ao criar processo" },
      { status: 500 }
    )
  }
}
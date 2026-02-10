import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// GET - Listar todas as uniões
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const arvoreId = searchParams.get('arvoreId')

    const where: any = {}
    
    // Filtrar por árvore se fornecido
    if (arvoreId) {
      where.pessoa1 = {
        arvoreId: parseInt(arvoreId)
      }
    }

    const unioes = await prisma.uniao.findMany({
      where,
      include: {
        pessoa1: {
          include: {
            pai: true,
            mae: true
          }
        },
        pessoa2: {
          include: {
            pai: true,
            mae: true
          }
        },
      },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json(unioes)
  } catch (error) {
    console.error("Erro ao buscar uniões:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// POST - Criar nova união
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'processos.editar')
    if (erro) return erro
    
    const body = await request.json()

    const {
      pessoa1Id,
      pessoa2Id,
      data_inicio,
      data_fim,
      tipo,
      local,
      // ✅ NOVOS CAMPOS
      estado,
      pais,
      cartorio,
      livro,
      folha,
      termo,
      numero_registro,
      data_registro,
      observacoes,
    } = body

    if (!pessoa1Id || !pessoa2Id) {
      return NextResponse.json(
        { error: "pessoa1Id e pessoa2Id são obrigatórios" },
        { status: 400 }
      )
    }

    // Verificar se ambas as pessoas existem
    const [pessoa1, pessoa2] = await Promise.all([
      prisma.pessoa.findUnique({ where: { id: Number(pessoa1Id) } }),
      prisma.pessoa.findUnique({ where: { id: Number(pessoa2Id) } }),
    ])

    if (!pessoa1 || !pessoa2) {
      return NextResponse.json(
        { error: "Uma ou ambas as pessoas não foram encontradas" },
        { status: 404 }
      )
    }

    // Verificar se já existe uma união entre essas pessoas
    const uniaoExistente = await prisma.uniao.findFirst({
      where: {
        OR: [
          { pessoa1Id: Number(pessoa1Id), pessoa2Id: Number(pessoa2Id) },
          { pessoa1Id: Number(pessoa2Id), pessoa2Id: Number(pessoa1Id) },
        ]
      }
    })

    if (uniaoExistente) {
      return NextResponse.json(
        { error: "Já existe uma união entre essas pessoas" },
        { status: 400 }
      )
    }

    const novaUniao = await prisma.uniao.create({
      data: {
        pessoa1Id: Number(pessoa1Id),
        pessoa2Id: Number(pessoa2Id),
        data_inicio: data_inicio ? new Date(data_inicio) : null,
        data_fim: data_fim ? new Date(data_fim) : null,
        tipo: tipo || 'casamento_civil',
        local: local || null,
        // ✅ NOVOS CAMPOS
        estado: estado || null,
        pais: pais || null,
        cartorio: cartorio || null,
        livro: livro || null,
        folha: folha || null,
        termo: termo || null,
        numero_registro: numero_registro || null,
        data_registro: data_registro ? new Date(data_registro) : null,
        observacoes: observacoes || null,
      },
      include: {
        pessoa1: {
          include: {
            pai: true,
            mae: true
          }
        },
        pessoa2: {
          include: {
            pai: true,
            mae: true
          }
        },
      },
    })

    return NextResponse.json(novaUniao, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar união:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
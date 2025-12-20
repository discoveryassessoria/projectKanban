import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET - Listar pessoas (com filtros opcionais)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const arvoreId = searchParams.get('arvoreId')

    const where: any = {}
    if (arvoreId) {
      where.arvoreId = parseInt(arvoreId)
    }

    const pessoas = await prisma.pessoa.findMany({
      where,
      include: {
        pai: {
          include: {
            pai: true,
            mae: true
          }
        },
        mae: {
          include: {
            pai: true,
            mae: true
          }
        },
        filhosComoPai: true,
        filhosComoMae: true,
      },
      orderBy: { id: 'asc' }
    })

    return NextResponse.json({ pessoas })
  } catch (error) {
    console.error("Erro ao listar pessoas:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// POST - Criar nova pessoa
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      nome, 
      sobrenome, 
      sexo, 
      data_nasc, 
      local_nasc,
      data_obito,
      batizado,
      comentario,
      arvoreId,
      paiId,
      maeId,
      x,
      y,
      // Para adicionar pai/mãe de um filho existente
      filhoId,
      tipoPai
    } = body

    if (!nome) {
      return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 })
    }

    if (!arvoreId) {
      return NextResponse.json({ error: "arvoreId é obrigatório" }, { status: 400 })
    }

    // Verificar se a árvore existe
    const arvore = await prisma.arvore.findUnique({
      where: { id: arvoreId }
    })

    if (!arvore) {
      return NextResponse.json({ error: "Árvore não encontrada" }, { status: 404 })
    }

    // Criar a pessoa
    const pessoa = await prisma.pessoa.create({
      data: {
        nome,
        sobrenome: sobrenome || null,
        sexo: sexo || null,
        data_nasc: data_nasc ? new Date(data_nasc) : null,
        local_nasc: local_nasc || null,
        data_obito: data_obito ? new Date(data_obito) : null,
        batizado: batizado || null,
        comentario: comentario || null,
        arvoreId,
        paiId: paiId || null,
        maeId: maeId || null,
        x: x || null,
        y: y || null,
      },
      include: {
        pai: true,
        mae: true,
        filhosComoPai: true,
        filhosComoMae: true,
      }
    })

    // Se está adicionando como pai ou mãe de um filho existente
    if (filhoId && tipoPai) {
      const updateData: any = {}
      if (tipoPai === 'pai') {
        updateData.paiId = pessoa.id
      } else if (tipoPai === 'mae') {
        updateData.maeId = pessoa.id
      }

      await prisma.pessoa.update({
        where: { id: filhoId },
        data: updateData
      })
    }

    // Se é a primeira pessoa da árvore, definir como pessoa principal
    const countPessoas = await prisma.pessoa.count({
      where: { arvoreId }
    })

    if (countPessoas === 1 && !arvore.pessoaPrincipalId) {
      await prisma.arvore.update({
        where: { id: arvoreId },
        data: { pessoaPrincipalId: pessoa.id }
      })
    }

    return NextResponse.json(pessoa, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar pessoa:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
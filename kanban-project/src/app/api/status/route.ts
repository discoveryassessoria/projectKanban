import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// GET - Buscar status (filtrado por país)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const pais = searchParams.get("pais")

    // ATENÇÃO: `Status.pais` é coluna DA PRÓPRIA entidade Status, não é
    // `Processo.pais`. Eu apliquei aqui, por engano, o resolvedor de identidade
    // do processo — e a rota passou a devolver 500. Status tem a sua própria
    // string de país, que é outro problema e outro escopo.
    const where = pais ? { pais } : {}

    const status = await prisma.status.findMany({
      where,
      orderBy: { ordem: "asc" },
      include: {
        _count: {
          select: { tarefas: true }
        }
      }
    })

    return NextResponse.json({ status })
  } catch (error) {
    console.error("Erro ao buscar status:", error)
    return NextResponse.json(
      { error: "Erro ao buscar status" },
      { status: 500 }
    )
  }
}

// POST - Criar novo status
export async function POST(request: Request) {
  try {
    const erro = await verificarPermissao(request, 'processos.criar_coluna')
    if (erro) return erro

    const body = await request.json()
    const { nome, pais } = body

    if (!nome || !pais) {
      return NextResponse.json(
        { error: "Nome e país são obrigatórios" },
        { status: 400 }
      )
    }

    // Validar se o país é válido
    // O país válido é o que está CADASTRADO, não uma constante do schema.
    const cadastrado = await prisma.catalogoPais.findFirst({
      where: { countryKey: pais.toLowerCase() }, select: { id: true },
    })
    if (!cadastrado) {
      return NextResponse.json(
        { error: "País inválido" },
        { status: 400 }
      )
    }

    // Buscar a maior ordem para este país
    const maxOrdem = await prisma.status.aggregate({
      where: { pais },
      _max: { ordem: true }
    })

    const novaOrdem = (maxOrdem._max.ordem ?? -1) + 1

    const status = await prisma.status.create({
      data: {
        nome,
        pais,
        ordem: novaOrdem
      }
    })

    return NextResponse.json({ status }, { status: 201 })
  } catch (error: any) {
    console.error("Erro ao criar status:", error)
    
    // Erro de unique constraint
    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "Já existe um status com esse nome neste país" },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: "Erro ao criar status" },
      { status: 500 }
    )
  }
}
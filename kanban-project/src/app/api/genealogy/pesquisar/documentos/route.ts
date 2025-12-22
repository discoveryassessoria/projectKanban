// ESTE ARQUIVO VAI EM: src/app/api/genealogy/pesquisar/documentos/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const tipo = searchParams.get("tipo")
    const status = searchParams.get("status")
    const pessoa = searchParams.get("pessoa")

    // Construir filtros dinamicamente
    const where: Prisma.DocumentoWhereInput = {}

    if (tipo) {
      where.tipo = tipo as any
    }

    if (status) {
      where.status = status as any
    }

    if (pessoa) {
      where.pessoa = {
        OR: [
          { nome: { contains: pessoa, mode: "insensitive" } },
          { sobrenome: { contains: pessoa, mode: "insensitive" } },
        ],
      }
    }

    const documentos = await prisma.documento.findMany({
      where,
      include: {
        pessoa: {
          select: {
            id: true,
            nome: true,
            sobrenome: true,
            arvoreId: true,
            arvore: {
              select: {
                id: true,
                nome: true,
                // Buscar o processo vinculado a esta árvore
                processos: {
                  select: {
                    id: true,
                    nome: true,
                    pais: true,
                  },
                  take: 1,
                },
              },
            },
          },
        },
      },
      orderBy: [
        { tipo: "asc" },
        { createdAt: "desc" },
      ],
      take: 100,
    })

    // Formatar resposta com processoId
    const resultado = documentos.map((d) => ({
      id: d.id,
      tipo: d.tipo,
      status: d.status,
      descricao: d.descricao,
      pessoaId: d.pessoaId,
      pessoaNome: d.pessoa?.nome,
      pessoaSobrenome: d.pessoa?.sobrenome,
      arvoreId: d.pessoa?.arvoreId,
      arvoreNome: d.pessoa?.arvore?.nome,
      // NOVO: Dados do processo vinculado
      processoId: d.pessoa?.arvore?.processos?.[0]?.id || null,
      processoNome: d.pessoa?.arvore?.processos?.[0]?.nome || null,
      processoPais: d.pessoa?.arvore?.processos?.[0]?.pais || null,
    }))

    return NextResponse.json(resultado)
  } catch (error) {
    console.error("Erro na pesquisa de documentos:", error)
    return NextResponse.json(
      { error: "Erro na pesquisa" },
      { status: 500 }
    )
  }
}
// ESTE ARQUIVO VAI EM: src/app/api/genealogy/pesquisar/pessoas/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const nome = searchParams.get("nome")
    const sobrenome = searchParams.get("sobrenome")
    const local = searchParams.get("local")
    const anoNasc = searchParams.get("anoNasc")
    const anoObito = searchParams.get("anoObito")
    const nacionalidade = searchParams.get("nacionalidade")
    const sexo = searchParams.get("sexo")

    // Construir filtros dinamicamente
    const where: Prisma.PessoaWhereInput = {}

    if (nome) {
      where.nome = {
        contains: nome,
        mode: "insensitive",
      }
    }

    if (sobrenome) {
      where.sobrenome = {
        contains: sobrenome,
        mode: "insensitive",
      }
    }

    if (local) {
      where.OR = [
        { local_nasc: { contains: local, mode: "insensitive" } },
        { estado_nasc: { contains: local, mode: "insensitive" } },
        { pais_nasc: { contains: local, mode: "insensitive" } },
      ]
    }

    if (anoNasc) {
      const ano = parseInt(anoNasc)
      if (!isNaN(ano)) {
        where.data_nasc = {
          gte: new Date(`${ano}-01-01`),
          lte: new Date(`${ano}-12-31`),
        }
      }
    }

    if (anoObito) {
      const ano = parseInt(anoObito)
      if (!isNaN(ano)) {
        where.data_obito = {
          gte: new Date(`${ano}-01-01`),
          lte: new Date(`${ano}-12-31`),
        }
      }
    }

    if (nacionalidade) {
      where.nacionalidade = {
        contains: nacionalidade,
        mode: "insensitive",
      }
    }

    if (sexo) {
      where.sexo = sexo
    }

    const pessoas = await prisma.pessoa.findMany({
      where,
      include: {
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
              take: 1, // Pegar apenas o primeiro processo (geralmente só tem um)
            },
          },
        },
        _count: {
          select: {
            documentos: true,
          },
        },
      },
      orderBy: [
        { nome: "asc" },
        { sobrenome: "asc" },
      ],
      take: 100,
    })

    // Formatar resposta com processoId
    const resultado = pessoas.map((p) => ({
      id: p.id,
      nome: p.nome,
      sobrenome: p.sobrenome,
      sexo: p.sexo,
      data_nasc: p.data_nasc,
      data_obito: p.data_obito,
      local_nasc: p.local_nasc,
      estado_nasc: p.estado_nasc,
      pais_nasc: p.pais_nasc,
      nacionalidade: p.nacionalidade,
      vivo: p.vivo,
      arvoreId: p.arvoreId,
      arvoreNome: p.arvore?.nome,
      // NOVO: Dados do processo vinculado
      processoId: p.arvore?.processos?.[0]?.id || null,
      processoNome: p.arvore?.processos?.[0]?.nome || null,
      processoPais: p.arvore?.processos?.[0]?.pais || null,
      _count: p._count,
    }))

    return NextResponse.json(resultado)
  } catch (error) {
    console.error("Erro na pesquisa de pessoas:", error)
    return NextResponse.json(
      { error: "Erro na pesquisa" },
      { status: 500 }
    )
  }
}
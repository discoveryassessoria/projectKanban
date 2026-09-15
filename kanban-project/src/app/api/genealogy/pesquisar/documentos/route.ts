// ESTE ARQUIVO VAI EM: src/app/api/genealogy/pesquisar/documentos/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { estadoOperacionalDosDocumentos, rotularEstadoDoDocumento } from "@/lib/operacional/documento-estado"

// O FILTRO "Status" da tela é sobre o ESTADO REAL do documento — a Tarefa
// viva, nunca `Documento.status` congelado (memória "documento-status-legado").
// `PENDENTE`/`RECEBIDO` continuam podendo ir no `where` (valores que a Tarefa
// nunca escreve de volta no campo, mas que ainda servem de sinal honesto para
// "nunca teve Tarefa" / "não é mais o alvo de nenhuma Tarefa viva" — filtrados
// de verdade DEPOIS, pelo estado derivado). `EM_ANDAMENTO` não existe como
// valor de `Documento.status`, então não dá pra usá-lo no `where`: busca-se o
// universo (recortado por tipo/pessoa) e filtra-se pelo estado derivado.
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const tipo = searchParams.get("tipo")
    const status = searchParams.get("status")
    const pessoa = searchParams.get("pessoa")

    // Construir filtros dinamicamente (nunca por `status` — ver acima)
    const where: Prisma.DocumentoWhereInput = {}

    if (tipo) {
      where.tipo = tipo as any
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
                    paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } },
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
      // Sem filtro de status: o `where` já corta o universo o bastante — cap
      // maior aqui porque o corte final (por status real) acontece depois.
      take: status ? 500 : 100,
    })

    const estados = await estadoOperacionalDosDocumentos(documentos.map((d) => d.id))

    // Formatar resposta com processoId + estado real
    let resultado = documentos.map((d) => {
      const derivado = rotularEstadoDoDocumento(d.status, estados.get(d.id))
      return {
        id: d.id,
        tipo: d.tipo,
        status: derivado.status,
        descricao: d.descricao,
        pessoaId: d.pessoaId,
        pessoaNome: d.pessoa?.nome,
        pessoaSobrenome: d.pessoa?.sobrenome,
        arvoreId: d.pessoa?.arvoreId,
        arvoreNome: d.pessoa?.arvore?.nome,
        // NOVO: Dados do processo vinculado
        processoId: d.pessoa?.arvore?.processos?.[0]?.id || null,
        processoNome: d.pessoa?.arvore?.processos?.[0]?.nome || null,
        processoPais: d.pessoa?.arvore?.processos?.[0]?.paisCanonico?.countryKey || null,
      }
    })

    if (status === "EM_ANDAMENTO") {
      resultado = resultado.filter((d) =>
        ["SEM_RESPONSAVEL", "A_FAZER", "EM_ANDAMENTO", "AGUARDANDO_TERCEIRO", "BLOQUEADA"].includes(d.status),
      )
    } else if (status) {
      resultado = resultado.filter((d) => d.status === status)
    }

    return NextResponse.json(resultado.slice(0, 100))
  } catch (error) {
    console.error("Erro na pesquisa de documentos:", error)
    return NextResponse.json(
      { error: "Erro na pesquisa" },
      { status: 500 }
    )
  }
}
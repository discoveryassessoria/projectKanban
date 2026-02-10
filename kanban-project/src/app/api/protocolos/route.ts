// src/app/api/protocolos/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Consulado } from "@prisma/client"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// GET - Buscar protocolos (filtrar por processoId)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const processoId = searchParams.get("processoId")

    if (!processoId) {
      return NextResponse.json(
        { error: "processoId é obrigatório" },
        { status: 400 }
      )
    }

    const protocolos = await prisma.protocolo.findMany({
      where: {
        processoId: parseInt(processoId)
      },
      include: {
        contratante: {
          select: {
            id: true,
            nome: true,
            email: true,
            telefone: true
          }
        },
        requerente: {
          select: {
            id: true,
            nome: true,
            email: true,
            telefone: true
          }
        }
      },
      orderBy: { createdAt: "desc" }
    })

    return NextResponse.json({ protocolos })
  } catch (error) {
    console.error("Erro ao buscar protocolos:", error)
    return NextResponse.json(
      { error: "Erro ao buscar protocolos" },
      { status: 500 }
    )
  }
}

// POST - Criar novo protocolo
export async function POST(request: Request) {
  try {
    const erro = await verificarPermissao(request, 'processos.editar')
    if (erro) return erro

    const body = await request.json()
    const {
      processoId,
      contratanteId,
      requerenteId,
      consulado,
      consuladoOutro,
      dataProtocolo,
      numeroProtocolo,
      observacoes
    } = body

    // Validações
    if (!processoId) {
      return NextResponse.json(
        { error: "processoId é obrigatório" },
        { status: 400 }
      )
    }

    if (!contratanteId && !requerenteId) {
      return NextResponse.json(
        { error: "É necessário vincular a um contratante ou requerente" },
        { status: 400 }
      )
    }

    if (!consulado || !Object.values(Consulado).includes(consulado)) {
      return NextResponse.json(
        { error: "Consulado inválido" },
        { status: 400 }
      )
    }

    if (consulado === "OUTROS" && !consuladoOutro) {
      return NextResponse.json(
        { error: "Nome do consulado é obrigatório quando 'Outros' é selecionado" },
        { status: 400 }
      )
    }

    // Verificar se processo existe e é da Espanha
    const processo = await prisma.processo.findUnique({
      where: { id: processoId }
    })

    if (!processo) {
      return NextResponse.json(
        { error: "Processo não encontrado" },
        { status: 404 }
      )
    }

    if (processo.pais !== "ESPANHA") {
      return NextResponse.json(
        { error: "Protocolos só podem ser criados para processos da Espanha" },
        { status: 400 }
      )
    }

    // Criar protocolo
    const protocolo = await prisma.protocolo.create({
      data: {
        processoId,
        contratanteId: contratanteId || null,
        requerenteId: requerenteId || null,
        consulado,
        consuladoOutro: consulado === "OUTROS" ? consuladoOutro : null,
        dataProtocolo: dataProtocolo ? new Date(dataProtocolo) : null,
        numeroProtocolo: numeroProtocolo || null,
        observacoes: observacoes || null
      },
      include: {
        contratante: {
          select: {
            id: true,
            nome: true
          }
        },
        requerente: {
          select: {
            id: true,
            nome: true
          }
        }
      }
    })

    return NextResponse.json({ protocolo }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar protocolo:", error)
    return NextResponse.json(
      { error: "Erro ao criar protocolo" },
      { status: 500 }
    )
  }
}
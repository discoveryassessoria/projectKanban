// src/app/api/processos/[processoId]/servicos/route.ts

import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// GET - Listar tipos de serviço do processo
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const { processoId } = await params
    const id = parseInt(processoId)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const servicos = await prisma.tipoServico.findMany({
      where: { processoId: id },
      orderBy: { ordem: 'asc' }
    })

    return NextResponse.json({ servicos })
  } catch (error) {
    console.error("Erro ao listar tipos de serviço:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// POST - Criar novo tipo de serviço
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'processos.editar')
    if (erro) return erro

    const { processoId } = await params
    const id = parseInt(processoId)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const body = await request.json()
    const { nome } = body

    if (!nome || nome.trim() === "") {
      return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 })
    }

    // Verificar se processo existe
    const processo = await prisma.processo.findUnique({
      where: { id }
    })

    if (!processo) {
      return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })
    }

    // Buscar próxima ordem
    const ultimoServico = await prisma.tipoServico.findFirst({
      where: { processoId: id },
      orderBy: { ordem: 'desc' }
    })
    const proximaOrdem = (ultimoServico?.ordem ?? -1) + 1

    const servico = await prisma.tipoServico.create({
      data: {
        processoId: id,
        nome: nome.trim(),
        ordem: proximaOrdem
      }
    })

    return NextResponse.json(servico, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar tipo de serviço:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
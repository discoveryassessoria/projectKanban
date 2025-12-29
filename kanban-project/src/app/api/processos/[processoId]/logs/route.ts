// src/app/api/processos/[processoId]/logs/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const { processoId } = await params
    const id = parseInt(processoId)

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    const { searchParams } = new URL(request.url)
    const limite = parseInt(searchParams.get('limite') || '50')

    // Buscar o processo para pegar arvoreId e outras informações
    const processo = await prisma.processo.findUnique({
      where: { id },
      include: {
        tarefas: { select: { id: true } },
        arvore: {
          include: {
            pessoas: { select: { id: true } }
          }
        }
      }
    })

    if (!processo) {
      return NextResponse.json(
        { error: "Processo não encontrado" },
        { status: 404 }
      )
    }

    // IDs relacionados ao processo
    const tarefaIds = processo.tarefas.map((t: { id: number }) => t.id)
    const pessoaIds = processo.arvore?.pessoas.map((p: { id: number }) => p.id) || []

    // Buscar logs relacionados ao processo
    const logs = await prisma.logAuditoria.findMany({
      where: {
        OR: [
          // Logs do próprio processo
          {
            entidade: 'PROCESSO',
            entidadeId: id
          },
          // Logs de tarefas do processo
          ...(tarefaIds.length > 0 ? [{
            entidade: 'TAREFA',
            entidadeId: { in: tarefaIds }
          }] : []),
          // Logs de pessoas da árvore
          ...(pessoaIds.length > 0 ? [{
            entidade: 'PESSOA',
            entidadeId: { in: pessoaIds }
          }] : []),
          // Logs de documentos
          ...(pessoaIds.length > 0 ? [{
            entidade: 'DOCUMENTO',
            entidadeId: { in: pessoaIds }
          }] : []),
        ]
      },
      include: {
        usuario: {
          select: { id: true, nome: true }
        }
      },
      orderBy: { criadoEm: 'desc' },
      take: limite
    })

    return NextResponse.json({ logs })
  } catch (error) {
    console.error('Erro ao buscar logs do processo:', error)
    return NextResponse.json(
      { error: "Erro ao buscar logs" },
      { status: 500 }
    )
  }
}
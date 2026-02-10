// src/app/api/processos/[processoId]/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { logProcesso } from "@/lib/auditoria"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// GET - Buscar processo por ID
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

    const processo = await prisma.processo.findUnique({
      where: { id },
      include: {
        status: true,
        contratantes: {
          include: {
            contratante: true
          }
        },
        arvore: true,
        requerentes: {
          include: {
            requerente: true
          }
        },
        tarefas: {
          include: {
            responsavel: true,
            subtarefas: {
              select: {
                id: true,
                prioridade: true,
                concluida: true
              }
            }
          },
          orderBy: { createdAt: "desc" }
        },
        anexos: {
          orderBy: { createdAt: "desc" }
        }
      }
    })

    if (!processo) {
      return NextResponse.json(
        { error: "Processo não encontrado" },
        { status: 404 }
      )
    }

    // Formatar resposta
    const processoFormatado = {
      ...processo,
      contratantes: processo.contratantes.map(c => c.contratante),
      requerentes: processo.requerentes.map(r => r.requerente)
    }

    return NextResponse.json({ processo: processoFormatado })
  } catch (error) {
    console.error("Erro ao buscar processo:", error)
    return NextResponse.json(
      { error: "Erro ao buscar processo" },
      { status: 500 }
    )
  }
}

// PUT - Atualizar processo
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'processos.editar')
    if (erro) return erro

    const { processoId } = await params
    const id = parseInt(processoId)

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { 
      nome, 
      descricao, 
      observacoes,
      statusId, 
      contratanteIds,
      arvoreId,
      previsaoTermino,
      dataConclusao,
      requerenteIds
    } = body

    // Verificar se o processo existe e pegar status atual
    const processoExistente = await prisma.processo.findUnique({
      where: { id },
      include: { status: true }
    })

    if (!processoExistente) {
      return NextResponse.json(
        { error: "Processo não encontrado" },
        { status: 404 }
      )
    }

    // Se statusId foi fornecido, verificar se pertence ao mesmo país
    let statusNovo = null
    if (statusId && statusId !== processoExistente.statusId) {
      statusNovo = await prisma.status.findUnique({
        where: { id: statusId }
      })

      if (!statusNovo) {
        return NextResponse.json(
          { error: "Status não encontrado" },
          { status: 404 }
        )
      }

      if (statusNovo.pais !== processoExistente.pais) {
        return NextResponse.json(
          { error: "Status não pertence a este país" },
          { status: 400 }
        )
      }
    }

    // Atualizar contratantes se fornecidos
    if (contratanteIds !== undefined) {
      await prisma.processoContratante.deleteMany({
        where: { processoId: id }
      })

      if (contratanteIds.length > 0) {
        await prisma.processoContratante.createMany({
          data: contratanteIds.map((contratanteId: number) => ({
            processoId: id,
            contratanteId
          }))
        })
      }
    }

    // Atualizar requerentes se fornecidos
    if (requerenteIds !== undefined) {
      await prisma.processoRequerente.deleteMany({
        where: { processoId: id }
      })

      if (requerenteIds.length > 0) {
        await prisma.processoRequerente.createMany({
          data: requerenteIds.map((requerenteId: number) => ({
            processoId: id,
            requerenteId
          }))
        })
      }
    }

    // Atualizar o processo
    await prisma.processo.update({
      where: { id },
      data: {
        nome: nome !== undefined ? nome : undefined,
        descricao: descricao !== undefined ? descricao : undefined,
        observacoes: observacoes !== undefined ? observacoes : undefined,
        statusId: statusId !== undefined ? statusId : undefined,
        arvoreId: arvoreId !== undefined ? arvoreId : undefined,
        previsaoTermino: previsaoTermino !== undefined 
          ? (previsaoTermino ? new Date(previsaoTermino) : null) 
          : undefined,
        dataConclusao: dataConclusao !== undefined 
          ? (dataConclusao ? new Date(dataConclusao) : null) 
          : undefined
      }
    })

    // ✅ REGISTRAR LOG
    if (statusNovo && processoExistente.status) {
      // Se mudou de status, registrar como "moveu"
      await logProcesso.mover(
        processoExistente.nome,
        id,
        processoExistente.status.nome,
        statusNovo.nome
      )
    } else {
      // Se só editou dados, registrar como "editou"
      await logProcesso.editar(processoExistente.nome, id)
    }

    // Buscar processo atualizado
    const processoAtualizado = await prisma.processo.findUnique({
      where: { id },
      include: {
        status: true,
        contratantes: {
          include: {
            contratante: true
          }
        },
        arvore: true,
        requerentes: {
          include: {
            requerente: true
          }
        },
        tarefas: {
          include: {
            responsavel: true,
            subtarefas: {
              select: {
                id: true,
                prioridade: true,
                concluida: true
              }
            }
          },
          orderBy: { createdAt: "desc" }
        }
      }
    })

    // Formatar resposta
    const processoFormatado = {
      ...processoAtualizado,
      contratantes: processoAtualizado?.contratantes.map(c => c.contratante) || [],
      requerentes: processoAtualizado?.requerentes.map(r => r.requerente) || []
    }

    return NextResponse.json({ processo: processoFormatado })
  } catch (error) {
    console.error("Erro ao atualizar processo:", error)
    return NextResponse.json(
      { error: "Erro ao atualizar processo" },
      { status: 500 }
    )
  }
}

// DELETE - Excluir processo
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'processos.excluir')
    if (erro) return erro

    const { processoId } = await params
    const id = parseInt(processoId)

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    // Buscar o processo para pegar nome e arvoreId ANTES de deletar
    const processo = await prisma.processo.findUnique({
      where: { id },
      select: { nome: true, arvoreId: true }
    })

    if (!processo) {
      return NextResponse.json(
        { error: "Processo não encontrado" },
        { status: 404 }
      )
    }

    const arvoreId = processo.arvoreId
    const nomeProcesso = processo.nome

    // Excluir o processo
    await prisma.processo.delete({
      where: { id }
    })

    // ✅ REGISTRAR LOG
    await logProcesso.excluir(nomeProcesso, id)

    // Se tinha uma árvore vinculada, verificar se ficou órfã
    let arvoreRemovida = false
    if (arvoreId) {
      const outrosProcessos = await prisma.processo.count({
        where: { arvoreId }
      })

      if (outrosProcessos === 0) {
        await prisma.arvore.delete({
          where: { id: arvoreId }
        })
        arvoreRemovida = true
      }
    }

    return NextResponse.json({ 
      message: arvoreRemovida 
        ? "Processo e árvore órfã excluídos com sucesso" 
        : "Processo excluído com sucesso",
      arvoreRemovida 
    })
  } catch (error) {
    console.error("Erro ao excluir processo:", error)
    return NextResponse.json(
      { error: "Erro ao excluir processo" },
      { status: 500 }
    )
  }
}
// ESTE ARQUIVO VAI EM: src/app/api/processos/[processoId]/route.ts
// SUBSTITUA O ARQUIVO EXISTENTE

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

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
            responsavel: true
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
      contratanteIds, // Array de IDs de contratantes
      arvoreId,
      previsaoTermino,
      dataConclusao,
      requerenteIds // Array de IDs de requerentes
    } = body

    // Verificar se o processo existe
    const processoExistente = await prisma.processo.findUnique({
      where: { id }
    })

    if (!processoExistente) {
      return NextResponse.json(
        { error: "Processo não encontrado" },
        { status: 404 }
      )
    }

    // Se statusId foi fornecido, verificar se pertence ao mesmo país
    if (statusId) {
      const status = await prisma.status.findUnique({
        where: { id: statusId }
      })

      if (!status) {
        return NextResponse.json(
          { error: "Status não encontrado" },
          { status: 404 }
        )
      }

      if (status.pais !== processoExistente.pais) {
        return NextResponse.json(
          { error: "Status não pertence a este país" },
          { status: 400 }
        )
      }
    }

    // Atualizar contratantes se fornecidos
    if (contratanteIds !== undefined) {
      // Remover todos os contratantes atuais
      await prisma.processoContratante.deleteMany({
        where: { processoId: id }
      })

      // Adicionar os novos
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
      // Remover todos os requerentes atuais
      await prisma.processoRequerente.deleteMany({
        where: { processoId: id }
      })

      // Adicionar os novos
      if (requerenteIds.length > 0) {
        await prisma.processoRequerente.createMany({
          data: requerenteIds.map((requerenteId: number) => ({
            processoId: id,
            requerenteId
          }))
        })
      }
    }

    // Atualizar o processo (campos básicos)
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

    // Buscar processo atualizado com todos os relacionamentos
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
            responsavel: true
          }
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

// DELETE - Excluir processo E LIMPAR ÁRVORE ÓRFÃ
export async function DELETE(
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

    // 1. Buscar o processo para pegar o arvoreId ANTES de deletar
    const processo = await prisma.processo.findUnique({
      where: { id },
      select: { arvoreId: true }
    })

    if (!processo) {
      return NextResponse.json(
        { error: "Processo não encontrado" },
        { status: 404 }
      )
    }

    const arvoreId = processo.arvoreId

    // 2. Excluir o processo (cascade vai deletar tarefas, requerentes, contratantes e anexos)
    await prisma.processo.delete({
      where: { id }
    })

    // 3. Se tinha uma árvore vinculada, verificar se ficou órfã
    let arvoreRemovida = false
    if (arvoreId) {
      // Verificar se algum outro processo usa essa árvore
      const outrosProcessos = await prisma.processo.count({
        where: { arvoreId }
      })

      // Se nenhum outro processo usa, deletar a árvore
      // (cascade do Prisma vai deletar pessoas, uniões, documentos)
      if (outrosProcessos === 0) {
        await prisma.arvore.delete({
          where: { id: arvoreId }
        })
        
        arvoreRemovida = true
        console.log(`✅ Árvore órfã ${arvoreId} foi deletada automaticamente`)
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
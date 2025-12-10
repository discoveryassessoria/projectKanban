import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// GET - Buscar um projeto específico
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params
    const id = parseInt(idParam)
    
    if (isNaN(id)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const projeto = await prisma.projetoKanban.findUnique({
      where: { id },
      include: {
        contratante: true,
        requerentes: {
          include: {
            requerente: true
          }
        },
        _count: {
          select: {
            atividades: true
          }
        }
      }
    })

    if (!projeto) {
      return NextResponse.json({ error: 'Projeto não encontrado' }, { status: 404 })
    }

    return NextResponse.json(projeto)
  } catch (error) {
    console.error('Erro ao buscar projeto:', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}

// DELETE - Excluir um projeto específico
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params
    console.log('DELETE request params:', idParam)
    console.log('ID recebido:', idParam)
    
    const id = parseInt(idParam)
    console.log('ID parseado:', id, 'isNaN:', isNaN(id))
    
    if (isNaN(id)) {
      console.log('Erro: ID inválido')
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    // Verificar se o projeto existe
    const projetoExistente = await prisma.projetoKanban.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            atividades: true
          }
        }
      }
    })

    console.log('Projeto encontrado:', projetoExistente)

    if (!projetoExistente) {
      console.log('Erro: Projeto não encontrado')
      return NextResponse.json({ error: 'Projeto não encontrado' }, { status: 404 })
    }

    // Verificar se há atividades vinculadas ao projeto
    console.log('Número de atividades:', projetoExistente._count.atividades)
    
    // Temporariamente comentado para teste - vamos forçar exclusão para debug
    /*
    if (projetoExistente._count.atividades > 0) {
      console.log('Erro: Projeto tem atividades vinculadas')
      return NextResponse.json({ 
        error: 'Não é possível excluir o projeto. Existem atividades vinculadas a ele.' 
      }, { status: 400 })
    }
    */
    
    // AVISO: Se há atividades, vamos avisar mas permitir exclusão para teste
    if (projetoExistente._count.atividades > 0) {
      console.log('AVISO: Projeto tem atividades vinculadas, mas prosseguindo com exclusão para teste')
    }

    // Excluir o projeto
    await prisma.projetoKanban.delete({
      where: { id }
    })

    return NextResponse.json({ 
      message: 'Projeto excluído com sucesso',
      id: id 
    })
  } catch (error) {
    console.error('Erro ao excluir projeto:', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}

// PUT/PATCH - Atualizar um projeto específico
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return PATCH(request, { params })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params
    const id = parseInt(idParam)
    
    if (isNaN(id)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const body = await request.json()
    const { nome, descricao, contratanteId, requerenteIds } = body

    // Preparar objeto de atualização
    const updateData: any = {}

    // Validações e atualizações condicionais
    if (nome !== undefined) {
      if (!nome || nome.trim().length === 0) {
        return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 })
      }
      if (nome.length > 50) {
        return NextResponse.json({ error: 'Nome deve ter no máximo 50 caracteres' }, { status: 400 })
      }
      updateData.nome = nome.trim()
    }

    if (descricao !== undefined) {
      if (descricao && descricao.length > 40) {
        return NextResponse.json({ error: 'Descrição deve ter no máximo 40 caracteres' }, { status: 400 })
      }
      updateData.descricao = descricao?.trim() || null
    }

    if (contratanteId !== undefined) {
      updateData.contratanteId = contratanteId
    }

    // Verificar se o projeto existe
    const projetoExistente = await prisma.projetoKanban.findUnique({
      where: { id }
    })

    if (!projetoExistente) {
      return NextResponse.json({ error: 'Projeto não encontrado' }, { status: 404 })
    }

    // Usar transação para atualizar projeto e requerentes
    const projetoAtualizado = await prisma.$transaction(async (tx) => {
      // Atualizar dados básicos do projeto
      const projeto = await tx.projetoKanban.update({
        where: { id },
        data: updateData
      })

      // Se requerenteIds foi fornecido, atualizar os requerentes
      if (requerenteIds !== undefined) {
        // Remover todas as associações existentes
        await tx.projetoRequerente.deleteMany({
          where: { projetoId: id }
        })

        // Criar novas associações
        if (Array.isArray(requerenteIds) && requerenteIds.length > 0) {
          await tx.projetoRequerente.createMany({
            data: requerenteIds.map((requerenteId: number) => ({
              projetoId: id,
              requerenteId: requerenteId
            }))
          })
        }
      }

      // Buscar projeto atualizado com relações
      return await tx.projetoKanban.findUnique({
        where: { id },
        include: {
          contratante: true,
          requerentes: {
            include: {
              requerente: true
            }
          },
          _count: {
            select: {
              atividades: true
            }
          }
        }
      })
    })

    return NextResponse.json(projetoAtualizado)
  } catch (error) {
    console.error('Erro ao atualizar projeto:', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}

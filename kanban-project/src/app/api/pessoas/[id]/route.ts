import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number.parseInt(params.id)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const pessoa = await prisma.pessoa.findUnique({
      where: { id },
      include: {
        pai: true,
        mae: true,
        filhosComoPai: true,
        filhosComoMae: true,
        arvore: true,
        unioesComoPessoa1: {
          include: {
            pessoa2: true,
          },
        },
        unioesComoPessoa2: {
          include: {
            pessoa1: true,
          },
        },
      },
    })

    if (!pessoa) {
      return NextResponse.json({ error: "Pessoa não encontrada" }, { status: 404 })
    }

    return NextResponse.json(pessoa)
  } catch (error) {
    console.error("Erro ao buscar pessoa:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number.parseInt(params.id)
    const { nome, sobrenome, data_nasc, local_nasc, data_obito, batizado, paiId, maeId, x, y } = await request.json()

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const pessoaAtualizada = await prisma.pessoa.update({
      where: { id },
      data: {
        nome,
        sobrenome,
        data_nasc: data_nasc ? new Date(data_nasc) : null,
        local_nasc,
        data_obito: data_obito ? new Date(data_obito) : null,
        batizado,
        paiId: paiId ? Number.parseInt(paiId) : null,
        maeId: maeId ? Number.parseInt(maeId) : null,
        x,
        y,
      },
      include: {
        pai: true,
        mae: true,
        arvore: true,
      },
    })

    return NextResponse.json(pessoaAtualizada)
  } catch (error) {
    console.error("Erro ao atualizar pessoa:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    console.log("[DELETE] Raw request params:", params)
    console.log("[DELETE] params.id value:", params.id)
    console.log("[DELETE] params.id type:", typeof params.id)
    console.log("[DELETE] params.id length:", params.id?.length)
    
    // Verificar se o params.id existe
    if (!params.id) {
      console.log("[DELETE] No ID provided in params")
      return NextResponse.json({ error: "ID não fornecido" }, { status: 400 })
    }
    
    // Tentar converter para número
    const id = Number.parseInt(params.id.trim())
    console.log("[DELETE] Parsed ID:", id)
    console.log("[DELETE] isNaN:", isNaN(id))
    console.log("[DELETE] id <= 0:", id <= 0)

    if (isNaN(id) || id <= 0) {
      console.log("[DELETE] Invalid ID detected - returning 400")
      return NextResponse.json({ 
        error: "ID inválido",
        debug: {
          originalId: params.id,
          parsedId: id,
          isNaN: isNaN(id),
          isNegativeOrZero: id <= 0
        }
      }, { status: 400 })
    }

    // Verificar se a pessoa existe
    console.log("[DELETE] Searching for person with ID:", id)
    const pessoa = await prisma.pessoa.findUnique({
      where: { id },
      include: {
        filhosComoPai: true,
        filhosComoMae: true,
        unioesComoPessoa1: true,
        unioesComoPessoa2: true,
      },
    })

    if (!pessoa) {
      console.log("[DELETE] Person not found")
      return NextResponse.json({ error: "Pessoa não encontrada" }, { status: 404 })
    }

    console.log("[DELETE] Person found:", {
      id: pessoa.id,
      nome: pessoa.nome,
      filhosComoPai: pessoa.filhosComoPai.length,
      filhosComoMae: pessoa.filhosComoMae.length,
      unioesComoPessoa1: pessoa.unioesComoPessoa1.length,
      unioesComoPessoa2: pessoa.unioesComoPessoa2.length,
    })

    // Verificar se tem filhos (não pode deletar se tiver)
    const totalFilhos = pessoa.filhosComoPai.length + pessoa.filhosComoMae.length
    if (totalFilhos > 0) {
      console.log("[DELETE] Person has children, cannot delete")
      return NextResponse.json({ 
        error: "Não é possível excluir uma pessoa que possui filhos" 
      }, { status: 400 })
    }

    // Executar deleção dentro de uma transação
    console.log("[DELETE] Starting deletion transaction...")
    
    try {
      await prisma.$transaction(async (tx) => {
        // 1. Deletar uniões onde a pessoa participa
        if (pessoa.unioesComoPessoa1.length > 0) {
          console.log("[DELETE] Deleting unions as pessoa1...")
          await tx.uniao.deleteMany({
            where: { pessoa1Id: id }
          })
        }
        
        if (pessoa.unioesComoPessoa2.length > 0) {
          console.log("[DELETE] Deleting unions as pessoa2...")
          await tx.uniao.deleteMany({
            where: { pessoa2Id: id }
          })
        }

        // 2. Remover referências de pai/mãe em outros registros
        console.log("[DELETE] Updating children references...")
        await tx.pessoa.updateMany({
          where: { paiId: id },
          data: { paiId: null }
        })
        
        await tx.pessoa.updateMany({
          where: { maeId: id },
          data: { maeId: null }
        })

        // 3. Finalmente, deletar a pessoa
        console.log("[DELETE] Deleting person...")
        await tx.pessoa.delete({
          where: { id },
        })
      })

      console.log("[DELETE] Person deleted successfully")
      return NextResponse.json({ 
        message: "Pessoa excluída com sucesso",
        id: id 
      })

    } catch (transactionError) {
      console.error("[DELETE] Transaction failed:", transactionError)
      
      // Verificar se é erro específico do Prisma
      if (transactionError instanceof Prisma.PrismaClientKnownRequestError) {
        switch (transactionError.code) {
          case 'P2003':
            return NextResponse.json({ 
              error: "Não é possível excluir: existem dependências relacionadas" 
            }, { status: 400 })
          case 'P2025':
            return NextResponse.json({ 
              error: "Pessoa não encontrada" 
            }, { status: 404 })
          default:
            console.error("[DELETE] Prisma error code:", transactionError.code)
            return NextResponse.json({ 
              error: "Erro de banco de dados" 
            }, { status: 500 })
        }
      }
      
      throw transactionError
    }

  } catch (error: unknown) {
    console.error("[DELETE] Unexpected error:", error)
    
    // Tratamento seguro do erro unknown
    let errorMessage = "Erro interno do servidor"
    
    if (error instanceof Error) {
      console.error("[DELETE] Error message:", error.message)
      console.error("[DELETE] Error stack:", error.stack)
      
      // Se for erro de desenvolvimento, incluir mais detalhes
      if (process.env.NODE_ENV === 'development') {
        errorMessage = `Erro: ${error.message}`
      }
    } else if (typeof error === 'string') {
      errorMessage = error
    } else {
      console.error("[DELETE] Unknown error type:", typeof error)
    }
    
    return NextResponse.json({ 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? String(error) : undefined
    }, { status: 500 })
  }
}
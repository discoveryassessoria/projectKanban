// ESTE ARQUIVO VAI EM: src/app/api/admin/limpar-arvores-orfas/route.ts
// API para limpar árvores que não estão vinculadas a nenhum processo

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET - Listar árvores órfãs (preview antes de deletar)
export async function GET() {
  try {
    // Buscar todas as árvores que NÃO estão vinculadas a nenhum processo
    const arvoresOrfas = await prisma.arvore.findMany({
      where: {
        processos: {
          none: {},
        },
      },
      include: {
        _count: {
          select: {
            pessoas: true,
          },
        },
      },
    })

    return NextResponse.json({
      total: arvoresOrfas.length,
      arvores: arvoresOrfas.map((a) => ({
        id: a.id,
        nome: a.nome,
        descricao: a.descricao,
        totalPessoas: a._count.pessoas,
      })),
    })
  } catch (error) {
    console.error("Erro ao buscar árvores órfãs:", error)
    return NextResponse.json({ error: "Erro ao buscar árvores órfãs" }, { status: 500 })
  }
}

// DELETE - Deletar todas as árvores órfãs
export async function DELETE(request: NextRequest) {
  try {
    // Verificar se é admin (você pode ajustar essa lógica conforme seu sistema de autenticação)
    // Por segurança, você pode adicionar uma verificação de token/sessão aqui

    // 1. Buscar IDs de todas as árvores órfãs
    const arvoresOrfas = await prisma.arvore.findMany({
      where: {
        processos: {
          none: {},
        },
      },
      select: { id: true, nome: true },
    })

    if (arvoresOrfas.length === 0) {
      return NextResponse.json({
        success: true,
        message: "Nenhuma árvore órfã encontrada",
        deletadas: 0,
      })
    }

    const idsParaDeletar = arvoresOrfas.map((a) => a.id)

    // 2. Deletar todas as árvores órfãs (cascade vai deletar pessoas, uniões, documentos)
    const resultado = await prisma.arvore.deleteMany({
      where: {
        id: { in: idsParaDeletar },
      },
    })

    console.log(`Limpeza: ${resultado.count} árvores órfãs deletadas`)

    return NextResponse.json({
      success: true,
      message: `${resultado.count} árvore(s) órfã(s) deletada(s) com sucesso`,
      deletadas: resultado.count,
      arvoresRemovidas: arvoresOrfas.map((a) => ({ id: a.id, nome: a.nome })),
    })
  } catch (error) {
    console.error("Erro ao limpar árvores órfãs:", error)
    return NextResponse.json({ error: "Erro ao limpar árvores órfãs" }, { status: 500 })
  }
}
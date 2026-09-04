// ESTE ARQUIVO VAI EM: src/app/api/admin/limpar-arvores-orfas/route.ts
// API para limpar árvores que não estão vinculadas a nenhum processo

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { exigirPermissao } from "@/src/lib/verificar-permissao"
import { FRASE_CONFIRMACAO } from "@/src/services/exclusao-definitiva"

// GET - Listar árvores órfãs (preview antes de deletar)
export async function GET(request: NextRequest) {
  const { erro } = await exigirPermissao(request, "sistema.exclusaoDefinitiva")
  if (erro) return erro
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
  // 🔒 Achado real: esta rota apagava em massa (cascade em pessoas, uniões e
  // documentos) sem NENHUMA verificação — o próprio comentário confessava que
  // faltava. Mesma trava do resto do sistema para exclusão definitiva:
  // permissão exclusiva + frase de confirmação, nunca "clicou, apagou".
  const { erro } = await exigirPermissao(request, "sistema.exclusaoDefinitiva")
  if (erro) return erro
  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  if (String((body as { confirmacao?: string })?.confirmacao ?? "").trim() !== FRASE_CONFIRMACAO) {
    return NextResponse.json({ error: `Confirmação inválida. Envie { "confirmacao": "${FRASE_CONFIRMACAO}" } no corpo.` }, { status: 400 })
  }
  try {
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
// AUTORIZAÇÃO SERVER-SIDE (B1).
// O middleware já exige JWT em toda rota /api, mas autenticado ≠ autorizado:
// sem esta guarda, qualquer usuário logado — independente do perfil — podia
// apagar a árvore inteira ou criar/excluir Pessoa. A UI escondia os botões; a
// API aceitava a chamada. Permissão de tela não é permissão de sistema.
import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { materializarExecucaoDaFase } from "@/src/services/materializar-fase"

// GET - Listar todas as árvores
export async function GET(request: NextRequest) {
  const semPermissao = await verificarPermissao(request, "arvore.ver")
  if (semPermissao) return semPermissao

  try {
    const arvores = await prisma.arvore.findMany({
      include: {
        pessoaPrincipal: true,
        familia: { select: { id: true, nome: true } }, // CP-1 dual-read
        _count: {
          select: { pessoas: true }
        }
      },
      orderBy: { id: 'desc' }
    })

    return NextResponse.json({ arvores })
  } catch (error) {
    console.error("Erro ao listar árvores:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// POST - Criar nova árvore
export async function POST(request: NextRequest) {
  const semPermissao = await verificarPermissao(request, "arvore.criar")
  if (semPermissao) return semPermissao

  try {
    const { nome, descricao, processoId } = await request.json()

    if (!nome) {
      return NextResponse.json({ error: "O nome da árvore é obrigatório" }, { status: 400 })
    }

    const novaArvore = await prisma.arvore.create({
      data: {
        nome,
        descricao,
      },
      include: {
        pessoas: true,
      },
    })

    // A ÁRVORE NÃO CRIA FAMÍLIA. Ela criava — copiando o próprio nome, que a
    // tela gera como "Árvore do Processo 458" — e cada tentativa deixava uma
    // família fantasma no cadastro. Família é cadastro: nasce quando alguém a
    // cadastra, não quando alguém clica em "criar árvore".
    if (processoId) {
      await prisma.processo.update({
        where: { id: processoId },
        data: { arvoreId: novaArvore.id }
      })
      // O processo nasce ANTES da árvore: quando a fase inicial foi materializada,
      // não havia árvore nenhuma e o plano de alvos saiu vazio. Agora que ela existe,
      // a fase converge pelo materializador OFICIAL. Best-effort — criar a árvore não
      // pode falhar por causa disto, e a Central converge de novo na leitura.
      try {
        await materializarExecucaoDaFase({ processoId, fonte: "RECONCILIACAO" })
      } catch (e) {
        console.error(`[arvore] convergência da fase do processo ${processoId} falhou (fluxo seguiu):`, e)
      }
    }

    return NextResponse.json({ ...novaArvore, familiaId: novaArvore.familiaId ?? null }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar árvore:", error)
    if (error instanceof Error) {
      console.error(error.message)
    }
    return NextResponse.json({ error: "Erro interno do servidor ao criar árvore" }, { status: 500 })
  }
}
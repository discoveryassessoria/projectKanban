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
    const { descricao, processoId } = await request.json()

    // ─── A ÁRVORE É ARTEFATO DO PROCESSO, E SÓ NASCE COM ELE ────────────────
    // Antes ela nascia sem processo e o nome vinha PRONTO do navegador, montado
    // como `Árvore do Processo ${processoId}`. Com o id indefinido a tela mandou
    // a string literal "Árvore do Processo undefined", e a API aceitou: ficaram
    // em produção duas árvores que nenhum processo alcançava, com seis pessoas
    // dentro, sobrevivendo a toda exclusão de processo porque nunca estiveram
    // ligadas a um. Agora falta processo, a criação RECUSA.
    const pid = Number(processoId)
    if (!Number.isInteger(pid) || pid <= 0) {
      return NextResponse.json(
        { error: "Árvore só existe dentro de um processo — informe o processo." },
        { status: 400 },
      )
    }

    const processo = await prisma.processo.findUnique({ where: { id: pid }, select: { id: true, nome: true } })
    if (!processo) {
      return NextResponse.json({ error: `Processo ${pid} não existe.` }, { status: 400 })
    }

    // O NOME SAI DO PROCESSO, no servidor. Uma fonte: o dia em que o processo
    // for renomeado, o rótulo aqui não vira mentira de um id solto.
    const nome = `Árvore · ${processo.nome}`.slice(0, 50)

    // CRIAR E LIGAR SÃO UM ATO SÓ. Em duas instruções, uma falha no update
    // deixava exatamente o resíduo que este endpoint passou a recusar.
    const novaArvore = await prisma.$transaction(async (tx) => {
      const arvore = await tx.arvore.create({
        data: { nome, descricao },
        include: { pessoas: true },
      })
      await tx.processo.update({ where: { id: pid }, data: { arvoreId: arvore.id } })
      return arvore
    })

    // A ÁRVORE NÃO CRIA FAMÍLIA. Ela criava — copiando o próprio nome, que a
    // tela gerava como "Árvore do Processo 458" — e cada tentativa deixava uma
    // família fantasma no cadastro. Família é cadastro: nasce quando alguém a
    // cadastra, não quando alguém clica em "criar árvore".

    // O processo nasce ANTES da árvore: quando a fase inicial foi materializada,
    // não havia árvore nenhuma e o plano de alvos saiu vazio. Agora que ela existe,
    // a fase converge pelo materializador OFICIAL. Best-effort — criar a árvore não
    // pode falhar por causa disto, e a Central converge de novo na leitura.
    try {
      await materializarExecucaoDaFase({ processoId: pid, fonte: "RECONCILIACAO" })
    } catch (e) {
      console.error(`[arvore] convergência da fase do processo ${pid} falhou (fluxo seguiu):`, e)
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
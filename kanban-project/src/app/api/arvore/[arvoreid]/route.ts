// AUTORIZAÇÃO SERVER-SIDE (B1).
// O middleware já exige JWT em toda rota /api, mas autenticado ≠ autorizado:
// sem esta guarda, qualquer usuário logado — independente do perfil — podia
// apagar a árvore inteira ou criar/excluir Pessoa. A UI escondia os botões; a
// API aceitava a chamada. Permissão de tela não é permissão de sistema.
import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { PESSOA_ATIVA } from "@/src/lib/genealogia/vinculo-ativo"
import { analisarExclusaoArvore, removerPessoaDaArvore } from "@/src/services/pessoa-ciclo-vida"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { removerFamiliaSeOrfa } from "@/src/services/familia"
import { FRASE_CONFIRMACAO } from "@/src/services/exclusao-definitiva"

export async function GET(request: NextRequest, { params }: { params: Promise<{ arvoreid: string }> }) {
  const semPermissao = await verificarPermissao(request, "arvore.ver")
  if (semPermissao) return semPermissao

  try {
    const { arvoreid } = await params
    const id = Number.parseInt(arvoreid)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const arvore = await prisma.arvore.findUnique({
      where: { id },
      include: {
        pessoas: {
          where: PESSOA_ATIVA,
          include: {
            pai: true,
            mae: true,
            filhosComoPai: true,
            filhosComoMae: true,
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
            // ✅ ADICIONADO: Incluir documentos de cada pessoa
            documentos: {
              orderBy: { createdAt: 'desc' }
            },
          },
        },
      },
    })

    if (!arvore) {
      return NextResponse.json({ error: "Árvore não encontrada" }, { status: 404 })
    }

    return NextResponse.json(arvore)
  } catch (error) {
    console.error("Erro ao buscar árvore:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ arvoreid: string }> }) {
  const semPermissao = await verificarPermissao(request, "arvore.editar")
  if (semPermissao) return semPermissao

  try {
    const { arvoreid } = await params
    const id = Number.parseInt(arvoreid)
    const { nome, descricao, pessoaPrincipalId, commentPosX, commentPosY, posicoesNodes } = await request.json()

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    // Filtra apenas os campos que foram enviados na requisição para não sobrescrever com `undefined`
    const dataToUpdate: { [key: string]: any } = {}
    if (nome !== undefined) dataToUpdate.nome = nome
    if (descricao !== undefined) dataToUpdate.descricao = descricao
    if (pessoaPrincipalId !== undefined) dataToUpdate.pessoaPrincipalId = pessoaPrincipalId
    if (commentPosX !== undefined) dataToUpdate.commentPosX = commentPosX
    if (commentPosY !== undefined) dataToUpdate.commentPosY = commentPosY
    if (posicoesNodes !== undefined) dataToUpdate.posicoesNodes = posicoesNodes

    if (Object.keys(dataToUpdate).length === 0) {
      return NextResponse.json({ error: "Nenhum dado para atualizar" }, { status: 400 })
    }

    const updatedArvore = await prisma.arvore.update({
      where: { id },
      data: dataToUpdate,
    })

    return NextResponse.json(updatedArvore)
  } catch (error) {
    console.error("Erro ao atualizar árvore:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ arvoreid: string }> }) {
  const semPermissao = await verificarPermissao(request, "arvore.excluir")
  if (semPermissao) return semPermissao

  try {
    const { arvoreid } = await params
    const id = Number.parseInt(arvoreid)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    // Ação irreversível de alto raio: exige a MESMA frase de confirmação do
    // padrão de exclusão definitiva do resto do sistema (§ exclusão definitiva
    // ADMIN) — digitada no cliente, revalidada aqui, nunca só no frontend.
    const body = await request.json().catch(() => ({} as Record<string, unknown>))
    if (String((body as Record<string, unknown>)?.confirmacao ?? "").trim() !== FRASE_CONFIRMACAO) {
      return NextResponse.json(
        { error: `Confirmação inválida. Digite exatamente "${FRASE_CONFIRMACAO}".` },
        { status: 400 },
      )
    }

    // Excluir a ÁRVORE é excluir cada pessoa dela — pelo mesmo serviço canônico,
    // uma a uma. A versão anterior fazia `pessoa.deleteMany({ arvoreId })` e
    // reproduzia o defeito da exclusão individual multiplicado por N: a cadeia
    // derivada de cada pessoa (vínculo com o processo, tarefa, passo, lançamento)
    // sobrevivia inteira, porque as FKs para Pessoa são `onDelete: SetNull`.
    //
    // Se QUALQUER pessoa tiver fato histórico protegido, a árvore não é excluída:
    // apagá-la destruiria a evidência. `analisarExclusaoArvore` é o MESMO motor
    // que a prévia (`GET .../plano-exclusao`) usa — sem segunda contagem.
    const arvoreAlvo = await prisma.arvore.findUnique({ where: { id }, select: { familiaId: true } })
    const plano = await analisarExclusaoArvore(id)
    if (!plano) {
      return NextResponse.json({ error: "Árvore não encontrada" }, { status: 404 })
    }
    if (plano.impedidas.length > 0) {
      return NextResponse.json(
        {
          error: "Esta árvore tem histórico protegido e não pode ser excluída.",
          code: "FATO_PROTEGIDO_IMPEDE_HARD_DELETE",
          impedidas: plano.impedidas.map((p) => ({
            pessoaId: p.pessoaId,
            nome: p.pessoaNome,
            fatos: p.fatosProtegidos.map((f) => f.descricao),
          })),
        },
        { status: 409 },
      )
    }

    const pessoas = await prisma.pessoa.findMany({ where: { arvoreId: id }, select: { id: true } })

    // Cada pessoa sai pelo serviço canônico — que já reconcilia depois de commitar.
    // Esta rota NÃO tem limpeza nem reconciliação própria: se tivesse, voltaria a
    // existir um segundo comportamento, que é exatamente o defeito corrigido aqui.
    const actorUserId = (await extrairUsuarioComPermissoes(request))?.userId ?? null
    for (const p of pessoas) {
      const r = await removerPessoaDaArvore({ pessoaId: p.id, actorUserId, modo: "HARD" })
      if (!r.ok) {
        return NextResponse.json(
          { error: r.erro, code: r.code, pessoaId: p.id },
          { status: r.code === "PESSOA_NAO_ENCONTRADA" ? 404 : 409 },
        )
      }
    }
    await prisma.arvore.delete({ where: { id } })

    // Mesma razão do processo: família sem árvore e sem processo é resíduo.
    const familiaRemovida = await removerFamiliaSeOrfa(arvoreAlvo?.familiaId)

    return NextResponse.json({
      message: "Árvore e todos os seus dados foram excluídos com sucesso",
      pessoasRemovidas: pessoas.length,
      familiaRemovida,
    })
  } catch (error) {
    console.error("Erro ao excluir árvore:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
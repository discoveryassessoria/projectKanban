import { edicaoRecusadaPorRegistro } from "@/src/services/genealogia/sincronizar-com-registro"
import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { aplicarMudancaNaArvore, PropagacaoPosCommitError } from "@/src/services/genealogia/propagar-arvore"
import { removerNecessidadesDaUniao } from "@/src/services/necessidade-documental"

/** União com certidão já em atendimento/atendida: fato acontecido — não se apaga por um clique. */
class UniaoComFatoError extends Error {
  constructor(readonly bloqueadas: { id: number; status: string }[]) {
    super("Esta união tem certidão de casamento já em atendimento ou atendida — não pode ser excluída. Resolva a certidão antes (dispensar/cancelar a operação).")
  }
}

// GET - Buscar união por ID
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const semPermissao = await verificarPermissao(request, "arvore.ver")
  if (semPermissao) return semPermissao

  try {
    const { id: idParam } = await params
    const id = Number.parseInt(idParam)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const uniao = await prisma.uniao.findUnique({
      where: { id },
      include: {
        pessoa1: {
          include: {
            pai: true,
            mae: true,
            documentos: true,
          }
        },
        pessoa2: {
          include: {
            pai: true,
            mae: true,
            documentos: true,
          }
        },
      },
    })

    if (!uniao) {
      return NextResponse.json({ error: "União não encontrada" }, { status: 404 })
    }

    return NextResponse.json(uniao)
  } catch (error) {
    console.error("Erro ao buscar união:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// PUT - Atualizar união
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'arvore.editar')
    if (erro) return erro

    const { id: idParam } = await params
    const id = Number.parseInt(idParam)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const body = await request.json()

    // SENTIDO ÚNICO (06/10/2026): data/local do casamento que vieram do REGISTRO localizado não se editam na árvore — corrige-se nos Dados Registrais.
    const travados = await edicaoRecusadaPorRegistro("UNIAO", id, body)
    if (travados) {
      return NextResponse.json(
        { error: `${travados.join(", ")}: veio do registro localizado na Genealogia. Para corrigir, altere nos Dados Registrais da certidão.`, codigo: "CAMPO_DO_REGISTRO", campos: travados },
        { status: 409 },
      )
    }

    const dataToUpdate: Prisma.UniaoUpdateInput = {}

    // Campos existentes
    if (body.data_inicio !== undefined) dataToUpdate.data_inicio = body.data_inicio ? new Date(body.data_inicio) : null
    if (body.data_fim !== undefined) dataToUpdate.data_fim = body.data_fim ? new Date(body.data_fim) : null
    if (body.tipo !== undefined) dataToUpdate.tipo = body.tipo
    if (body.local !== undefined) dataToUpdate.local = body.local

    // ✅ NOVOS CAMPOS
    if (body.estado !== undefined) dataToUpdate.estado = body.estado
    if (body.pais !== undefined) dataToUpdate.pais = body.pais
    if (body.cartorio !== undefined) dataToUpdate.cartorio = body.cartorio
    if (body.livro !== undefined) dataToUpdate.livro = body.livro
    if (body.folha !== undefined) dataToUpdate.folha = body.folha
    if (body.termo !== undefined) dataToUpdate.termo = body.termo
    if (body.numero_registro !== undefined) dataToUpdate.numero_registro = body.numero_registro
    if (body.data_registro !== undefined) dataToUpdate.data_registro = body.data_registro ? new Date(body.data_registro) : null
    if (body.observacoes !== undefined) dataToUpdate.observacoes = body.observacoes

    // Trocar cônjuge via edição
    if (body.pessoa1Id !== undefined) dataToUpdate.pessoa1 = { connect: { id: Number(body.pessoa1Id) } }
    if (body.pessoa2Id !== undefined) dataToUpdate.pessoa2 = { connect: { id: Number(body.pessoa2Id) } }

    const autorId = (await extrairUsuarioComPermissoes(request))?.userId ?? null
    // Editar a união muda o fato que sustenta a exigência de casamento (trocar
    // cônjuge muda de QUEM é a certidão). União + reavaliação documental na MESMA
    // transação (§37) — falhou → nada gravado, resposta de erro.
    const { resultado: uniaoAtualizada } = await aplicarMudancaNaArvore({
      arvoreId: null, autorId,
      arvoreIdDe: (u: { pessoa1: { arvoreId: number | null } | null; pessoa2: { arvoreId: number | null } | null }) => u.pessoa1?.arvoreId ?? u.pessoa2?.arvoreId,
      motivo: () => "união alterada",
      fn: (tx) => tx.uniao.update({
        where: { id },
        data: dataToUpdate,
        include: { pessoa1: true, pessoa2: true },
      }),
    })

    return NextResponse.json(uniaoAtualizada)
  } catch (error) {
    if (error instanceof PropagacaoPosCommitError) {
      return NextResponse.json({ error: error.message, salvo: true }, { status: 500 })
    }
    console.error("Erro ao atualizar união:", error)

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "União não encontrada" }, { status: 404 })
      }
    }

    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// DELETE - Excluir união
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'arvore.excluir')
    if (erro) return erro
    
    const { id: idParam } = await params
    const id = Number.parseInt(idParam)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const autorId = (await extrairUsuarioComPermissoes(request))?.userId ?? null
    // A árvore é lida ANTES do delete (depois não há como saber a qual pertencia).
    const antes = await prisma.uniao.findUnique({
      where: { id },
      select: { pessoa1: { select: { arvoreId: true } }, pessoa2: { select: { arvoreId: true } } },
    })
    if (!antes) return NextResponse.json({ error: "União não encontrada" }, { status: 404 })

    // DESFAZER O CASAMENTO É MUDANÇA DE ESTADO CIVIL (§37): numa transação só — as
    // necessidades da união saem (certidão → NAO_EXIGIDO, tarefa aberta cancelada,
    // passos cancelados; sem isso o CHECK `sujeito_xor` recusa apagar a união),
    // a união é apagada e a árvore é reavaliada. União com certidão já andada
    // (atendida/em atendimento) é FATO: recusa com 409, não apaga histórico.
    await aplicarMudancaNaArvore({
      arvoreId: antes.pessoa1?.arvoreId ?? antes.pessoa2?.arvoreId ?? null, autorId,
      motivo: () => "união desfeita (pessoa deixou de ser casada)",
      fn: async (tx) => {
        const r = await removerNecessidadesDaUniao(id, tx, "necessidade removida pela árvore: união desfeita (pessoa deixou de ser casada)", { usuarioId: autorId, origem: "união desfeita na árvore" })
        if (r.bloqueadas.length > 0) throw new UniaoComFatoError(r.bloqueadas)
        await tx.uniao.delete({ where: { id } })
        return r
      },
    })

    return NextResponse.json({ message: "União excluída com sucesso" })
  } catch (error) {
    if (error instanceof UniaoComFatoError) {
      return NextResponse.json({ error: error.message, code: "UNIAO_COM_FATO", bloqueadas: error.bloqueadas }, { status: 409 })
    }
    if (error instanceof PropagacaoPosCommitError) {
      return NextResponse.json({ error: error.message, salvo: true }, { status: 500 })
    }
    console.error("Erro ao excluir união:", error)

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "União não encontrada" }, { status: 404 })
      }
    }

    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
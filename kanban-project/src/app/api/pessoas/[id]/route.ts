// src/app/api/pessoas/[id]/route.ts

import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { dispararMaterializacaoPorArvore } from "@/src/services/genealogia/materializar-genealogia"
// LEGADO_INATIVO (desativação Genealogia): editar Pessoa NÃO reconcilia mais
// Documento (reconcileDocsForPessoa removido). A materialização V2 (Fatia 2) é
// aditiva/idempotente e não cria Documento.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: idParam } = await params
    const id = Number.parseInt(idParam)

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
        documentos: {
          orderBy: { createdAt: 'desc' }
        },
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

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'arvore.editar')
    if (erro) return erro

    const { id: idParam } = await params

    if (!idParam) {
      return NextResponse.json({ error: "ID não fornecido" }, { status: 400 })
    }

    const id = Number.parseInt(idParam.trim())

    if (isNaN(id) || id <= 0) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const body = await request.json()

    const dataToUpdate: Prisma.PessoaUpdateInput = {}

    // Campos existentes
    if (body.nome !== undefined) dataToUpdate.nome = body.nome
    if (body.sobrenome !== undefined) dataToUpdate.sobrenome = body.sobrenome
    if (body.sexo !== undefined) dataToUpdate.sexo = body.sexo
    if (body.data_nasc !== undefined) dataToUpdate.data_nasc = body.data_nasc ? new Date(body.data_nasc) : null
    if (body.local_nasc !== undefined) dataToUpdate.local_nasc = body.local_nasc
    if (body.data_obito !== undefined) dataToUpdate.data_obito = body.data_obito ? new Date(body.data_obito) : null
    if (body.batizado !== undefined) dataToUpdate.batizado = body.batizado
    if (body.comentario !== undefined) dataToUpdate.comentario = body.comentario
    if (body.paiId !== undefined)
      dataToUpdate.pai = body.paiId ? { connect: { id: Number(body.paiId) } } : { disconnect: true }
    if (body.maeId !== undefined)
      dataToUpdate.mae = body.maeId ? { connect: { id: Number(body.maeId) } } : { disconnect: true }
    if (body.x !== undefined) dataToUpdate.x = body.x
    if (body.y !== undefined) dataToUpdate.y = body.y

    // Campos expandidos
    if (body.estado_nasc !== undefined) dataToUpdate.estado_nasc = body.estado_nasc
    if (body.pais_nasc !== undefined) dataToUpdate.pais_nasc = body.pais_nasc
    if (body.vivo !== undefined) dataToUpdate.vivo = body.vivo
    if (body.data_batismo !== undefined) dataToUpdate.data_batismo = body.data_batismo ? new Date(body.data_batismo) : null
    if (body.local_batismo !== undefined) dataToUpdate.local_batismo = body.local_batismo
    if (body.igreja_batismo !== undefined) dataToUpdate.igreja_batismo = body.igreja_batismo
    if (body.profissao !== undefined) dataToUpdate.profissao = body.profissao
    if (body.nacionalidade !== undefined) dataToUpdate.nacionalidade = body.nacionalidade
    if (body.cidadanias_outras !== undefined) dataToUpdate.cidadanias_outras = body.cidadanias_outras
    if (body.naturalizado !== undefined) dataToUpdate.naturalizado = body.naturalizado
    if (body.data_naturalizacao !== undefined) dataToUpdate.data_naturalizacao = body.data_naturalizacao ? new Date(body.data_naturalizacao) : null
    if (body.pais_naturalizacao !== undefined) dataToUpdate.pais_naturalizacao = body.pais_naturalizacao
    if (body.data_emigracao !== undefined) dataToUpdate.data_emigracao = body.data_emigracao ? new Date(body.data_emigracao) : null
    if (body.local_emigracao !== undefined) dataToUpdate.local_emigracao = body.local_emigracao
    if (body.porto_embarque !== undefined) dataToUpdate.porto_embarque = body.porto_embarque
    if (body.data_chegada !== undefined) dataToUpdate.data_chegada = body.data_chegada ? new Date(body.data_chegada) : null
    if (body.porto_chegada !== undefined) dataToUpdate.porto_chegada = body.porto_chegada
    if (body.pais_destino !== undefined) dataToUpdate.pais_destino = body.pais_destino
    if (body.navio !== undefined) dataToUpdate.navio = body.navio

    // Requerente e Linhagem
    if (body.requerente !== undefined) dataToUpdate.requerente = body.requerente
    if (body.numeroLinhagem !== undefined) dataToUpdate.numeroLinhagem = body.numeroLinhagem ? parseInt(body.numeroLinhagem) : null
    if (body.linhaReta !== undefined) dataToUpdate.linhaReta = body.linhaReta === true
    if (body.documentacao !== undefined) dataToUpdate.documentacao = body.documentacao === true

    // ✅ NOVO (rodada 3): flag de casado pra engine
    if (body.casado !== undefined) dataToUpdate.casado = body.casado === true

    const pessoaAtualizada = await prisma.pessoa.update({
      where: { id },
      data: dataToUpdate,
      include: {
        pai: true,
        mae: true,
        arvore: true,
        documentos: { orderBy: { createdAt: 'desc' } },
      },
    })

    // ============================================================
    // LEGADO_INATIVO: editar Pessoa NÃO reconcilia mais Documento (DOCUMENT_RULES
    // desligado). ARQUITETURA NOVA (Fatia 2): ao mudar atributos relevantes
    // (documentacao/casado/vivo/requerente/linhaReta), reavalia as Regras
    // Documentais e reconcilia as NecessidadeDocumental da Genealogia (best-effort,
    // idempotente, sem criar Documento, sem avançar fase). Nunca quebra a edição.
    // ============================================================
    await dispararMaterializacaoPorArvore(pessoaAtualizada.arvoreId)

    return NextResponse.json(pessoaAtualizada)
  } catch (error) {
    console.error("Erro ao atualizar pessoa:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'arvore.excluir')
    if (erro) return erro

    const { id: idParam } = await params

    if (!idParam) {
      return NextResponse.json({ error: "ID não fornecido" }, { status: 400 })
    }

    const id = Number.parseInt(idParam.trim())

    if (isNaN(id) || id <= 0) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    // Verificar se a pessoa existe
    const pessoa = await prisma.pessoa.findUnique({
      where: { id },
      include: {
        filhosComoPai: true,
        filhosComoMae: true,
        unioesComoPessoa1: true,
        unioesComoPessoa2: true,
        documentos: true,
      },
    })

    if (!pessoa) {
      return NextResponse.json({ error: "Pessoa não encontrada" }, { status: 404 })
    }

    const uniaoIds = [
      ...pessoa.unioesComoPessoa1.map((u) => u.id),
      ...pessoa.unioesComoPessoa2.map((u) => u.id),
    ]

    // Executar deleção dentro de uma transação
    await prisma.$transaction(async (tx) => {
      // 0. Remover NecessidadeDocumental (materializadas pela Genealogia V2) da
      //    pessoa E das uniões que serão excluídas — ANTES de excluir pessoa/uniões.
      //    Necessário porque o sujeito tem CHECK (pessoaId XOR uniaoId) e as FKs são
      //    onDelete: SetNull: sem isto, a exclusão setaria o sujeito para NULL e
      //    violaria o CHECK (0 ≠ 1), travando a exclusão da pessoa. Passos operacionais
      //    vinculados (localizar_registro) saem junto (a necessidade é reproduzível
      //    pela materialização; eventos caem em cascata).
      const necsAlvo = await tx.necessidadeDocumental.findMany({
        where: { OR: [{ pessoaId: id }, ...(uniaoIds.length ? [{ uniaoId: { in: uniaoIds } }] : [])] },
        select: { id: true },
      })
      if (necsAlvo.length > 0) {
        const necIds = necsAlvo.map((n) => n.id)
        await tx.phaseWorkflowStepInstance.deleteMany({ where: { necessidadeId: { in: necIds } } })
        await tx.necessidadeDocumental.deleteMany({ where: { id: { in: necIds } } })
      }

      // 1. Deletar documentos da pessoa
      if (pessoa.documentos.length > 0) {
        await tx.documento.deleteMany({
          where: { pessoaId: id },
        })
      }

      // 2. Deletar uniões onde a pessoa participa
      if (pessoa.unioesComoPessoa1.length > 0) {
        await tx.uniao.deleteMany({
          where: { pessoa1Id: id },
        })
      }

      if (pessoa.unioesComoPessoa2.length > 0) {
        await tx.uniao.deleteMany({
          where: { pessoa2Id: id },
        })
      }

      // 3. Remover referências de pai/mãe nos filhos
      await tx.pessoa.updateMany({
        where: { paiId: id },
        data: { paiId: null },
      })

      await tx.pessoa.updateMany({
        where: { maeId: id },
        data: { maeId: null },
      })

      // 4. Deletar a pessoa
      await tx.pessoa.delete({
        where: { id },
      })
    })

    return NextResponse.json({
      message: "Pessoa excluída com sucesso",
      id: id,
    })
  } catch (error) {
    console.error("Erro ao excluir pessoa:", error)

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      switch (error.code) {
        case "P2003":
          return NextResponse.json(
            { error: "Não é possível excluir: existem dependências relacionadas" },
            { status: 400 }
          )
        case "P2025":
          return NextResponse.json(
            { error: "Pessoa não encontrada" },
            { status: 404 }
          )
      }
    }

    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
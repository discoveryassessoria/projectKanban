// src/app/api/pessoas/[id]/route.ts

import { edicaoRecusadaPorRegistro } from "@/src/services/genealogia/sincronizar-com-registro"
import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { houveTransicaoParaRequerente, ehRequerente } from "@/lib/genealogia/requerente-flag"
import { registrarTransicaoParaRequerenteTx, efeitosDoVinculoPosCommit } from "@/lib/genealogia/vincular-requerente"
import { aplicarMudancaNaArvore, descreverMudancaPessoa, SELECT_PESSOA_COMPARAVEL, PropagacaoPosCommitError } from "@/src/services/genealogia/propagar-arvore"
import { validarDocumentosExigidos, mesmaEscolha, type CodigoDocumentoExigivel } from "@/src/lib/genealogia/documentos-exigidos"
import { auditarDocumentosExigidos, certidoesJaAndadasQueSairiam } from "@/src/services/genealogia/documentos-exigidos-auditoria"
import { removerPessoaDaArvore, type ModoRemocao } from "@/src/services/pessoa-ciclo-vida"
// LEGADO_INATIVO (desativação Genealogia): editar Pessoa NÃO reconcilia mais
// Documento (reconcileDocsForPessoa removido). A materialização V2 (Fatia 2) é
// aditiva/idempotente e não cria Documento.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const semPermissao = await verificarPermissao(request, "arvore.ver")
  if (semPermissao) return semPermissao

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

    // SENTIDO ÚNICO (06/10/2026): campo que veio do REGISTRO localizado na Genealogia não se edita na árvore — corrige-se nos Dados Registrais da certidão.
    const travados = await edicaoRecusadaPorRegistro("PESSOA", id, body)
    if (travados) {
      return NextResponse.json(
        { error: `${travados.join(", ")}: veio do registro localizado na Genealogia. Para corrigir, altere nos Dados Registrais da certidão.`, codigo: "CAMPO_DO_REGISTRO", campos: travados },
        { status: 409 },
      )
    }

    // Estado ANTERIOR do flag — para detectar a TRANSIÇÃO não→requerente (§1/§9).
    const antes = await prisma.pessoa.findUnique({ where: { id }, select: { requerente: true, documentacao: true, documentosExigidos: true } })

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
    // INVARIANTE (dedup): só é possível MARCAR uma Pessoa como requerente se ela já
    // estiver vinculada a um Requerente do Processo (ProcessoRequerente → personId).
    // Assim, requerente na Árvore tem ProcessoRequerente como única fonte de verdade —
    // não se cria identidade de requerente por edição livre. Trocar o principal
    // (maior/menor/sim) entre requerentes JÁ vinculados e desmarcar ('nao') seguem ok.
    if (body.requerente !== undefined) {
      if (ehRequerente(body.requerente) && !ehRequerente(antes?.requerente)) {
        const vinculo = await prisma.requerente.findFirst({ where: { personId: id }, select: { id: true } })
        if (!vinculo) {
          return NextResponse.json(
            { error: "Requerente é definido pelo vínculo com o Processo. Use a lista de requerentes do processo para adicioná-lo à árvore." },
            { status: 422 },
          )
        }
      }
      dataToUpdate.requerente = body.requerente
    }
    // Nº Linhagem NÃO é mais escrito aqui: é CALCULADO por `recalcularNumerosLinhagemDaArvore`,
    // disparado por `efeitosDoVinculoPosCommit` logo abaixo — toda edição que pode afetar a
    // ordem (linhaReta, paiId/maeId, data_nasc) já passa por essa mesma porta.
    if (body.linhaReta !== undefined) dataToUpdate.linhaReta = body.linhaReta === true
    if (body.documentacao !== undefined) dataToUpdate.documentacao = body.documentacao === true

    // FILTRO DE CERTIDÕES (`documentosExigidos`): lista fechada NAS/CAS/OBI validada AQUI (constante única). Só grava quando
    // MUDOU de verdade (re-save de pessoa antiga NUNCA grava a lista cheia: `null` ≡ os três marcados) e é ignorado quando
    // a pessoa NÃO precisa de documentação (a caixa desligada vale mais que qualquer lista).
    let documentosExigidosNovo: CodigoDocumentoExigivel[] | null | undefined
    let decisaoRemocao: { motivo: string } | null = null
    if (body.documentosExigidos !== undefined) {
      const v = validarDocumentosExigidos(body.documentosExigidos)
      if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 })
      const documentacaoFinal = body.documentacao !== undefined ? body.documentacao === true : antes?.documentacao !== false
      if (documentacaoFinal && !mesmaEscolha(antes?.documentosExigidos ?? null, v.valor)) {
        // REGRA FIXA: tirar certidão que JÁ ANDOU exige confirmação explícita + motivo (decisão humana registrada).
        const andadas = await certidoesJaAndadasQueSairiam(prisma, { pessoaId: id, antes: antes?.documentosExigidos ?? null, depois: v.valor })
        const motivo = typeof body.motivoRemocaoDeCertidao === "string" ? body.motivoRemocaoDeCertidao.trim().replace(/\s+/g, " ") : ""
        if (andadas.length > 0) {
          if (body.confirmarRemocaoDeCertidao !== true || motivo.length < 10) {
            return NextResponse.json({
              error: `Esta edição tiraria da lista certidão(ões) que já andou(aram): ${andadas.join(", ")}. Confirme a remoção e informe o motivo (pelo menos 10 caracteres).`,
              code: "REMOCAO_DE_CERTIDAO_JA_ANDADA", certidoes: andadas,
            }, { status: 409 })
          }
          decisaoRemocao = { motivo: motivo.slice(0, 300) }
        }
        documentosExigidosNovo = v.valor
        dataToUpdate.documentosExigidos = v.valor ?? Prisma.DbNull
      }
    }

    // ✅ NOVO (rodada 3): flag de casado pra engine
    if (body.casado !== undefined) dataToUpdate.casado = body.casado === true

    // TRANSIÇÃO não→requerente? Só então o evento é emitido (nunca em edição de dados,
    // re-save ou reorder). Atualização + enfileiramento do evento na MESMA transação.
    const houveTransicao = body.requerente !== undefined && houveTransicaoParaRequerente(antes?.requerente, body.requerente)
    const actorId = houveTransicao ? (await extrairUsuarioComPermissoes(request))?.userId ?? null : null
    // Só posição no canvas (x/y)? Não muda nada que a árvore documental leia.
    const soPosicao = Object.keys(body).every((k) => k === "x" || k === "y")

    // A ÁRVORE É A ÚNICA FONTE DE VERDADE DOCUMENTAL (§37): a mudança da Pessoa e a
    // propagação para necessidade → documento → passo → tarefa acontecem na MESMA
    // transação (`aplicarMudancaNaArvore`). Falhou qualquer parte → nada é gravado e
    // a resposta é ERRO (não 200 com falha engolida).
    const autorDaMudanca = (await extrairUsuarioComPermissoes(request))?.userId ?? null
    const { resultado } = await aplicarMudancaNaArvore({
      arvoreId: null,
      autorId: autorDaMudanca,
      fn: async (tx) => {
        const estadoAntes = await tx.pessoa.findUnique({ where: { id }, select: SELECT_PESSOA_COMPARAVEL })
        const p = await tx.pessoa.update({
          where: { id },
          data: dataToUpdate,
          include: { pai: true, mae: true, arvore: true, documentos: { orderBy: { createdAt: 'desc' } } },
        })
        // "maior"/"menor" são classificação de MAIORIDADE de CADA requerente — fato
        // independente por pessoa (idade, não liderança). (Sem rebaixamento
        // automático: ver histórico desta rota.)
        // MESMA transação da atualização. Quem sabe o que "virar requerente"
        // significa é o serviço canônico — a rota só informa que a transição
        // ocorreu. Ela não conhece a DomainOutbox.
        if (houveTransicao && p.arvoreId) {
          await registrarTransicaoParaRequerenteTx(tx, { pessoaId: p.id, arvoreId: p.arvoreId, actorId })
        }
        if (documentosExigidosNovo !== undefined) {
          await auditarDocumentosExigidos(tx, { pessoaId: p.id, antes: estadoAntes?.documentosExigidos ?? null, depois: documentosExigidosNovo, usuarioId: autorDaMudanca, ...(decisaoRemocao ? { decisaoHumana: true, motivo: decisaoRemocao.motivo } : {}) })
        }
        return { pessoa: p, estadoAntes }
      },
      arvoreIdDe: (r) => (soPosicao ? null : r.pessoa.arvoreId),
      motivo: (r) => {
        if (soPosicao) return ""
        const mudou = descreverMudancaPessoa(r.estadoAntes, r.pessoa)
        return mudou.length ? mudou.join("; ") : "dados da pessoa alterados"
      },
    })
    const pessoaAtualizada = resultado.pessoa

    // Drena a fila do evento "virou requerente" (durável — falha aqui fica PENDENTE).
    // As convergências que não aceitam `tx` já rodaram em `aplicarMudancaNaArvore`
    // e, se falharem, o erro sobe (catch abaixo).
    if (houveTransicao) await efeitosDoVinculoPosCommit({ arvoreId: pessoaAtualizada.arvoreId })

    return NextResponse.json(pessoaAtualizada)
  } catch (error) {
    if (error instanceof PropagacaoPosCommitError) {
      return NextResponse.json({ error: error.message, salvo: true }, { status: 500 })
    }
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

    const existe = await prisma.pessoa.findUnique({ where: { id }, select: { id: true } })
    if (!existe) {
      return NextResponse.json({ error: "Pessoa não encontrada" }, { status: 404 })
    }

    // MODO: a rota não decide política. `AUTO` deixa o domínio escolher entre
    // exclusão definitiva e preservação de histórico; a UI pode forçar um dos
    // dois depois de ver o plano. Modo inválido cai em AUTO, nunca em hard delete.
    const url = new URL(request.url)
    const modoParam = (url.searchParams.get("modo") ?? "").toUpperCase()
    const modo: ModoRemocao =
      modoParam === "HARD" || modoParam === "DESATIVAR" ? modoParam : "AUTO"
    const motivo = url.searchParams.get("motivo")
    const actorUserId = (await extrairUsuarioComPermissoes(request))?.userId ?? null

    // TODA a exclusão vive no serviço canônico: uma transação, um dono, sem
    // meia exclusão. A rota só traduz HTTP.
    const resultado = await removerPessoaDaArvore({ pessoaId: id, actorUserId, modo, motivo })

    if (!resultado.ok) {
      const status = resultado.code === "PESSOA_NAO_ENCONTRADA" ? 404 : 409
      return NextResponse.json(
        { error: resultado.erro, code: resultado.code, plano: resultado.plano ?? null },
        { status },
      )
    }

    // A reconciliação NÃO é feita aqui: ela é parte do ato e vive no serviço
    // canônico (reconciliarAposRemocao), para que toda porta de entrada termine
    // no mesmo estado final. Rota que reconcilia por conta própria é a origem
    // da divergência que `DELETE /api/arvore/[id]` tinha.
    return NextResponse.json({
      message:
        resultado.modoExecutado === "HARD"
          ? "Pessoa e toda a cadeia derivada foram excluídas"
          : "Pessoa removida da árvore; histórico preservado",
      id,
      modo: resultado.modoExecutado,
      removidos: resultado.removidos,
      fatosPreservados: resultado.plano.fatosProtegidos,
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
// src/app/api/protocolos/[protocoloId]/route.ts
//
// Uma protocolização do processo. Toda alteração/exclusão também é historiada —
// a Timeline/Histórico é a única fonte cronológica dos protocolos realizados.

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { TipoProtocolo, FormaEnvioProtocolo } from "@prisma/client"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import {
  INCLUDE_PROTOCOLO,
  descreverProtocolizacao,
  registrarNaTimelineTx,
} from "@/src/services/protocolizacao"
import {
  FINALIDADES_DE_PROTOCOLO,
  SITUACOES_DE_PROTOCOLO,
  cardinalidadeDoProcesso,
  CARDINALIDADES,
} from "@/src/services/protocolo-canonico"

/**
 * A MESMA regra de escopo da criação, aplicada na edição.
 *
 * Vive aqui em vez de no serviço canônico porque o serviço registra (cria ou
 * reaproveita) e a edição REESCREVE — mas as duas perguntas são idênticas, e as
 * duas respostas saem do cadastro: o requerente pertence ao processo, e a
 * contagem cabe na cardinalidade da rota.
 */
async function validarEscopoNaEdicao(processoId: number, escopo: number[], finalidade: string): Promise<void> {
  const doProcesso = await prisma.processoRequerente.findMany({
    where: { processoId, requerenteId: { in: escopo } },
    select: { requerenteId: true },
  })
  const conhecidos = new Set(doProcesso.map((r) => r.requerenteId))
  const intrusos = escopo.filter((rid) => !conhecidos.has(rid))
  if (intrusos.length > 0) throw new Error(`REQUERENTE_FORA_DO_PROCESSO: ${intrusos.join(", ")}`)

  if (finalidade !== FINALIDADES_DE_PROTOCOLO.REQUERIMENTO) return
  const cardinalidade = await cardinalidadeDoProcesso(prisma, processoId)
  if (cardinalidade === CARDINALIDADES.INDIVIDUAL && escopo.length !== 1) {
    throw new Error(`REQUERIMENTO_INDIVIDUAL_ACEITA_UM_REQUERENTE: recebidos ${escopo.length}`)
  }
}

// GET - buscar protocolização por ID
export async function GET(
  request: Request,
  { params }: { params: Promise<{ protocoloId: string }> },
) {
  try {
    const { protocoloId } = await params
    const id = parseInt(protocoloId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const protocolo = await prisma.protocolo.findUnique({
      where: { id },
      include: {
        ...INCLUDE_PROTOCOLO,
        processo: { select: { id: true, nome: true, pais: true } },
      },
    })

    if (!protocolo) return NextResponse.json({ error: "Protocolo não encontrado" }, { status: 404 })

    return NextResponse.json({ protocolo })
  } catch (error) {
    console.error("Erro ao buscar protocolo:", error)
    return NextResponse.json({ error: "Erro ao buscar protocolo" }, { status: 500 })
  }
}

// PUT - atualizar protocolização
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ protocoloId: string }> },
) {
  try {
    const erro = await verificarPermissao(request, "processos.editar_paginas")
    if (erro) return erro
    const usuario = await extrairUsuarioComPermissoes(request)

    const { protocoloId } = await params
    const id = parseInt(protocoloId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const body = await request.json()
    const {
      contratanteId,
      requerenteId,
      orgaoId,
      setor,
      dataProtocolo,
      requerenteIds,
      numeroProtocolo,
      numeroProcesso,
      finalidade,
      situacao,
      tipoProtocolo,
      tipoProtocoloId,
      formaEnvio,
      responsavelId,
      observacoes,
      documentoIds,
    } = body

    const existente = await prisma.protocolo.findUnique({ where: { id } })
    if (!existente) return NextResponse.json({ error: "Protocolo não encontrado" }, { status: 404 })

    if (tipoProtocolo !== undefined && tipoProtocolo !== null && !Object.values(TipoProtocolo).includes(tipoProtocolo)) {
      return NextResponse.json({ error: "Tipo de protocolo inválido" }, { status: 400 })
    }
    if (formaEnvio !== undefined && formaEnvio !== null && !Object.values(FormaEnvioProtocolo).includes(formaEnvio)) {
      return NextResponse.json({ error: "Forma de envio inválida" }, { status: 400 })
    }

    const updateData: Record<string, unknown> = {}

    if (contratanteId !== undefined) {
      updateData.contratanteId = contratanteId || null
      if (contratanteId) updateData.requerenteId = null
    }
    if (requerenteId !== undefined) {
      updateData.requerenteId = requerenteId || null
      if (requerenteId) updateData.contratanteId = null
    }
    if (orgaoId !== undefined) {
      if (!orgaoId) return NextResponse.json({ error: "Órgão é obrigatório" }, { status: 400 })
      const orgao = await prisma.orgaoProtocolo.findUnique({ where: { id: Number(orgaoId) }, select: { id: true } })
      if (!orgao) return NextResponse.json({ error: "Órgão não encontrado" }, { status: 404 })
      updateData.orgaoId = Number(orgaoId)
    }
    if (setor !== undefined) updateData.setor = setor || null
    if (dataProtocolo !== undefined) {
      if (!dataProtocolo) return NextResponse.json({ error: "Data e hora do protocolo são obrigatórias" }, { status: 400 })
      updateData.dataProtocolo = new Date(dataProtocolo)
    }
    if (numeroProtocolo !== undefined) {
      if (!numeroProtocolo) return NextResponse.json({ error: "Número do protocolo é obrigatório" }, { status: 400 })
      updateData.numeroProtocolo = numeroProtocolo
    }
    if (tipoProtocolo !== undefined) updateData.tipoProtocolo = tipoProtocolo || null
    if (tipoProtocoloId !== undefined) {
      if (!tipoProtocoloId) return NextResponse.json({ error: "Selecione um tipo de protocolo do cadastro." }, { status: 400 })
      const tipo = await prisma.tipoProtocoloCadastro.findUnique({
        where: { id: Number(tipoProtocoloId) }, select: { id: true, code: true, ativo: true },
      })
      if (!tipo || !tipo.ativo) return NextResponse.json({ error: "Tipo de protocolo não encontrado ou inativo." }, { status: 400 })
      updateData.tipoProtocoloId = tipo.id
      updateData.tipoProtocolo = (Object.values(TipoProtocolo) as string[]).includes(tipo.code) ? tipo.code : null
    }
    if (formaEnvio !== undefined) updateData.formaEnvio = formaEnvio || null
    if (responsavelId !== undefined) {
      if (!responsavelId) return NextResponse.json({ error: "Responsável é obrigatório" }, { status: 400 })
      updateData.responsavelId = Number(responsavelId)
    }
    if (observacoes !== undefined) updateData.observacoes = observacoes || null
    if (numeroProcesso !== undefined) updateData.numeroProcesso = numeroProcesso?.trim() || null
    if (finalidade !== undefined) {
      if (!Object.values(FINALIDADES_DE_PROTOCOLO).includes(finalidade)) {
        return NextResponse.json({ error: "Finalidade inválida" }, { status: 400 })
      }
      updateData.finalidade = finalidade
    }
    if (situacao !== undefined) {
      if (!Object.values(SITUACOES_DE_PROTOCOLO).includes(situacao)) {
        return NextResponse.json({ error: "Situação inválida" }, { status: 400 })
      }
      // A data da situação acompanha a mudança: sem ela, "deferido" não tem quando.
      if (situacao !== existente.situacao) updateData.situacaoEm = new Date()
      updateData.situacao = situacao
    }

    // ESCOPO — a lista recebida é a verdade. Reescrever o vínculo aqui é o que
    // permite corrigir um requerimento coletivo que nasceu com um requerente a
    // menos, sem criar um segundo protocolo para o mesmo ato.
    const escopo: number[] | null = Array.isArray(requerenteIds)
      ? Array.from(new Set(requerenteIds.map(Number).filter((n: number) => Number.isInteger(n))))
      : null
    if (escopo) {
      await validarEscopoNaEdicao(existente.processoId, escopo, (finalidade ?? existente.finalidade) as string)
      updateData.requerenteId = escopo.length === 1 ? escopo[0] : null
    }

    const ids: number[] | null = Array.isArray(documentoIds)
      ? Array.from(new Set(documentoIds.map(Number).filter((n: number) => Number.isFinite(n))))
      : null

    const protocolo = await prisma.$transaction(async (tx) => {
      const atualizado = await tx.protocolo.update({
        where: { id },
        data: updateData,
        include: INCLUDE_PROTOCOLO,
      })

      if (escopo) {
        await tx.protocoloRequerente.deleteMany({
          where: { protocoloId: id, requerenteId: { notIn: escopo.length ? escopo : [-1] } },
        })
        if (escopo.length) {
          await tx.protocoloRequerente.createMany({
            data: escopo.map((requerenteId) => ({ protocoloId: id, requerenteId })),
            skipDuplicates: true,
          })
        }
      }

      // documentos enviados: a lista recebida é a verdade (substitui a anterior)
      if (ids) {
        await tx.protocoloDocumento.deleteMany({ where: { protocoloId: id, documentoId: { notIn: ids.length ? ids : [-1] } } })
        for (const documentoId of ids) {
          await tx.protocoloDocumento.upsert({
            where: { protocoloId_documentoId: { protocoloId: id, documentoId } },
            update: {},
            create: { protocoloId: id, documentoId },
          })
        }
      }

      const titulo = descreverProtocolizacao({
        numeroProtocolo: atualizado.numeroProtocolo,
        tipoProtocolo: atualizado.tipoProtocolo,
        orgaoNome: atualizado.orgao?.name ?? null,
      })

      await registrarNaTimelineTx(tx, {
        acao: "PROTOCOLO_ATUALIZADO",
        processoId: atualizado.processoId,
        protocoloId: atualizado.id,
        titulo: `${titulo} — atualizado`,
        quando: atualizado.dataProtocolo ?? new Date(atualizado.updatedAt),
        usuarioId: usuario?.userId ?? null,
        responsavelId: atualizado.responsavelId,
        detalhes: { protocoloId: atualizado.id, campos: Object.keys(updateData) },
      })

      return ids
        ? await tx.protocolo.findUnique({ where: { id }, include: INCLUDE_PROTOCOLO })
        : atualizado
    })

    return NextResponse.json({ protocolo })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ""
    if (msg.startsWith("REQUERENTE_FORA_DO_PROCESSO")) {
      return NextResponse.json({ error: "Há requerente selecionado que não pertence a este processo." }, { status: 400 })
    }
    if (msg.startsWith("REQUERIMENTO_INDIVIDUAL_ACEITA_UM_REQUERENTE")) {
      return NextResponse.json({ error: "Nesta rota o requerimento é individual: um requerente por protocolo." }, { status: 400 })
    }
    if (msg.includes("REQUERENTE_JA_TEM_REQUERIMENTO")) {
      return NextResponse.json({ error: "Este requerente já está coberto por um requerimento neste processo." }, { status: 409 })
    }
    console.error("Erro ao atualizar protocolo:", error)
    return NextResponse.json({ error: "Erro ao atualizar protocolo" }, { status: 500 })
  }
}

// DELETE - excluir protocolização
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ protocoloId: string }> },
) {
  try {
    const erro = await verificarPermissao(request, "processos.editar_paginas")
    if (erro) return erro
    const usuario = await extrairUsuarioComPermissoes(request)

    const { protocoloId } = await params
    const id = parseInt(protocoloId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const protocolo = await prisma.protocolo.findUnique({
      where: { id },
      include: { orgao: { select: { name: true } } },
    })
    if (!protocolo) return NextResponse.json({ error: "Protocolo não encontrado" }, { status: 404 })

    await prisma.$transaction(async (tx) => {
      await tx.protocolo.delete({ where: { id } })

      const titulo = descreverProtocolizacao({
        numeroProtocolo: protocolo.numeroProtocolo,
        tipoProtocolo: protocolo.tipoProtocolo,
        orgaoNome: protocolo.orgao?.name ?? null,
      })

      await registrarNaTimelineTx(tx, {
        acao: "PROTOCOLO_EXCLUIDO",
        processoId: protocolo.processoId,
        protocoloId: protocolo.id,
        titulo: `${titulo} — excluído`,
        quando: new Date(),
        usuarioId: usuario?.userId ?? null,
        detalhes: { protocoloId: protocolo.id, numero: protocolo.numeroProtocolo },
      })
    })

    return NextResponse.json({ message: "Protocolo excluído com sucesso" })
  } catch (error) {
    console.error("Erro ao excluir protocolo:", error)
    return NextResponse.json({ error: "Erro ao excluir protocolo" }, { status: 500 })
  }
}

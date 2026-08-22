// src/app/api/protocolos/route.ts
//
// Protocolizações DO PROCESSO. Protocolo não é cadastro: é um ato operacional
// registrado dentro do processo e que alimenta a Timeline/Histórico (fonte
// cronológica única).

import { NextResponse } from "next/server"
import { registrarProtocoloTx, ORIGENS_DE_PROTOCOLO } from "@/src/services/protocolo-canonico"
import { prisma } from "@/lib/prisma"
import { TipoProtocolo, FormaEnvioProtocolo } from "@prisma/client"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import {
  INCLUDE_PROTOCOLO,
  descreverProtocolizacao,
  registrarNaTimelineTx,
} from "@/src/services/protocolizacao"

// GET - protocolizações de um processo
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const processoId = searchParams.get("processoId")

    if (!processoId) {
      return NextResponse.json({ error: "processoId é obrigatório" }, { status: 400 })
    }

    const protocolos = await prisma.protocolo.findMany({
      where: { processoId: parseInt(processoId) },
      include: INCLUDE_PROTOCOLO,
      orderBy: [{ dataProtocolo: "desc" }, { createdAt: "desc" }],
    })

    return NextResponse.json({ protocolos })
  } catch (error) {
    console.error("Erro ao buscar protocolos:", error)
    return NextResponse.json({ error: "Erro ao buscar protocolos" }, { status: 500 })
  }
}

// POST - registrar protocolização
export async function POST(request: Request) {
  try {
    const erro = await verificarPermissao(request, "processos.editar_paginas")
    if (erro) return erro
    const usuario = await extrairUsuarioComPermissoes(request)

    const body = await request.json()
    const {
      processoId,
      contratanteId,
      requerenteId,
      orgaoId,
      setor,
      dataProtocolo,
      numeroProtocolo,
      tipoProtocolo,
      formaEnvio,
      responsavelId,
      observacoes,
      documentoIds,
    } = body

    // ── campos mínimos do ato ────────────────────────────────────────────────
    if (!processoId) {
      return NextResponse.json({ error: "processoId é obrigatório" }, { status: 400 })
    }
    if (!orgaoId) {
      return NextResponse.json({ error: "Órgão é obrigatório" }, { status: 400 })
    }
    if (!dataProtocolo) {
      return NextResponse.json({ error: "Data e hora do protocolo são obrigatórias" }, { status: 400 })
    }
    if (!numeroProtocolo) {
      return NextResponse.json({ error: "Número do protocolo é obrigatório" }, { status: 400 })
    }
    if (!tipoProtocolo || !Object.values(TipoProtocolo).includes(tipoProtocolo)) {
      return NextResponse.json({ error: "Tipo de protocolo inválido" }, { status: 400 })
    }
    if (!formaEnvio || !Object.values(FormaEnvioProtocolo).includes(formaEnvio)) {
      return NextResponse.json({ error: "Forma de envio inválida" }, { status: 400 })
    }
    if (!responsavelId) {
      return NextResponse.json({ error: "Responsável é obrigatório" }, { status: 400 })
    }

    const processo = await prisma.processo.findUnique({ where: { id: processoId }, select: { id: true } })
    if (!processo) {
      return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })
    }

    const orgao = await prisma.orgaoProtocolo.findUnique({ where: { id: Number(orgaoId) }, select: { id: true, name: true } })
    if (!orgao) {
      return NextResponse.json({ error: "Órgão não encontrado" }, { status: 404 })
    }

    const quando = new Date(dataProtocolo)
    const ids: number[] = Array.isArray(documentoIds)
      ? Array.from(new Set(documentoIds.map(Number).filter((n: number) => Number.isFinite(n))))
      : []

    const protocolo = await prisma.$transaction(async (tx) => {
      // QUEM ESCREVE `Protocolo` É UM SÓ. Esta rota continua sendo a tela de
      // protocolização do dossiê; o que ela deixou de fazer é criar a linha por conta
      // própria, que a tornava o segundo writer do mesmo fato.
      const { protocoloId } = await registrarProtocoloTx(tx, {
        processoId,
        contratanteId: contratanteId || null,
        requerenteId: requerenteId || null,
        orgaoId: Number(orgaoId),
        setor: setor || null,
        dataProtocolo: quando,
        numeroProtocolo,
        tipoProtocolo,
        formaEnvio,
        origem: ORIGENS_DE_PROTOCOLO.PROCESSO,
        responsavelId: Number(responsavelId),
        observacoes: observacoes || null,
        documentoIds: ids,
      })
      const criado = await tx.protocolo.findUniqueOrThrow({ where: { id: protocoloId }, include: INCLUDE_PROTOCOLO })

      const titulo = descreverProtocolizacao({
        numeroProtocolo: criado.numeroProtocolo,
        tipoProtocolo: criado.tipoProtocolo,
        orgaoNome: orgao.name,
      })

      await registrarNaTimelineTx(tx, {
        acao: "PROTOCOLO_REGISTRADO",
        processoId,
        protocoloId: criado.id,
        titulo,
        quando,
        usuarioId: usuario?.userId ?? null,
        responsavelId: criado.responsavelId,
        criarEvento: true,
        detalhes: {
          protocoloId: criado.id,
          orgao: orgao.name,
          setor: criado.setor,
          numero: criado.numeroProtocolo,
          tipo: criado.tipoProtocolo,
          formaEnvio: criado.formaEnvio,
          documentosEnviados: ids.length,
        },
      })

      return criado
    })

    return NextResponse.json({ protocolo }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar protocolo:", error)
    return NextResponse.json({ error: "Erro ao criar protocolo" }, { status: 500 })
  }
}

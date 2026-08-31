// src/app/api/protocolos/route.ts
//
// Protocolizações DO PROCESSO. Protocolo não é cadastro: é um ato operacional
// registrado dentro do processo e que alimenta a Timeline/Histórico (fonte
// cronológica única).

import { NextResponse } from "next/server"
import {
  registrarProtocoloTx,
  ORIGENS_DE_PROTOCOLO,
  FINALIDADES_DE_PROTOCOLO,
  SITUACOES_DE_PROTOCOLO,
} from "@/src/services/protocolo-canonico"
import { prisma } from "@/lib/prisma"
import { FormaEnvioProtocolo } from "@prisma/client"
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
      requerenteIds,
      orgaoId,
      setor,
      dataProtocolo,
      numeroProtocolo,
      numeroProcesso,
      finalidade,
      situacao,
      tipoProtocoloId,
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
    // TIPO — agora vem do cadastro. O enum continua sendo gravado enquanto a
    // coluna existir, e só quando o `code` do cadastro corresponde a um valor
    // dele: tipo novo criado pela operação simplesmente não tem enum, e isso é
    // correto — o enum é o legado, não a fonte.
    const tipo = tipoProtocoloId
      ? await prisma.tipoProtocoloCadastro.findUnique({
          where: { id: Number(tipoProtocoloId) },
          select: { id: true, code: true, ativo: true },
        })
      : null
    if (!tipo || !tipo.ativo) {
      return NextResponse.json({ error: "Selecione um tipo de protocolo do cadastro." }, { status: 400 })
    }

    if (formaEnvio && !Object.values(FormaEnvioProtocolo).includes(formaEnvio)) {
      return NextResponse.json({ error: "Forma de envio inválida" }, { status: 400 })
    }
    // Catálogos fechados: a rota não aceita classificação que o banco vai recusar.
    if (finalidade && !Object.values(FINALIDADES_DE_PROTOCOLO).includes(finalidade)) {
      return NextResponse.json({ error: "Finalidade inválida" }, { status: 400 })
    }
    if (situacao && !Object.values(SITUACOES_DE_PROTOCOLO).includes(situacao)) {
      return NextResponse.json({ error: "Situação inválida" }, { status: 400 })
    }

    // ESCOPO — aceita a lista (Itália, a família inteira) ou o id avulso, e
    // normaliza para lista antes de descer. Quem valida contagem e pertinência é
    // o serviço canônico, com a cardinalidade lida do cadastro.
    const escopo: number[] = Array.from(new Set(
      (Array.isArray(requerenteIds) ? requerenteIds : [])
        .map(Number).filter((n: number) => Number.isInteger(n)),
    ))

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
        requerenteIds: escopo,
        orgaoId: Number(orgaoId),
        setor: setor || null,
        dataProtocolo: quando,
        numeroProtocolo: numeroProtocolo || null,
        numeroProcesso: numeroProcesso || null,
        tipoProtocoloId: tipo.id,
        ...(finalidade ? { finalidade } : {}),
        ...(situacao ? { situacao } : {}),
        formaEnvio,
        origem: ORIGENS_DE_PROTOCOLO.PROCESSO,
        // QUEM PROTOCOLOU É QUEM REGISTRA. O campo saiu da tela porque perguntar
        // isso a quem está preenchendo o formulário é pedir que ele se identifique
        // duas vezes — e a resposta errada só apareceria num relatório, meses depois.
        responsavelId: responsavelId ? Number(responsavelId) : (usuario?.userId ?? null),
        observacoes: observacoes || null,
        documentoIds: ids,
      })
      const criado = await tx.protocolo.findUniqueOrThrow({ where: { id: protocoloId }, include: INCLUDE_PROTOCOLO })

      const titulo = descreverProtocolizacao({
        numeroProtocolo: criado.numeroProtocolo,
        tipoNome: criado.tipo?.nome ?? null,
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
          numeroProcesso: criado.numeroProcesso,
          finalidade: criado.finalidade,
          requerentesCobertos: escopo.length,
          tipo: criado.tipo?.nome ?? null,
          formaEnvio: criado.formaEnvio,
          documentosEnviados: ids.length,
        },
      })

      return criado
    })

    return NextResponse.json({ protocolo }, { status: 201 })
  } catch (error) {
    // As recusas de ESCOPO são erro do operador, não falha do sistema: voltam com
    // o que fazer, e não como 500 genérico.
    const msg = error instanceof Error ? error.message : ""
    if (msg.startsWith("REQUERENTE_FORA_DO_PROCESSO")) {
      return NextResponse.json({ error: "Há requerente selecionado que não pertence a este processo." }, { status: 400 })
    }
    if (msg.startsWith("REQUERIMENTO_INDIVIDUAL_ACEITA_UM_REQUERENTE")) {
      return NextResponse.json({
        error: "Nesta rota o requerimento é individual: um requerente por protocolo.",
      }, { status: 400 })
    }
    if (msg.includes("REQUERENTE_JA_TEM_REQUERIMENTO")) {
      return NextResponse.json({
        error: "Este requerente já está coberto por um requerimento neste processo.",
      }, { status: 409 })
    }
    console.error("Erro ao criar protocolo:", error)
    return NextResponse.json({ error: "Erro ao criar protocolo" }, { status: 500 })
  }
}

// src/app/api/protocolos/[protocoloId]/exigencias/route.ts
//
// EXIGÊNCIAS DE UM PROTOCOLO — o que o órgão pediu, e até quando.
//
// É entidade própria, e não dois campos no protocolo, porque o órgão exige mais
// de uma vez ao longo do mesmo expediente e cada exigência tem prazo, resposta e
// cumprimento próprios. Dois campos guardariam só a última e apagariam o
// histórico — que é justamente o que a operação precisa provar depois.
//
// Registrar uma exigência move a SITUAÇÃO do protocolo para EXIGENCIA: o órgão
// respondeu, e o protocolo deixou de estar apenas "protocolado". Isso é derivado
// do fato, não um campo que alguém precisa lembrar de mudar.

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { registrarNaTimelineTx } from "@/src/services/protocolizacao"
import { SITUACOES_DE_PROTOCOLO } from "@/src/services/protocolo-canonico"

export async function GET(request: Request, { params }: { params: Promise<{ protocoloId: string }> }) {
  const erro = await verificarPermissao(request, "processos.ver_paginas")
  if (erro) return erro
  const id = parseInt((await params).protocoloId)
  if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
  const exigencias = await prisma.protocoloExigencia.findMany({
    where: { protocoloId: id },
    orderBy: [{ cumpridaEm: "asc" }, { prazo: "asc" }, { id: "desc" }],
  })
  return NextResponse.json({ exigencias })
}

export async function POST(request: Request, { params }: { params: Promise<{ protocoloId: string }> }) {
  try {
    const erro = await verificarPermissao(request, "processos.editar_paginas")
    if (erro) return erro
    const usuario = await extrairUsuarioComPermissoes(request)

    const id = parseInt((await params).protocoloId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const { descricao, prazo, observacoes } = await request.json()
    if (!descricao || !String(descricao).trim()) {
      return NextResponse.json({ error: "Descreva o que o órgão exigiu." }, { status: 400 })
    }

    const protocolo = await prisma.protocolo.findUnique({
      where: { id },
      select: { id: true, processoId: true, numeroProtocolo: true, situacao: true, responsavelId: true },
    })
    if (!protocolo) return NextResponse.json({ error: "Protocolo não encontrado" }, { status: 404 })

    const exigencia = await prisma.$transaction(async (tx) => {
      const criada = await tx.protocoloExigencia.create({
        data: {
          protocoloId: id,
          descricao: String(descricao).trim(),
          prazo: prazo ? new Date(prazo) : null,
          observacoes: observacoes ? String(observacoes).trim() : null,
        },
      })

      // A situação segue o FATO. Um protocolo com exigência aberta não está mais
      // só "protocolado" — e ninguém deveria precisar lembrar de trocar isso à mão.
      // Deferido/indeferido/arquivado NÃO regridem: o órgão já decidiu, e uma
      // exigência registrada depois é histórico, não reabertura.
      const decidido: string[] = [
        SITUACOES_DE_PROTOCOLO.DEFERIDO, SITUACOES_DE_PROTOCOLO.INDEFERIDO, SITUACOES_DE_PROTOCOLO.ARQUIVADO,
      ]
      if (!decidido.includes(protocolo.situacao)) {
        await tx.protocolo.update({
          where: { id },
          data: { situacao: SITUACOES_DE_PROTOCOLO.EXIGENCIA, situacaoEm: new Date() },
        })
      }

      await registrarNaTimelineTx(tx, {
        acao: "PROTOCOLO_EXIGENCIA_REGISTRADA",
        processoId: protocolo.processoId,
        protocoloId: id,
        titulo: `Exigência do órgão no protocolo ${protocolo.numeroProtocolo ?? `#${id}`}`,
        quando: new Date(),
        usuarioId: usuario?.userId ?? null,
        responsavelId: protocolo.responsavelId,
        criarEvento: true,
        detalhes: { exigenciaId: criada.id, prazo: criada.prazo, descricao: criada.descricao },
      })

      return criada
    })

    return NextResponse.json({ exigencia }, { status: 201 })
  } catch (error) {
    console.error("Erro ao registrar exigência:", error)
    return NextResponse.json({ error: "Erro ao registrar a exigência" }, { status: 500 })
  }
}

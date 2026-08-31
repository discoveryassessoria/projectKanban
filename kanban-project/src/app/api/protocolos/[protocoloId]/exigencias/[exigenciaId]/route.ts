// Baixa, edição e remoção de UMA exigência.
//
// Cumprir a exigência devolve o protocolo a EM_ANALISE — e só quando NÃO sobra
// nenhuma em aberto. Voltar antes seria dizer que o órgão está analisando
// enquanto ainda espera documento nosso.

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { registrarNaTimelineTx } from "@/src/services/protocolizacao"
import { SITUACOES_DE_PROTOCOLO } from "@/src/services/protocolo-canonico"

type Ctx = { params: Promise<{ protocoloId: string; exigenciaId: string }> }

export async function PUT(request: Request, { params }: Ctx) {
  try {
    const erro = await verificarPermissao(request, "processos.editar_paginas")
    if (erro) return erro
    const usuario = await extrairUsuarioComPermissoes(request)

    const { protocoloId, exigenciaId } = await params
    const pid = parseInt(protocoloId)
    const eid = parseInt(exigenciaId)
    if (isNaN(pid) || isNaN(eid)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const body = await request.json()
    const existente = await prisma.protocoloExigencia.findFirst({
      where: { id: eid, protocoloId: pid },
      select: { id: true, cumpridaEm: true, protocolo: { select: { processoId: true, numeroProtocolo: true, situacao: true, responsavelId: true } } },
    })
    if (!existente) return NextResponse.json({ error: "Exigência não encontrada" }, { status: 404 })

    const data: Record<string, unknown> = {}
    if (body.descricao !== undefined) {
      if (!String(body.descricao).trim()) return NextResponse.json({ error: "Descreva o que o órgão exigiu." }, { status: 400 })
      data.descricao = String(body.descricao).trim()
    }
    if (body.prazo !== undefined) data.prazo = body.prazo ? new Date(body.prazo) : null
    if (body.observacoes !== undefined) data.observacoes = body.observacoes ? String(body.observacoes).trim() : null
    if (body.cumprida !== undefined) data.cumpridaEm = body.cumprida ? (existente.cumpridaEm ?? new Date()) : null

    const exigencia = await prisma.$transaction(async (tx) => {
      const atualizada = await tx.protocoloExigencia.update({ where: { id: eid }, data })

      const abertas = await tx.protocoloExigencia.count({ where: { protocoloId: pid, cumpridaEm: null } })
      const decidido: string[] = [
        SITUACOES_DE_PROTOCOLO.DEFERIDO, SITUACOES_DE_PROTOCOLO.INDEFERIDO, SITUACOES_DE_PROTOCOLO.ARQUIVADO,
      ]
      if (!decidido.includes(existente.protocolo.situacao)) {
        const alvo = abertas > 0 ? SITUACOES_DE_PROTOCOLO.EXIGENCIA : SITUACOES_DE_PROTOCOLO.EM_ANALISE
        if (alvo !== existente.protocolo.situacao) {
          await tx.protocolo.update({ where: { id: pid }, data: { situacao: alvo, situacaoEm: new Date() } })
        }
      }

      if (body.cumprida === true && !existente.cumpridaEm) {
        await registrarNaTimelineTx(tx, {
          acao: "PROTOCOLO_EXIGENCIA_CUMPRIDA",
          processoId: existente.protocolo.processoId,
          protocoloId: pid,
          titulo: `Exigência cumprida no protocolo ${existente.protocolo.numeroProtocolo ?? `#${pid}`}`,
          quando: new Date(),
          usuarioId: usuario?.userId ?? null,
          responsavelId: existente.protocolo.responsavelId,
          criarEvento: true,
          detalhes: { exigenciaId: eid, restantesEmAberto: abertas },
        })
      }
      return atualizada
    })

    return NextResponse.json({ exigencia })
  } catch (error) {
    console.error("Erro ao atualizar exigência:", error)
    return NextResponse.json({ error: "Erro ao atualizar a exigência" }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  try {
    const erro = await verificarPermissao(request, "processos.editar_paginas")
    if (erro) return erro
    const { protocoloId, exigenciaId } = await params
    const pid = parseInt(protocoloId)
    const eid = parseInt(exigenciaId)
    if (isNaN(pid) || isNaN(eid)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    const alvo = await prisma.protocoloExigencia.findFirst({ where: { id: eid, protocoloId: pid }, select: { id: true } })
    if (!alvo) return NextResponse.json({ error: "Exigência não encontrada" }, { status: 404 })
    await prisma.protocoloExigencia.delete({ where: { id: eid } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Erro ao excluir exigência:", error)
    return NextResponse.json({ error: "Erro ao excluir a exigência" }, { status: 500 })
  }
}

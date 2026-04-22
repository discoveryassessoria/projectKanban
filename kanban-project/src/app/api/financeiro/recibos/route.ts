// src/app/api/financeiro/recibos/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(request: NextRequest) {
  try {
    const processoId = Number(request.nextUrl.searchParams.get("processoId"))
    if (!processoId) {
      return NextResponse.json({ error: "processoId obrigatório" }, { status: 400 })
    }
    const recibos = await prisma.recibo.findMany({
      where: { processoId },
      include: {
        pagadorRequerente: { select: { id: true, nome: true } },
        pagadorContratante: { select: { id: true, nome: true } },
        emitidoPor: { select: { id: true, nome: true } }
      },
      orderBy: { createdAt: "desc" }
    })
    return NextResponse.json({ recibos })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const processoId = Number(body.processoId)

    const counter = await prisma.counterRecibo.upsert({
      where: { processoId },
      update: { proximoNumero: { increment: 1 } },
      create: { processoId, proximoNumero: 2 }
    })
    const numeroAtual = counter.proximoNumero - 1
    const numero = `RCB-${String(numeroAtual).padStart(4, "0")}`

    const data: any = {
      processoId,
      numero,
      data: body.data ? new Date(body.data) : new Date(),
      valorTotal: Number(body.valorTotal || 0),
      descricao: body.descricao || "",
      pagadorNome: body.pagadorNome || null,
      pdfUrl: body.pdfUrl || null,
      pdfNome: body.pdfNome || null,
      emitidoPorId: body.emitidoPorId || null,
    }

    if (body.pagadorTipo === "REQUERENTE" && body.pagadorId) {
      data.pagadorRequerenteId = Number(body.pagadorId)
    } else if (body.pagadorTipo === "CONTRATANTE" && body.pagadorId) {
      data.pagadorContratanteId = Number(body.pagadorId)
    }

    if (body.pagamentoIds && Array.isArray(body.pagamentoIds)) {
      data.pagamentos = {
        connect: body.pagamentoIds.map((id: number) => ({ id }))
      }
    }

    const recibo = await prisma.recibo.create({ data })
    return NextResponse.json({ recibo, numero }, { status: 201 })
  } catch (error: any) {
    console.error("Erro criar recibo:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
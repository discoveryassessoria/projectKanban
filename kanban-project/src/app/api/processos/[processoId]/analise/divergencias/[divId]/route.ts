import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const DECISOES_VALIDAS = ["aceita", "ressalva", "ignorada", "retificacao", "apoio_solicitado"]

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ processoId: string; divId: string }> }
) {
  try {
    const { divId } = await params
    const id = parseInt(divId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const body = await request.json()
    const decisao = body.decisao as string
    if (!DECISOES_VALIDAS.includes(decisao)) {
      return NextResponse.json(
        { error: `Decisão inválida. Use: ${DECISOES_VALIDAS.join(", ")}` },
        { status: 400 }
      )
    }

    const divergencia = await prisma.divergencia.findUnique({
      where: { id },
      select: { id: true, analiseId: true },
    })
    if (!divergencia) return NextResponse.json({ error: "Divergência não encontrada" }, { status: 404 })

    const now = new Date()
    await prisma.divergencia.update({
      where: { id },
      data: {
        status: decisao,
        notas: (body.notas || "").trim() || null,
        decididoPorId: body.decididoPorId ?? null,
        decididoEm: now,
      },
    })

    // Todas decididas → vai pra decisão jurídica; senão fica em revisão humana
    const pendentes = await prisma.divergencia.count({
      where: { analiseId: divergencia.analiseId, status: { in: ["pendente", "apoio_solicitado"] } },
    })
    await prisma.analiseDocumental.update({
      where: { id: divergencia.analiseId },
      data: { currentStep: pendentes === 0 ? "decisao_juridica" : "revisao_humana" },
    })

    const analise = await prisma.analiseDocumental.findUnique({
      where: { id: divergencia.analiseId },
      include: { divergencias: { orderBy: { id: "asc" } } },
    })
    return NextResponse.json({ analise })
  } catch (error) {
    console.error("[PATCH .../analise/divergencias/[divId]]", error)
    return NextResponse.json({ error: "Erro ao salvar decisão" }, { status: 500 })
  }
}
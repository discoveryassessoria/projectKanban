import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import type { FaseCode } from "@prisma/client"
import { dispararMotorNaFaseAtual } from "@/src/lib/motor/executor"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const { processoId } = await params
    const id = parseInt(processoId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const processo = await prisma.processo.findUnique({
      where: { id },
      select: { id: true, pais: true },
    })
    if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

    const analise = await prisma.analiseDocumental.findUnique({
      where: { processoId: id },
      include: { divergencias: { select: { status: true } } },
    })
    if (!analise) {
      return NextResponse.json({ error: "A análise ainda não foi rodada." }, { status: 422 })
    }

    // Todas as divergências precisam estar decididas
    const pendentes = analise.divergencias.filter(
      (d) => d.status === "pendente" || d.status === "apoio_solicitado"
    ).length
    if (pendentes > 0) {
      return NextResponse.json(
        { error: `Ainda há ${pendentes} divergência(s) sem decisão. Resolva antes de concluir.` },
        { status: 422 }
      )
    }

    // Alguma marcada "retificacao" → com retificação
    const comRetificacao = analise.divergencias.some((d) => d.status === "retificacao")
    const decisaoJuridica = comRetificacao ? "com_retificacao" : "sem_retificacao"
    const proximaFase: FaseCode = comRetificacao ? "RETIFICACAO_REGISTROS" : "TRADUCAO_JURAMENTADA"

    const colunaDestino = await prisma.status.findFirst({
      where: { pais: processo.pais, faseCode: proximaFase },
      select: { id: true },
    })
    if (!colunaDestino) {
      return NextResponse.json(
        { error: `Não há coluna para ${proximaFase} no país ${processo.pais}.` },
        { status: 422 }
      )
    }

    const now = new Date()
    await prisma.$transaction(async (tx) => {
      await tx.analiseDocumental.update({
        where: { id: analise.id },
        data: {
          status: "concluida", currentStep: "decisao_juridica",
          decisaoJuridica, requerRetificacao: comRetificacao, completedAt: now,
        },
      })
      await tx.processo.update({ where: { id }, data: { statusId: colunaDestino.id } })
    }, { timeout: 30000, maxWait: 10000 })

    // MOTOR — a fase avançou; dispara o motor (best-effort)
    await dispararMotorNaFaseAtual(id)

    return NextResponse.json({ ok: true, decisao: decisaoJuridica, proximaFase })
  } catch (error) {
    console.error("[POST .../analise/concluir]", error)
    return NextResponse.json({ error: "Erro ao concluir análise" }, { status: 500 })
  }
}
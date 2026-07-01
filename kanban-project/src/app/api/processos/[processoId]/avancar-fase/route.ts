import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getNextFase } from "@/src/lib/process-stage/fases-catalog"
import type { FaseCode } from "@prisma/client"
import { executarMotorNaFase, resolvePhaseKey } from "@/src/lib/motor/executor"

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
      select: { id: true, pais: true, tipoProcessoMotorId: true, status: { select: { faseCode: true } } },
    })
    if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

    const faseAtual = processo.status?.faseCode as FaseCode | null
    if (!faseAtual) return NextResponse.json({ error: "A coluna atual não tem faseCode." }, { status: 422 })

    const proximaFase = getNextFase(faseAtual)
    if (!proximaFase) return NextResponse.json({ error: "Esta já é a última fase." }, { status: 422 })

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

    await prisma.processo.update({ where: { id }, data: { statusId: colunaDestino.id } })

    // ============================================================
    // MOTOR — gatilho automático (Fase 4.3). "Best-effort":
    // se a chave estiver ligada E o processo estiver conectado a um Tipo do
    // motor, roda as automações da NOVA fase (evento "entrar na fase").
    // Isolado: qualquer erro aqui NÃO derruba o avanço de fase.
    // Com a chave desligada (padrão), este bloco não faz nada.
    // ============================================================
    let motor: { totalCriado: number } | null = null
    try {
      const cfg = await prisma.motorConfig.findUnique({ where: { id: 1 } })
      if (cfg?.autoExecutarAoAvancar && processo.tipoProcessoMotorId) {
        const phaseKey = await resolvePhaseKey(processo.tipoProcessoMotorId, proximaFase)
        if (phaseKey) {
          const r = await executarMotorNaFase(id, processo.tipoProcessoMotorId, phaseKey, "entered")
          motor = { totalCriado: r.totalCriado }
        }
      }
    } catch (e) {
      console.error("[avancar-fase] motor automático falhou (a fase avançou normalmente):", e)
    }

    return NextResponse.json({ ok: true, de: faseAtual, proximaFase, motor })
  } catch (error) {
    console.error("[POST .../avancar-fase]", error)
    return NextResponse.json({ error: "Erro ao avançar de fase" }, { status: 500 })
  }
}
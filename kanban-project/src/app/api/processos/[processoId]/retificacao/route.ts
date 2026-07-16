// ============================================================
// src/app/api/processos/[processoId]/retificacao/route.ts
// GET → lista os pacotes de retificação do processo (só na fase
// RETIFICACAO_REGISTROS). Pacotes são criados pelo usuário (POST /pacotes).
// ============================================================

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { pkgProgress, phaseProgress, type RetWorkflowStep } from "@/src/lib/process-stage/retificacao-engine"
import { phaseKeyToFaseCode } from "@/src/lib/process-stage/fases-catalog"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const { processoId } = await params
    const id = parseInt(processoId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const processo = await prisma.processo.findUnique({
      where: { id },
      select: { id: true, faseAtualKey: true },
    })
    if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

    if (phaseKeyToFaseCode(processo.faseAtualKey) !== "RETIFICACAO_REGISTROS") {
      return NextResponse.json({ emFase: false, pacotes: [] })
    }

    const pacotes = await prisma.retificacaoPacote.findMany({
      where: { processoId: id },
      orderBy: { id: "asc" },
    })

    const kpis = {
      total: pacotes.length,
      jud: pacotes.filter((p) => p.tipo === "judicial").length,
      adm: pacotes.filter((p) => p.tipo === "administrativa").length,
      proto: pacotes.filter((p) => ["protocolado", "em_exigencia", "decisao_recebida", "validado"].includes(p.status)).length,
      exig: pacotes.filter((p) => p.status === "em_exigencia").length,
      dec: pacotes.filter((p) => ["decisao_recebida", "validado"].includes(p.status)).length,
      valid: pacotes.filter((p) => p.status === "validado").length,
      bloq: pacotes.filter((p) => p.status === "bloqueado").length,
    }

    const comProg = pacotes.map((p) => ({
      ...p,
      progresso: pkgProgress((p.workflow as unknown as RetWorkflowStep[]) ?? []),
    }))
    const progress = phaseProgress(
      pacotes.map((p) => ({ workflow: (p.workflow as unknown as RetWorkflowStep[]) ?? [] }))
    )

    return NextResponse.json({ emFase: true, pacotes: comProg, kpis, progress })
  } catch (error) {
    console.error("[GET .../retificacao]", error)
    return NextResponse.json({ error: "Erro ao carregar a retificação" }, { status: 500 })
  }
}
// src/app/api/processos/[processoId]/phase/route.ts

/**
 * GET /api/processos/[processoId]/phase
 *
 * Retorna a fase atual do processo (computada do estado dos documentos)
 * + progresso na fase atual.
 *
 * Usado pelo componente <PhaseProgressHeader /> no header da página do
 * processo. Não move o card aqui — apenas LÊ. Movimento acontece nos
 * endpoints PUT que mudam status de documento (chamando
 * recalculateProcessStage).
 *
 * Resposta:
 * {
 *   stage: "BUSCA_DOCUMENTAL",
 *   label: "Busca Documental",
 *   done: 0,
 *   total: 2,
 *   percent: 0,
 *   reason: "2 doc(s) sem busca resolvida · 1 pendente · 1 em busca"
 * }
 */

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { computePhaseProgress } from "@/src/lib/process-stage/compute-phase-progress"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ processoId: string }> },
) {
  const { processoId: idStr } = await params
  const processoId = Number(idStr)

  if (!Number.isFinite(processoId)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 })
  }

  const processo = await prisma.processo.findUnique({
    where: { id: processoId },
    include: {
      arvore: {
        include: {
          pessoas: {
            include: {
              documentos: {
                select: { id: true, status: true },
              },
            },
          },
        },
      },
    },
  })

  if (!processo) {
    return NextResponse.json({ error: "processo não encontrado" }, { status: 404 })
  }

  const docs = (processo.arvore?.pessoas ?? []).flatMap((p) =>
    p.documentos.map((d) => ({ id: d.id, status: d.status })),
  )

  const progress = computePhaseProgress(docs)
  return NextResponse.json(progress)
}
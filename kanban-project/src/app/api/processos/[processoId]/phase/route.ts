// src/app/api/processos/[processoId]/phase/route.ts

/**
 * GET /api/processos/[processoId]/phase
 *
 * Retorna a fase atual do processo + progresso na fase.
 *
 * A fase vem do `faseCode` da coluna onde o card está (fonte da verdade,
 * igual ao motor de avanço). O progresso (done/total) é contado pelos
 * documentos da LINHA RETA. Se o processo ainda não tiver faseCode, cai
 * no derive pelos status dos documentos (fallback).
 *
 * Usado pelo componente <PhaseProgressHeader /> no header do processo.
 * Não move o card aqui — apenas LÊ.
 */

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  computePhaseProgress,
  stageFromFaseCode,
} from "@/src/lib/process-stage/compute-phase-progress"
import { phaseKeyToFaseCode } from "@/src/lib/process-stage/fases-catalog"

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
                select: {
                  id: true,
                  status: true,
                  // CUTOVER V2: sem Workflow legado; o gate da fase deriva do status.
                },
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

  // só a linha reta conta pro gate da fase (igual ao resto do sistema)
  const docs = (processo.arvore?.pessoas ?? [])
    .filter((p) => p.linhaReta)
    .flatMap((p) =>
      p.documentos.map((d) => ({
        id: d.id,
        status: d.status,
        workflows: [],
      })),
    )

  // Fonte CANÔNICA da fase = Processo.faseAtualKey (E5 / runtime v2), não a coluna
  // legada (status.faseCode). Sob v2, statusId costuma ser null → antes caía no
  // derive por documentos e exibia a fase ERRADA (ex.: "Análise Documental" quando a
  // fase real é "Emissão Documental"). Ordem: faseAtualKey → status.faseCode → derive.
  const faseCanonica = phaseKeyToFaseCode(processo.faseAtualKey) ?? null
  const stageOverride = stageFromFaseCode(faseCanonica ?? undefined)
  const progress = computePhaseProgress(docs, stageOverride, faseCanonica)

  return NextResponse.json(progress)
}
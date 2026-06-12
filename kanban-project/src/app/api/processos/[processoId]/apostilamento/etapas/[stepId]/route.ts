// ============================================================
// src/app/api/processos/[processoId]/apostilamento/etapas/[stepId]/route.ts
// POST → conclui uma etapa. Chama applyStep, grava, e no APROVAR marca
// documento.apostilado=true e move o card para AGUARDANDO_PROTOCOLO.
// ============================================================

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import type { FaseCode, Prisma } from "@prisma/client"
import {
  applyStep,
  calcProgress,
  type ApFolder,
  type ApDoc,
  type ApStepId,
} from "@/src/lib/process-stage/apostilamento-engine"

function parseBR(s: string | null | undefined): Date | null {
  if (!s) return null
  const m = String(s).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) {
    const d = new Date(s)
    return isNaN(d.getTime()) ? null : d
  }
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ processoId: string; stepId: string }> }
) {
  try {
    const { processoId, stepId } = await params
    const id = parseInt(processoId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    const body = await request.json().catch(() => ({}))

    const processo = await prisma.processo.findUnique({
      where: { id },
      select: { id: true, pais: true },
    })
    if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

    const pasta = await prisma.pastaApostilamento.findUnique({
      where: { processoId: id },
      include: { documentos: { orderBy: { id: "asc" } } },
    })
    if (!pasta) {
      return NextResponse.json({ error: "Pasta de apostilamento não encontrada." }, { status: 422 })
    }

    const folder: ApFolder = {
      status: pasta.status,
      currentStep: pasta.currentStep as ApStepId,
      destinationCountry: pasta.destinationCountry,
      apostilleType: pasta.apostilleType,
      authorityName: pasta.authorityName,
      attendant: pasta.attendant,
      cost: pasta.cost,
      trackingCode: pasta.trackingCode,
      sentAt: null,
      expectedDate: null,
      receivedAt: null,
      workflow: (pasta.workflow as unknown as ApFolder["workflow"]) ?? [],
    }
    const docs: ApDoc[] = pasta.documentos.map((d) => ({
      documentoId: d.documentoId,
      pessoaNome: d.pessoaNome,
      documentoTitulo: d.documentoTitulo,
      origem: d.origem,
      status: d.status as ApDoc["status"],
      apostilledFile: d.apostilledFile,
      apostilleNumber: d.apostilleNumber,
      apostilleDate: d.apostilleDate,
      issuingAuthority: d.issuingAuthority,
      conferenceResult: d.conferenceResult,
      validationDecision: d.validationDecision,
    }))

    const result = applyStep(folder, docs, stepId as ApStepId, body)
    if (!result.ok || !result.folder || !result.docs) {
      return NextResponse.json(
        { error: result.error || "Não foi possível concluir a etapa." },
        { status: 422 }
      )
    }
    const f = result.folder
    const now = new Date()

    const pastaData: Prisma.PastaApostilamentoUpdateInput = {
      status: f.status,
      currentStep: f.currentStep,
      destinationCountry: f.destinationCountry,
      apostilleType: f.apostilleType,
      authorityName: f.authorityName,
      attendant: f.attendant,
      cost: f.cost,
      trackingCode: f.trackingCode,
      workflow: f.workflow as unknown as Prisma.InputJsonValue,
    }
    if (f.sentAt) pastaData.sentAt = parseBR(f.sentAt)
    if (f.expectedDate) pastaData.expectedDate = parseBR(f.expectedDate)
    if (f.receivedAt) pastaData.receivedAt = parseBR(f.receivedAt)
    if (result.completePhase) pastaData.validatedAt = now

    let colunaDestinoId: number | null = null
    if (result.completePhase) {
      const coluna = await prisma.status.findFirst({
        where: { pais: processo.pais, faseCode: "AGUARDANDO_PROTOCOLO" as FaseCode },
        select: { id: true },
      })
      if (!coluna) {
        return NextResponse.json(
          { error: `Não há coluna para AGUARDANDO_PROTOCOLO no país ${processo.pais}.` },
          { status: 422 }
        )
      }
      colunaDestinoId = coluna.id
    }

    await prisma.$transaction(
      async (tx) => {
        await tx.pastaApostilamento.update({ where: { id: pasta.id }, data: pastaData })

        for (const it of result.docs!) {
          await tx.pastaApostilamentoDocumento.updateMany({
            where: { pastaApostilamentoId: pasta.id, documentoId: it.documentoId },
            data: {
              status: it.status,
              apostilledFile: it.apostilledFile,
              apostilleNumber: it.apostilleNumber,
              apostilleDate: it.apostilleDate,
              issuingAuthority: it.issuingAuthority,
              conferenceResult: it.conferenceResult,
              validationDecision: it.validationDecision,
            },
          })
        }

        if (result.completePhase && colunaDestinoId) {
          const ids = result.docs!.map((d) => d.documentoId)
          await tx.documento.updateMany({
            where: { id: { in: ids } },
            data: { apostilado: true },
          })
          await tx.processo.update({ where: { id }, data: { statusId: colunaDestinoId } })
        }
      },
      { timeout: 30000, maxWait: 10000 }
    )

    return NextResponse.json({
      ok: true,
      completePhase: !!result.completePhase,
      rejected: !!result.rejected,
      progress: calcProgress(f.workflow),
    })
  } catch (error) {
    console.error("[POST .../apostilamento/etapas]", error)
    return NextResponse.json({ error: "Erro ao concluir etapa de apostilamento" }, { status: 500 })
  }
}
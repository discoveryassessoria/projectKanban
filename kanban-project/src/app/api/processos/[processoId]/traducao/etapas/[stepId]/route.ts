// ============================================================
// src/app/api/processos/[processoId]/traducao/etapas/[stepId]/route.ts
// ------------------------------------------------------------
// POST → conclui uma etapa da pasta de tradução.
// Chama applyStep (motor puro), grava o resultado, e — quando a
// validação é APROVADA — marca os documentos como traduzidos e move
// o card para APOSTILAMENTO (mesmo mecanismo da rota analise/concluir).
// ============================================================

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import {
  applyStep,
  calcProgress,
  type TrFolder,
  type TrDoc,
  type TrStepId,
} from "@/src/lib/process-stage/traducao-engine"

/** Converte "dd/mm/aaaa" em Date (ou tenta Date nativo; null se inválida). */
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

    const pasta = await prisma.pastaTraducao.findUnique({
      where: { processoId: id },
      include: { documentos: { orderBy: { id: "asc" } } },
    })
    if (!pasta) {
      return NextResponse.json({ error: "Pasta de tradução não encontrada." }, { status: 422 })
    }

    // Monta o estado para o motor. Datas entram como null de propósito:
    // o motor não as lê, e só devolve data nas etapas que a preenchem.
    const folder: TrFolder = {
      status: pasta.status,
      currentStep: pasta.currentStep as TrStepId,
      sourceLanguage: pasta.sourceLanguage,
      targetLanguage: pasta.targetLanguage,
      translatorName: pasta.translatorName,
      translatorEmail: pasta.translatorEmail,
      cost: pasta.cost,
      sentAt: null,
      expectedDate: null,
      receivedAt: null,
      workflow: (pasta.workflow as unknown as TrFolder["workflow"]) ?? [],
    }
    const docs: TrDoc[] = pasta.documentos.map((d) => ({
      documentoId: d.documentoId,
      pessoaNome: d.pessoaNome,
      documentoTitulo: d.documentoTitulo,
      origem: d.origem,
      status: d.status as TrDoc["status"],
      translatedFile: d.translatedFile,
      conferenceResult: d.conferenceResult,
      validationDecision: d.validationDecision,
    }))

    const result = applyStep(folder, docs, stepId as TrStepId, body)
    if (!result.ok || !result.folder || !result.docs) {
      return NextResponse.json(
        { error: result.error || "Não foi possível concluir a etapa." },
        { status: 422 }
      )
    }
    const f = result.folder
    const now = new Date()

    // Escalares da pasta. Datas só quando o motor as setou NESTA etapa.
    const pastaData: Prisma.PastaTraducaoUpdateInput = {
      status: f.status,
      currentStep: f.currentStep,
      sourceLanguage: f.sourceLanguage,
      targetLanguage: f.targetLanguage,
      translatorName: f.translatorName,
      translatorEmail: f.translatorEmail,
      cost: f.cost,
      workflow: f.workflow as unknown as Prisma.InputJsonValue,
    }
    if (f.sentAt) pastaData.sentAt = parseBR(f.sentAt)
    if (f.expectedDate) pastaData.expectedDate = parseBR(f.expectedDate)
    if (f.receivedAt) pastaData.receivedAt = parseBR(f.receivedAt)
    if (result.completePhase) {
      pastaData.validatedAt = now
      // validatedById: ligar à sessão quando vocês passarem o usuário às rotas
    }

    await prisma.$transaction(
      async (tx) => {
        await tx.pastaTraducao.update({ where: { id: pasta.id }, data: pastaData })

        for (const it of result.docs!) {
          await tx.pastaTraducaoDocumento.updateMany({
            where: { pastaTraducaoId: pasta.id, documentoId: it.documentoId },
            data: {
              status: it.status,
              translatedFile: it.translatedFile,
              conferenceResult: it.conferenceResult,
              validationDecision: it.validationDecision,
            },
          })
        }

        if (result.completePhase) {
          const ids = result.docs!.map((d) => d.documentoId)
          await tx.documento.updateMany({
            where: { id: { in: ids } },
            data: { traduzido: true },
          })
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
    console.error("[POST .../traducao/etapas]", error)
    return NextResponse.json({ error: "Erro ao concluir etapa de tradução" }, { status: 500 })
  }
}
// ============================================================
// src/app/api/processos/[processoId]/retificacao/pacotes/[pkgId]/etapas/[stepId]/route.ts
// POST → conclui uma etapa de um pacote. Quando TODOS os pacotes do
// processo ficam "validado", a fase conclui e o card avança para
// EMISSAO_DOCUMENTAL_RETIFICADA.
// ============================================================

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { moverStatusIdLegacy } from "@/src/lib/motor/runtime-guard"
import type { FaseCode, Prisma } from "@prisma/client"
import { applyStep, allValidated, type RetPkg } from "@/src/lib/process-stage/retificacao-engine"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ processoId: string; pkgId: string; stepId: string }> }
) {
  try {
    const { processoId, pkgId, stepId } = await params
    const id = parseInt(processoId)
    const pid = parseInt(pkgId)
    if (isNaN(id) || isNaN(pid)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    const body = await request.json().catch(() => ({}))

    const processo = await prisma.processo.findUnique({ where: { id }, select: { id: true, pais: true } })
    if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

    const row = await prisma.retificacaoPacote.findFirst({ where: { id: pid, processoId: id } })
    if (!row) return NextResponse.json({ error: "Pacote não encontrado." }, { status: 404 })

    const pkg: RetPkg = {
      tipo: row.tipo,
      status: row.status,
      currentStep: row.currentStep,
      motivo: row.motivo,
      prioridade: row.prioridade,
      proxAcao: row.proxAcao,
      processoNum: row.processoNum,
      tribunal: row.tribunal,
      vara: row.vara,
      comarca: row.comarca,
      advogado: row.advogado,
      oab: row.oab,
      statusProc: row.statusProc,
      cartorio: row.cartorio,
      canal: row.canal,
      protocolo: row.protocolo,
      dataProtocolo: row.dataProtocolo,
      atendente: row.atendente,
      prazo: row.prazo,
      statusAdm: row.statusAdm,
      workflow: (row.workflow as unknown as RetPkg["workflow"]) ?? [],
      movements: (row.movements as unknown as RetPkg["movements"]) ?? [],
      attachments: (row.attachments as unknown as RetPkg["attachments"]) ?? [],
      validacao: (row.validacao as Record<string, unknown>) ?? null,
    }

    const result = applyStep(pkg, stepId, body)
    if (!result.ok) {
      return NextResponse.json({ error: result.error || "Não foi possível concluir a etapa." }, { status: 422 })
    }

    // reabrir / nova análise: nada a gravar
    if (result.recordedOnly || !result.patch) {
      return NextResponse.json({ ok: true, recordedOnly: true })
    }

    // descobre se, com este pacote validado, TODOS ficam validados
    let phaseComplete = false
    let colunaDestinoId: number | null = null
    if (result.validated) {
      const outros = await prisma.retificacaoPacote.findMany({
        where: { processoId: id, id: { not: pid } },
        select: { status: true },
      })
      phaseComplete = allValidated([...outros, { status: "validado" }])
      if (phaseComplete) {
        const coluna = await prisma.status.findFirst({
          where: { pais: processo.pais, faseCode: "EMISSAO_DOCUMENTAL_RETIFICADA" as FaseCode },
          select: { id: true },
        })
        if (!coluna) {
          return NextResponse.json(
            { error: `Não há coluna para EMISSAO_DOCUMENTAL_RETIFICADA no país ${processo.pais}.` },
            { status: 422 }
          )
        }
        colunaDestinoId = coluna.id
      }
    }

    await prisma.$transaction(
      async (tx) => {
        await tx.retificacaoPacote.update({
          where: { id: pid },
          data: result.patch as Prisma.RetificacaoPacoteUpdateInput,
        })
        if (colunaDestinoId) {
          await moverStatusIdLegacy(tx, id, colunaDestinoId)
        }
      },
      { timeout: 30000, maxWait: 10000 }
    )

    return NextResponse.json({
      ok: true,
      validated: !!result.validated,
      phaseComplete,
      advanced: !!colunaDestinoId,
    })
  } catch (error) {
    console.error("[POST .../retificacao/pacotes/etapas]", error)
    return NextResponse.json({ error: "Erro ao concluir etapa do pacote" }, { status: 500 })
  }
}
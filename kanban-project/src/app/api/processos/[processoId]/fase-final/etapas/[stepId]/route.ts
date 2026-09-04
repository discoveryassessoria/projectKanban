// ============================================================
// src/app/api/processos/[processoId]/fase-final/etapas/[stepId]/route.ts
// POST → conclui uma etapa da fase final. Na última etapa avança o card
// (Aguardando protocolo→Protocolado→Finalizado). receber_decisao:
// deferido avança; exigência/indeferido registra sem concluir.
// (+ gatilho do MOTOR quando a fase avança — 1 linha, best-effort)
// ============================================================

import { NextResponse } from "next/server"
import { recusarSeCanonicoAssumiu } from "@/src/services/motor-da-fase"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import {
  applyStep, calcProgress, keyFromFaseCode,
  type FinalState,
} from "@/src/lib/process-stage/final-engine"
import { dispararMotorNaFaseAtual } from "@/src/lib/motor/executor"
import { concluirFaseBespokeEAvancar } from "@/src/lib/motor/auto-avanco"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ processoId: string; stepId: string }> }
) {
  try {
    // 🔒 Sem checagem nenhuma antes — qualquer requisição concluía etapa da
    // fase final.
    const erroPermissao = await verificarPermissao(request, "tarefas.iniciar_concluir")
    if (erroPermissao) return erroPermissao

    const { processoId, stepId } = await params
    const id = parseInt(processoId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const body = await request.json().catch(() => ({}))

    const processo = await prisma.processo.findUnique({
      where: { id },
      select: { id: true, paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } }, faseAtualKey: true },
    })
    if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

    // UM MOTOR SÓ. A fase final varia por processo, então a pergunta só pode ser feita
    // depois de saber em qual delas ele está. Quando o Workflow Interno dessa fase tem
    // cadastro operacional publicado, esta rota para de aceitar comando: seguir adiante
    // concluiria à força os passos que o motor está pedindo.
    const recusa = await recusarSeCanonicoAssumiu(processo.faseAtualKey ?? "")
    if (recusa) return NextResponse.json({ error: recusa.erro, mensagem: recusa.mensagem }, { status: 409 })

    const key = keyFromFaseCode(processo.faseAtualKey)
    if (!key) return NextResponse.json({ error: "O processo não está numa fase final." }, { status: 422 })

    const fase = await prisma.faseFinal.findUnique({
      where: { processoId_faseKey: { processoId: id, faseKey: key } },
    })
    if (!fase) return NextResponse.json({ error: "Estado da fase final não encontrado." }, { status: 422 })

    const state: FinalState = {
      status: fase.status,
      currentStep: fase.currentStep,
      data: (fase.data as Record<string, unknown>) ?? {},
      workflow: (fase.workflow as unknown as FinalState["workflow"]) ?? [],
    }

    const result = applyStep(key, state, stepId, body)
    if (!result.ok || !result.state) {
      return NextResponse.json({ error: result.error || "Não foi possível concluir a etapa." }, { status: 422 })
    }
    const s = result.state

    const faseData: Prisma.FaseFinalUpdateInput = {
      status: s.status,
      currentStep: s.currentStep,
      workflow: s.workflow as unknown as Prisma.InputJsonValue,
      data: s.data as Prisma.InputJsonValue,
    }

    // a fase avança quando concluiu e há próxima fase
    const avancouFase = !!(result.completePhase && result.advanceToFaseCode)

    await prisma.$transaction(
      async (tx) => {
        await tx.faseFinal.update({
          where: { processoId_faseKey: { processoId: id, faseKey: key } },
          data: faseData,
        })
      },
      { timeout: 30000, maxWait: 10000 }
    )

    // MOTOR + AUTO-AVANÇO — fase final concluída: dispara o motor, conclui o Workflow
    // Interno (libera o gate) e avança (Aguardando protocolo → Protocolado → Finalizado).
    if (avancouFase) {
      await dispararMotorNaFaseAtual(id)
      await concluirFaseBespokeEAvancar(id, processo.faseAtualKey)
    }

    return NextResponse.json({
      ok: true,
      completePhase: !!result.completePhase,
      recordedOnly: !!result.recordedOnly,
      advanced: avancouFase,
      progress: calcProgress(s.workflow),
    })
  } catch (error) {
    console.error("[POST .../fase-final/etapas]", error)
    return NextResponse.json({ error: "Erro ao concluir etapa da fase final" }, { status: 500 })
  }
}
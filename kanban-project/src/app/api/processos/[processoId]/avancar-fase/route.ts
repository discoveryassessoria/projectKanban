// src/app/api/processos/[processoId]/avancar-fase/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { getNextFase, phaseKeyToFaseCode, faseCodeToPhaseKey } from "@/src/lib/process-stage/fases-catalog"
import type { FaseCode } from "@prisma/client"
import { dispararMotorNaFaseAtual } from "@/src/lib/motor/executor"
import { resolveWorkflowRuntime } from "@/src/lib/workflow-runtime"
import { advance } from "@/src/lib/motor/phase-advance"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  // Item 1 da auditoria — gate canônico: avançar de fase exige workflow.avancar.
  const erro = await verificarPermissao(request, "workflow.avancar")
  if (erro) return erro

  try {
    const { processoId } = await params
    const id = parseInt(processoId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const processo = await prisma.processo.findUnique({
      where: { id },
      select: { id: true, pais: true, faseAtualKey: true, workflowRuntime: true },
    })
    if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

    // CP-4F — DELEGAÇÃO GRADUAL: processos em runtime v2 avançam SOMENTE pelo
    // serviço canônico PhaseAdvanceService (único escritor de faseAtualKey).
    // Processos legacy seguem o caminho legado abaixo (dual-read, sem dual-write).
    const cfg = await prisma.motorConfig.findUnique({ where: { id: 1 }, select: { runtimeV2Habilitado: true } })
    if (resolveWorkflowRuntime(processo.workflowRuntime, cfg?.runtimeV2Habilitado ?? false) === "v2") {
      const r = await advance(id)
      const status = r.success ? 200 : r.resultado === "CONFLITO" ? 409 : r.resultado === "BLOQUEADO" ? 422 : 400
      return NextResponse.json(r, { status })
    }

    // Fase REAL = faseAtualKey (fonte de verdade). O legado Processo.statusId /
    // Status.faseCode foi removido — a fase não tem mais fallback por status.
    const faseAtual = phaseKeyToFaseCode(processo.faseAtualKey) ?? null
    if (!faseAtual) return NextResponse.json({ error: "O processo não tem fase definida." }, { status: 422 })

    const proximaFase = getNextFase(faseAtual)
    if (!proximaFase) return NextResponse.json({ error: "Esta já é a última fase." }, { status: 422 })

    // O card é posicionado exclusivamente pela faseAtualKey.
    await prisma.processo.update({
      where: { id },
      data: { faseAtualKey: faseCodeToPhaseKey(proximaFase) as string },
    })

    // MOTOR — gatilho automático (best-effort; não derruba o avanço).
    // Agora lê a fase certa (faseAtualKey já atualizado acima).
    await dispararMotorNaFaseAtual(id)

    return NextResponse.json({ ok: true, de: faseAtual, proximaFase })
  } catch (error) {
    console.error("[POST .../avancar-fase]", error)
    return NextResponse.json({ error: "Erro ao avançar de fase" }, { status: 500 })
  }
}
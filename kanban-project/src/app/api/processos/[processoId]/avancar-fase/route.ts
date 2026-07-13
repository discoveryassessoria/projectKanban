// src/app/api/processos/[processoId]/avancar-fase/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { getNextFase } from "@/src/lib/process-stage/fases-catalog"
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
      select: { id: true, pais: true, faseAtualKey: true, workflowRuntime: true, status: { select: { faseCode: true } } },
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

    // ✅ E5 — fase REAL = faseAtualKey (fonte de verdade). Fallback p/ a coluna
    // legada só se faseAtualKey estiver vazio. Antes lia SÓ status.faseCode.
    const faseAtual =
      ((processo.faseAtualKey?.toUpperCase() as FaseCode) ?? processo.status?.faseCode ?? null)
    if (!faseAtual) return NextResponse.json({ error: "O processo não tem fase definida." }, { status: 422 })

    const proximaFase = getNextFase(faseAtual)
    if (!proximaFase) return NextResponse.json({ error: "Esta já é a última fase." }, { status: 422 })

    // coluna legada é OPCIONAL: o card é posicionado pela faseAtualKey.
    const colunaDestino = await prisma.status.findFirst({
      where: { pais: processo.pais, faseCode: proximaFase },
      select: { id: true },
    })

    // ✅ E5 — move o card: faseAtualKey SEMPRE; statusId só se houver coluna.
    // Antes atualizava só o statusId → o card ficava DESSINCRONIZADO (a fase
    // real, faseAtualKey, não mudava).
    await prisma.processo.update({
      where: { id },
      data: { faseAtualKey: proximaFase.toLowerCase(), ...(colunaDestino ? { statusId: colunaDestino.id } : {}) },
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
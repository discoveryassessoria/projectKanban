// ESTE ARQUIVO SUBSTITUI: src/app/api/processos/[processoId]/fase/route.ts
//
// Move o processo de FASE (arrastar o card no kanban).
// Valida que a fase de destino pertence ao Workflow Macro do TIPO do processo.
//
// NOVO (6/jul): GATILHO AUTOMÁTICO — se a chave MotorConfig.autoExecutarAoAvancar
// estiver LIGADA (Gerenciamento → Executor do Motor), ao mover de fase o motor
// roda sozinho as automações "ao entrar na fase" da fase de destino.
// O executor já evita duplicar (idempotência por automaticKey).
// Se o motor falhar, a mudança de fase NÃO é desfeita — só loga o erro.

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { executarMotorNaFase } from "@/src/lib/motor/executor"
import { resolveWorkflowRuntime } from "@/src/lib/workflow-runtime"
import { advance } from "@/src/lib/motor/phase-advance"

export async function PUT(request: Request, { params }: { params: Promise<{ processoId: string }> }) {
  // Item 1 da auditoria — alinhado ao gate canônico de avanço (antes: processos.editar_status).
  const erro = await verificarPermissao(request, "workflow.avancar")
  if (erro) return erro

  try {
    const { processoId: idStr } = await params
    const processoId = parseInt(idStr)
    if (!processoId) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const faseAtualKey = String(body?.faseAtualKey || "").trim()
    if (!faseAtualKey) return NextResponse.json({ error: "Informe a fase." }, { status: 400 })

    const processo = await prisma.processo.findUnique({
      where: { id: processoId },
      select: { id: true, tipoProcessoMotorId: true, faseAtualKey: true, workflowRuntime: true },
    })
    if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })
    if (!processo.tipoProcessoMotorId) {
      return NextResponse.json({ error: "Processo sem tipo do motor — não é possível mover de fase." }, { status: 400 })
    }

    // a fase de destino tem que existir no workflow do tipo
    const wf = await prisma.macroWorkflow.findUnique({
      where: { tipoProcessoId: processo.tipoProcessoMotorId },
      include: { fases: { where: { showInKanban: true }, select: { phaseKey: true } } },
    })
    const valida = wf?.fases.some((f) => f.phaseKey === faseAtualKey)
    if (!valida) {
      return NextResponse.json({ error: "Fase inválida para o tipo deste processo." }, { status: 400 })
    }

    // CP-4F — sob runtime v2, faseAtualKey NÃO pode ser escrita diretamente (regra
    // suprema: só o PhaseAdvanceService escreve). Arrastar o card só é aceito quando
    // o destino é EXATAMENTE a próxima fase (delega ao avanço normal); qualquer outra
    // mudança (pular fases / voltar) deve usar os endpoints canônicos.
    const cfg = await prisma.motorConfig.findUnique({ where: { id: 1 }, select: { runtimeV2Habilitado: true } })
    if (resolveWorkflowRuntime(processo.workflowRuntime, cfg?.runtimeV2Habilitado ?? false) === "v2") {
      const ordenadas = await prisma.macroWorkflow.findUnique({
        where: { tipoProcessoId: processo.tipoProcessoMotorId },
        include: { fases: { orderBy: { ordem: "asc" }, select: { phaseKey: true, ordem: true } } },
      })
      const fases = ordenadas?.fases ?? []
      const idxAtual = fases.findIndex((f) => f.phaseKey === (processo.faseAtualKey ?? ""))
      const proxima = idxAtual >= 0 && idxAtual + 1 < fases.length ? fases[idxAtual + 1].phaseKey : null
      if (faseAtualKey === proxima) {
        const r = await advance(processoId)
        const status = r.success ? 200 : r.resultado === "CONFLITO" ? 409 : r.resultado === "BLOQUEADO" ? 422 : 400
        return NextResponse.json(r, { status })
      }
      return NextResponse.json(
        {
          error: "Sob runtime v2, use os endpoints canônicos (/advance, /advance/force, /phase/return). Mudança direta de fase não é permitida.",
          runtime: "v2", faseAtual: processo.faseAtualKey, destinoSolicitado: faseAtualKey, proximaFase: proxima,
        },
        { status: 409 },
      )
    }

    const atualizado = await prisma.processo.update({
      where: { id: processoId },
      data: { faseAtualKey },
    })

    // ✅ GATILHO AUTOMÁTICO: roda as automações "ao entrar na fase" de destino
    let motor: unknown = null
    try {
      const cfg = await prisma.motorConfig.findUnique({ where: { id: 1 } })
      if (cfg?.autoExecutarAoAvancar) {
        motor = await executarMotorNaFase(processoId, processo.tipoProcessoMotorId, faseAtualKey, "entered")
      }
    } catch (e) {
      console.error("Gatilho automático do motor falhou (mover fase):", e)
    }

    return NextResponse.json({ processo: atualizado, motor })
  } catch (error) {
    console.error("Erro ao mover processo de fase:", error)
    return NextResponse.json({ error: "Erro ao mover processo de fase" }, { status: 500 })
  }
}
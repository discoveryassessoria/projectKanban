// src/app/api/processos/[processoId]/phases/route.ts
//
// Lista as fases do processo com o estado (ACTIVE|COMPLETED|FUTURE) e os metadados
// das instâncias MATERIALIZADAS (por ciclo). Alimenta o Workflow Macro para decidir
// clicabilidade (só fases materializadas) e navegar por workflowInstanceId (multi-ciclo).
// Somente leitura — não materializa nada. Gate: processos.ver.

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { FASES, phaseKeyToFaseCode, getOrdemFase } from "@/src/lib/process-stage/fases-catalog"
import type { FaseCode } from "@prisma/client"

type PhaseState = "ACTIVE" | "COMPLETED" | "FUTURE"

interface CycleMeta {
  workflowInstanceId: number
  ciclo: number
  status: string
  startedAt: string | null
  completedAt: string | null
  supersededAt: string | null
}

interface PhaseListItem {
  phaseKey: string
  faseCode: FaseCode | null
  label: string
  ordem: number
  state: PhaseState
  materialized: boolean
  /** Instância mais recente (maior ciclo) — alvo default da consulta. */
  workflowInstanceId: number | null
  ciclo: number | null
  status: string | null
  /** Todos os ciclos materializados desta fase (para consulta multi-ciclo). */
  cycles: CycleMeta[]
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> },
) {
  const erro = await verificarPermissao(request, "processos.ver")
  if (erro) return erro

  const { processoId } = await params
  const id = parseInt(processoId)
  if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

  try {
    const processo = await prisma.processo.findUnique({
      where: { id },
      select: { id: true, faseAtualKey: true },
    })
    if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

    const faseAtualKey = processo.faseAtualKey ?? null
    const faseAtualCode = phaseKeyToFaseCode(faseAtualKey)
    const ordemAtual = faseAtualCode != null ? getOrdemFase(faseAtualCode) : -1

    const instancias = await prisma.phaseWorkflowInstance.findMany({
      where: { processoId: id },
      orderBy: [{ faseMacroKey: "asc" }, { ciclo: "desc" }],
      select: {
        id: true, faseMacroKey: true, ciclo: true, status: true,
        startedAt: true, completedAt: true, supersededAt: true,
      },
    })

    const porFase = new Map<string, CycleMeta[]>()
    for (const inst of instancias) {
      const arr = porFase.get(inst.faseMacroKey) ?? []
      arr.push({
        workflowInstanceId: inst.id,
        ciclo: inst.ciclo,
        status: String(inst.status),
        startedAt: inst.startedAt?.toISOString() ?? null,
        completedAt: inst.completedAt?.toISOString() ?? null,
        supersededAt: inst.supersededAt?.toISOString() ?? null,
      })
      porFase.set(inst.faseMacroKey, arr)
    }

    const phases: PhaseListItem[] = Object.values(FASES)
      .sort((a, b) => a.ordem - b.ordem)
      .map((f) => {
        const cycles = porFase.get(f.phaseKey) ?? [] // já ordenado por ciclo desc
        const latest = cycles[0] ?? null
        const state: PhaseState =
          f.phaseKey === faseAtualKey ? "ACTIVE"
          : f.ordem < ordemAtual ? "COMPLETED"
          : "FUTURE"
        return {
          phaseKey: f.phaseKey,
          faseCode: f.code,
          label: f.label,
          ordem: f.ordem,
          state,
          materialized: cycles.length > 0,
          workflowInstanceId: latest?.workflowInstanceId ?? null,
          ciclo: latest?.ciclo ?? null,
          status: latest?.status ?? null,
          cycles,
        }
      })

    return NextResponse.json({ processoId: id, faseAtualKey, ordemAtual, phases })
  } catch (error) {
    console.error("[GET .../phases]", error)
    return NextResponse.json({ error: "Erro ao listar fases" }, { status: 500 })
  }
}

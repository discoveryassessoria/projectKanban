// src/lib/motor/blocking-engine.ts
// CP-4E — PhaseBlockingService / BlockingEngine: SOMENTE LEITURA.
// Calcula, de forma determinística, todas as pendências que impedem o avanço.
// NÃO altera Processo/fase/Passo/Tarefa/Necessidade/Documento; não financeiro;
// não ativa runtime.
//
// REFATORADO: o BlockingEngine NÃO possui mais lógica própria de gate nem exceção
// por NOME de fase (isGenealogia) ou lista hardcoded de stepKey. Ele apenas CARREGA
// o snapshot e delega à FUNÇÃO-BASE ÚNICA `computeGate` (operational-projection-core),
// a mesma consumida pelo resolver canônico da projeção operacional. O bloqueio é
// orientado pelo ESCOPO DECLARADO da fase (PROCESSO/NECESSIDADE/DOCUMENTO). Não
// recalcula progresso.

import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import { WorkflowInstanceStatus } from "@prisma/client"
import {
  type BlockingIssue, type Policy,
  avaliarPolitica, separar,
} from "@/src/lib/motor/blocking-helpers"
import { itemCatalogosDeCertidao } from "@/src/lib/documentos/natureza-certidao"
import { computeGate, type ProjectionInput, type NecessidadeData } from "@/src/lib/motor/operational-projection-core"
import { getFase, phaseKeyToFaseCode } from "@/src/lib/process-stage/fases-catalog"
import { mapStepToGate } from "@/src/lib/process-stage/operational-projection"

export interface PhaseBlockingResult {
  issues: BlockingIssue[]
  blocking: BlockingIssue[]
  warnings: BlockingIssue[]
  canAdvance: boolean
  policy: Policy
  faseMacroKey: string
  correlationId: string
}

const INSTANCIA_ATIVA: WorkflowInstanceStatus[] = [
  WorkflowInstanceStatus.ATIVO,
  WorkflowInstanceStatus.AGUARDANDO,
  WorkflowInstanceStatus.BLOQUEADO,
]

export async function calcularPendencias(
  processoId: number,
  faseMacroKey: string,
  ctx: { correlationId?: string } = {}
): Promise<PhaseBlockingResult> {
  const correlationId = ctx.correlationId ?? randomUUID()
  const policy: Policy = "ALL_REQUIRED_COMPLETED"

  const processo = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true, arvoreId: true },
  })
  if (!processo) {
    const issues = computeGate(inexistente(processoId, faseMacroKey))
    return finalizar(issues, policy, faseMacroKey, correlationId)
  }

  const faseCode = phaseKeyToFaseCode(faseMacroKey)
  const faseDef = faseCode ? getFase(faseCode) : null

  // Snapshot carregado (mesma origem que o resolver canônico) — em paralelo.
  const [necsRaw, certidaoItens, instancia, reqCount] = await Promise.all([
    prisma.necessidadeDocumental.findMany({
      where: { processoId },
      select: { id: true, status: true, obrigatoriedade: true, itemCatalogoId: true },
    }),
    itemCatalogosDeCertidao(prisma),
    prisma.phaseWorkflowInstance.findFirst({
      where: { processoId, faseMacroKey, status: { in: INSTANCIA_ATIVA } },
      orderBy: { ciclo: "desc" },
      include: {
        steps: {
          include: { tarefas: { where: { chaveIdempotencia: { not: null } }, select: { id: true, statusTarefa: true, responsavelId: true } } },
          orderBy: { ordem: "asc" },
        },
      },
    }),
    prisma.processoRequerente.count({ where: { processoId } }),
  ])

  const necessidades: NecessidadeData[] = necsRaw.map((n) => ({
    id: n.id,
    status: n.status,
    obrigatoria: n.obrigatoriedade === "OBRIGATORIA",
    ehCertidao: certidaoItens.has(n.itemCatalogoId),
  }))

  const input: ProjectionInput = {
    processId: processoId,
    faseCode,
    faseMacroKey,
    phaseName: faseDef?.label ?? faseMacroKey,
    scope: faseDef?.scope ?? null,
    processoExists: true,
    hasActiveInstance: !!instancia,
    steps: (instancia?.steps ?? []).map(mapStepToGate),
    necessidades,
    documentos: [], // gate não usa documentos (progresso DOCUMENTO usa; aqui é só bloqueio)
    hasArvore: processo.arvoreId != null,
    requerentesCount: reqCount,
  }

  const issues = computeGate(input)
  return finalizar(issues, policy, faseMacroKey, correlationId)
}

function inexistente(processoId: number, faseMacroKey: string): ProjectionInput {
  return {
    processId: processoId, faseCode: null, faseMacroKey, phaseName: faseMacroKey, scope: null,
    processoExists: false, hasActiveInstance: false, steps: [], necessidades: [], documentos: [],
    hasArvore: false, requerentesCount: 0,
  }
}

function finalizar(issues: BlockingIssue[], policy: Policy, faseMacroKey: string, correlationId: string): PhaseBlockingResult {
  const { blocking, warnings } = separar(issues)
  return { issues, blocking, warnings, canAdvance: avaliarPolitica(issues, policy), policy, faseMacroKey, correlationId }
}

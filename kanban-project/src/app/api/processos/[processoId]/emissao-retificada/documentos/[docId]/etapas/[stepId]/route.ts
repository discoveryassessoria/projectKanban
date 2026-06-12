// src/app/api/processos/[processoId]/emissao-retificada/documentos/[docId]/etapas/[stepId]/route.ts
//
// POST — aplica uma etapa do workflow de um documento em Emissão documental retificada.
// Espelha apostilamento/etapas/[stepId]/route.ts (Next 15, prisma @/lib/prisma,
// $transaction com timeout pra mover o card).
//
// `docId` = id do registro EmissaoRetificada (o que o GET devolve em `documentos[].id`).
// Quando TODOS os documentos do processo ficam validados, o card avança para
// "Tradução juramentada" (advanceToPhase do mockup → completeRetifiedEmissionPhase).

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  applyStep, allValidated, reProgress,
  type ReWorkflow,
} from "@/src/lib/process-stage/emissao-retificada-engine"

const PROXIMA_FASE = "TRADUCAO_JURAMENTADA" // FaseCode

export async function POST(
  req: Request,
  { params }: { params: Promise<{ processoId: string; docId: string; stepId: string }> },
) {
  const { processoId: pid, docId: did, stepId } = await params
  const processoId = Number(pid)
  const registroId = Number(did)

  let payload: Record<string, unknown> = {}
  try { payload = await req.json() } catch { payload = {} }

  const registro = await prisma.emissaoRetificada.findUnique({ where: { id: registroId } })
  if (!registro || registro.processoId !== processoId) {
    return NextResponse.json({ error: "Documento não encontrado nesta fase." }, { status: 404 })
  }

  // aplica a etapa no motor puro
  const wf = registro.workflow as unknown as ReWorkflow
  const r = applyStep(wf, registro.status, stepId, payload)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })

  // persiste o documento
  await prisma.emissaoRetificada.update({
    where: { id: registroId },
    data: {
      workflow: r.workflow as object,
      status: r.status,
      nextAction: r.nextAction,
      retifiedValidated: r.validated ? true : registro.retifiedValidated,
      // guarda os blocos preenchidos da etapa (averbacao/solicitation/...) já vêm no workflow
    },
  })

  // se este documento foi validado, verifica se a FASE inteira concluiu
  let completePhase = false
  if (r.validated) {
    const todos = await prisma.emissaoRetificada.findMany({
      where: { processoId },
      select: { status: true },
    })
    if (allValidated(todos)) {
      const processo = await prisma.processo.findUnique({ where: { id: processoId } })
      if (processo) {
        const destino = await prisma.status.findFirst({
          where: { pais: processo.pais, faseCode: PROXIMA_FASE as never },
        })
        if (destino) {
          await prisma.$transaction(
            async (tx) => {
              await tx.processo.update({ where: { id: processoId }, data: { statusId: destino.id } })
            },
            { timeout: 30000, maxWait: 10000 },
          )
          completePhase = true
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    status: r.status,
    progress: reProgress(r.workflow),
    validated: r.validated,
    rejected: r.rejected ?? false,
    completePhase,
  })
}
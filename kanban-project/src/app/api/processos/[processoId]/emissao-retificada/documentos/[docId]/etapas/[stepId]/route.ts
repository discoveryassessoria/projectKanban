// src/app/api/processos/[processoId]/emissao-retificada/documentos/[docId]/etapas/[stepId]/route.ts
//
// POST — aplica uma etapa do workflow de um documento em Emissão documental retificada.
// (+ gatilho do MOTOR quando a fase avança — 1 linha, best-effort)

import { NextResponse } from "next/server"
import { recusarSeCanonicoAssumiu } from "@/src/services/motor-da-fase"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { prisma } from "@/lib/prisma"
import {
  applyStep, allValidated, reProgress,
  type ReWorkflow,
} from "@/src/lib/process-stage/emissao-retificada-engine"
import { dispararMotorNaFaseAtual } from "@/src/lib/motor/executor"
import { concluirFaseBespokeEAvancar } from "@/src/lib/motor/auto-avanco"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ processoId: string; docId: string; stepId: string }> },
) {
  // 🔒 Sem checagem nenhuma antes — qualquer requisição concluía etapa de
  // emissão retificada.
  const erroPermissao = await verificarPermissao(req, "tarefas.iniciar_concluir")
  if (erroPermissao) return erroPermissao

  const { processoId: pid, docId: did, stepId } = await params
  const processoId = Number(pid)
  const registroId = Number(did)

  // UM MOTOR SÓ. Quando o Workflow Interno desta fase tem cadastro operacional
  // publicado, esta rota — que é a anterior a ele — para de aceitar comando: seguir
  // adiante concluiria à força os passos que o motor está pedindo, e as duas telas
  // passariam a mostrar estados diferentes do mesmo documento.
  const recusa = await recusarSeCanonicoAssumiu("emissao_documental_retificada")
  if (recusa) return NextResponse.json({ error: recusa.erro, mensagem: recusa.mensagem }, { status: 409 })

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
      completePhase = true

      // MOTOR — dispara efeitos da fase (best-effort)
      await dispararMotorNaFaseAtual(processoId)
      // AUTO-AVANÇO: conclui o Workflow Interno (libera o gate) e avança p/ Tradução.
      await concluirFaseBespokeEAvancar(processoId, "emissao_documental_retificada")
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
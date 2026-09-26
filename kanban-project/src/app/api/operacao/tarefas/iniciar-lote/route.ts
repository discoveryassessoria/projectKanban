// src/app/api/operacao/tarefas/iniciar-lote/route.ts
// ============================================================================
// INICIAR EM LOTE — Etapa 3 (tela Operação v3, 26/09/2026): "Iniciar (enviar
// ao cartório) as N" — só as tarefas realmente "a iniciar" (ponto de entrada
// do passo, ainda não tocada, com órgão já vinculado). As demais são
// ignoradas e reportadas — nunca um erro silencioso nem meio-caminho.
//
//   POST /api/operacao/tarefas/iniciar-lote
//   body: { tarefaIds: number[], canalKey?: string, protocolo?: string }
//
// Usa `concluirSubtarefaCorrentePeloPasso` — a MESMA porta genérica que já
// religa editores antigos ao motor de subtarefas — para concluir a subtarefa
// de entrada sem precisar resolver `acaoKey` do cadastro por tarefa (o lote é
// sempre "mesmo requerimento, mesmo canal").
// ============================================================================
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { subtarefasDaEtapa, concluirSubtarefaCorrentePeloPasso } from "@/src/services/subtarefas-da-etapa"

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, "tarefas.ver")
  if (erro) return erro
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: "não autenticado" }, { status: 401 })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const tarefaIds = Array.isArray(body.tarefaIds) ? body.tarefaIds.map(Number).filter(Number.isInteger) : []
  if (tarefaIds.length === 0) return NextResponse.json({ ok: false, code: "SEM_TAREFAS", mensagem: "Nenhuma tarefa selecionada." }, { status: 400 })
  const canalKey = typeof body.canalKey === "string" ? body.canalKey : undefined
  const protocolo = typeof body.protocolo === "string" ? body.protocolo : undefined

  const tarefas = await prisma.tarefa.findMany({
    where: { id: { in: tarefaIds } },
    select: {
      id: true, responsavelId: true, workflowStepInstanceId: true,
      workflowStepInstance: { select: { documentoId: true, documento: { select: { orgaoId: true } } } },
    },
  })

  const iniciadas: number[] = []
  const ignoradas: Array<{ tarefaId: number; motivo: string }> = []
  const encontrados = new Set(tarefas.map((t) => t.id))
  for (const id of tarefaIds) if (!encontrados.has(id)) ignoradas.push({ tarefaId: id, motivo: "tarefa não encontrada" })

  for (const t of tarefas) {
    if (usuario.tipo !== "admin" && t.responsavelId !== usuario.userId) {
      ignoradas.push({ tarefaId: t.id, motivo: "não é o responsável" }); continue
    }
    if (!t.workflowStepInstanceId) { ignoradas.push({ tarefaId: t.id, motivo: "sem etapa de workflow" }); continue }
    const fornecedorId = t.workflowStepInstance?.documento?.orgaoId ?? null
    if (!fornecedorId) { ignoradas.push({ tarefaId: t.id, motivo: "sem órgão vinculado — vincule antes de iniciar" }); continue }

    const subs = await subtarefasDaEtapa({ stepInstanceId: t.workflowStepInstanceId, fornecedorId })
    const corrente = subs.find((s) => !s.concluida)
    if (!corrente) { ignoradas.push({ tarefaId: t.id, motivo: "sem subtarefa em aberto" }); continue }
    const pontoDeEntrada = (corrente.dependeDe ?? []).length === 0
    const jaTocada = corrente.execucao?.startedAt != null
    if (!pontoDeEntrada || jaTocada || !corrente.disponivel) {
      ignoradas.push({ tarefaId: t.id, motivo: "não está 'a iniciar' — já foi enviada ou não é o ponto de entrada" }); continue
    }

    const r = await concluirSubtarefaCorrentePeloPasso({
      stepInstanceId: t.workflowStepInstanceId,
      executadoPorId: usuario.userId,
      payload: { canalKey, protocolo, enviadoEmLote: true },
      resultado: "enviado_lote",
      canalKey,
      protocolo,
      fornecedorId,
      subtarefaKeyEsperada: corrente.key,
    })
    if (r.aplicavel) iniciadas.push(t.id)
    else ignoradas.push({ tarefaId: t.id, motivo: "estado mudou entre a leitura e a execução — tente de novo" })
  }

  return NextResponse.json({ ok: true, iniciadas: iniciadas.length, ignoradas })
}

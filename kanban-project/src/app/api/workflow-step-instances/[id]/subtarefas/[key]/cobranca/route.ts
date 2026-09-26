// src/app/api/workflow-step-instances/[id]/subtarefas/[key]/cobranca/route.ts
//
// COBRANÇA (contato ao terceiro) de uma subtarefa em espera — Etapa 2, item 5
// do motor de prazo/acompanhamento/cobrança.
//
// GET  devolve o histórico de contatos já registrados (todas as execuções da
//      subtarefa, vigente e substituídas — fato histórico não desaparece).
// POST registra uma nova cobrança: cria o `ContatoTerceiro`, reagenda
//      `proximoAcompanhamentoEm` e liga `escalada` quando o cadastro do
//      passo (`escalarApos`) manda — tudo em `registrarCobranca`.
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { negarSeNaoForDonoDaTarefaPorId } from "@/src/lib/tarefa-acesso"
import { registrarCobranca, historicoDeCobrancasDaSubtarefa } from "@/src/services/subtarefas-da-etapa"

const CANAIS_VALIDOS = new Set(["EMAIL", "TELEFONE", "PORTAL", "CORREIO", "PRESENCIAL", "OUTRO"])

async function tarefaDoStepInstance(stepInstanceId: number) {
  return prisma.tarefa.findFirst({ where: { workflowStepInstanceId: stepInstanceId }, select: { id: true } })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; key: string }> },
) {
  const { id: idParam, key } = await params
  const stepInstanceId = Number(idParam)
  if (!Number.isFinite(stepInstanceId) || !key) {
    return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 })
  }

  const tarefa = await tarefaDoStepInstance(stepInstanceId)
  if (!tarefa) return NextResponse.json({ error: "Tarefa não encontrada para esta etapa." }, { status: 404 })
  const negado = await negarSeNaoForDonoDaTarefaPorId(request, tarefa.id)
  if (negado) return negado

  const historico = await historicoDeCobrancasDaSubtarefa(stepInstanceId, key)
  return NextResponse.json({ ok: true, historico })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; key: string }> },
) {
  const { id: idParam, key } = await params
  const stepInstanceId = Number(idParam)
  if (!Number.isFinite(stepInstanceId) || !key) {
    return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 })
  }

  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: "não autenticado" }, { status: 401 })

  const tarefa = await tarefaDoStepInstance(stepInstanceId)
  if (!tarefa) return NextResponse.json({ error: "Tarefa não encontrada para esta etapa." }, { status: 404 })
  const negado = await negarSeNaoForDonoDaTarefaPorId(request, tarefa.id)
  if (negado) return negado

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const canal = String(body.canal ?? "").toUpperCase()
  if (!CANAIS_VALIDOS.has(canal)) {
    return NextResponse.json(
      { ok: false, code: "CANAL_INVALIDO", mensagem: `Canal deve ser um de: ${[...CANAIS_VALIDOS].join(", ")}.` },
      { status: 400 },
    )
  }

  const r = await registrarCobranca({
    stepInstanceId,
    subtaskKey: key,
    canal,
    observacao: typeof body.observacao === "string" ? body.observacao.trim() || null : null,
    documentoId: Number.isFinite(Number(body.documentoId)) ? Number(body.documentoId) : null,
    orgaoId: Number.isFinite(Number(body.orgaoId)) ? Number(body.orgaoId) : null,
    registradoPorId: usuario.userId,
  })
  return NextResponse.json(r, { status: r.ok ? 200 : 422 })
}

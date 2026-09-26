// src/app/api/operacao/tarefas/cobrar-todos-vencidos/route.ts
// ============================================================================
// COBRAR TODOS OS VENCIDOS — Etapa 3 (tela Operação v3, 26/09/2026), aba
// Acompanhamento. Registra uma cobrança por tarefa entre as selecionadas
// (o cliente já filtrou por `acompanhamentoVencido && terceiro` — mesmo
// comportamento do protótipo, que aplica a cobrança individualmente a cada
// tarefa vencida, não uma só por órgão apesar do rótulo do botão).
//
//   POST /api/operacao/tarefas/cobrar-todos-vencidos
//   body: { tarefaIds: number[], canal?: string }
// ============================================================================
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { registrarCobranca, subtarefaCorrenteDaTarefa } from "@/src/services/subtarefas-da-etapa"

const CANAIS_VALIDOS = new Set(["EMAIL", "TELEFONE", "PORTAL", "CORREIO", "PRESENCIAL", "OUTRO"])

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, "tarefas.ver")
  if (erro) return erro
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: "não autenticado" }, { status: 401 })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const tarefaIds = Array.isArray(body.tarefaIds) ? body.tarefaIds.map(Number).filter(Number.isInteger) : []
  if (tarefaIds.length === 0) return NextResponse.json({ ok: false, code: "SEM_TAREFAS", mensagem: "Nenhuma tarefa vencida para cobrar." }, { status: 400 })
  const canalRaw = String(body.canal ?? "EMAIL").toUpperCase()
  const canal = CANAIS_VALIDOS.has(canalRaw) ? canalRaw : "EMAIL"

  const tarefas = await prisma.tarefa.findMany({ where: { id: { in: tarefaIds } }, select: { id: true, responsavelId: true } })
  const cobradas: number[] = []
  const ignoradas: Array<{ tarefaId: number; motivo: string }> = []
  const encontrados = new Set(tarefas.map((t) => t.id))
  for (const id of tarefaIds) if (!encontrados.has(id)) ignoradas.push({ tarefaId: id, motivo: "tarefa não encontrada" })

  for (const t of tarefas) {
    if (usuario.tipo !== "admin" && t.responsavelId !== usuario.userId) {
      ignoradas.push({ tarefaId: t.id, motivo: "não é o responsável" }); continue
    }
    const corrente = await subtarefaCorrenteDaTarefa(t.id)
    if (!corrente) { ignoradas.push({ tarefaId: t.id, motivo: "sem subtarefa em aberto" }); continue }
    const r = await registrarCobranca({ stepInstanceId: corrente.stepInstanceId, subtaskKey: corrente.subtaskKey, canal, registradoPorId: usuario.userId })
    if (r.ok) cobradas.push(t.id)
    else ignoradas.push({ tarefaId: t.id, motivo: r.motivo })
  }

  return NextResponse.json({ ok: true, cobradas: cobradas.length, ignoradas })
}
